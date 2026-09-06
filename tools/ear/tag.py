#!/usr/bin/env python3
"""
LIME "ear" — zero-shot music tagging with MuQ-MuLan.

A joint music/text embedding: the clip and each candidate description are
projected into the same space and compared by cosine similarity. Unlike an
audio LLM this returns a number per label, never prose — which is the point.
The label set is open, so a genre LIME has never generated can be scored by
writing a sentence, with no retraining and no fixed taxonomy.

It writes the SAME report shape as judge.py --blind, so tools/judge/matrix.mjs
scores both without changes and the two instruments are directly comparable on
identical clips.

Usage:
    source /data/ai/ear/env.sh
    /data/ai/ear/venv/bin/python tools/ear/tag.py <manifest.json>

Output: <out_dir>/report-ear.json and report-ear.md next to the manifest.
"""

import json
import sys
from pathlib import Path

import librosa
import torch
from muq import MuQMuLan

MODEL_ID = "OpenMuQ/MuQ-MuLan-large"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2

    manifest_path = Path(args[0]).resolve()
    manifest = json.loads(manifest_path.read_text())
    out_dir = manifest_path.parent
    clips = manifest["clips"]

    # Sorted, so position in the prompt list carries no information — the same
    # discipline the blind judge run uses.
    candidates = sorted(
        manifest.get("candidates")
        or {c.get("genreName") or c["genre"] for c in clips}
    )
    print(f"{len(clips)} clip(s), {len(candidates)} candidates, chance = {1/len(candidates):.0%}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = MuQMuLan.from_pretrained(MODEL_ID).to(device).eval()

    with torch.no_grad():
        text_emb = model(texts=candidates)

    results = []
    for i, clip in enumerate(clips, 1):
        wav_path = (out_dir / clip["file"]).resolve()
        audio, _ = librosa.load(str(wav_path), sr=model.sr, mono=True)
        wav = torch.tensor(audio, device=device).unsqueeze(0)

        with torch.no_grad():
            audio_emb = model(wavs=wav)
            sims = model.calc_similarity(audio_emb, text_emb)[0].float().cpu().tolist()

        ranked = sorted(zip(candidates, sims), key=lambda p: p[1], reverse=True)
        best, runner = ranked[0], ranked[1] if len(ranked) > 1 else (None, 0.0)

        # Phrased exactly like the blind judge's answer so one scorer reads both.
        verdict = (
            f"1. BEST MATCH: {best[0]}\n"
            f"2. RUNNER-UP: {runner[0]}\n"
            f"3. SCORES: " + ", ".join(f"{c}={s:.4f}" for c, s in ranked)
        )
        results.append({**clip, "verdict": verdict, "scores": dict(zip(candidates, sims))})

        truth = clip.get("truth") or clip.get("genreName") or clip["file"]
        mark = "OK" if best[0] == truth else "  "
        print(f"[{i}/{len(clips)}] {mark} {clip['file'][:38]:38} → {best[0].split(' (')[0]}", flush=True)

    (out_dir / "report-ear.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))

    md = [f"# LIME ear report — MuQ-MuLan\n"]
    for r in results:
        md.append(f"## {r.get('truth') or r.get('genreName')} (`{r['file']}`)")
        md.append("")
        md.append(r["verdict"])
        md.append("")
    (out_dir / "report-ear.md").write_text("\n".join(md))

    print(f"\nWrote {out_dir/'report-ear.md'} and report-ear.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
