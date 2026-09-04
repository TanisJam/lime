#!/usr/bin/env python3
"""
LIME genre/emotion judge — Qwen2-Audio-7B-Instruct.

Listens to the WAV clips rendered by `render.mjs` and, for each one, judges how
well it matches its INTENDED genre + emotion and returns concrete, actionable
feedback (instrumentation / register / rhythm / harmony). This closes the
composition loop: instead of iterating by ear, we get a local model's verdict
across many seeds.

Runs fully local (Qwen2-Audio-7B fits comfortably on a 24 GB GPU).

Usage:
    uv run --python 3.10 tools/judge/judge.py tools/judge/out/manifest.json
    # or with an activated venv:  python tools/judge/judge.py <manifest.json>

Output:  <out_dir>/report.md  and  <out_dir>/report.json  next to the manifest.
"""

import json
import sys
from pathlib import Path

import librosa
import torch
from transformers import AutoProcessor, Qwen2AudioForConditionalGeneration

MODEL_ID = "Qwen/Qwen2-Audio-7B-Instruct"

SYSTEM = (
    "You are a professional music producer with a critical ear, evaluating short "
    "instrumental clips from a procedural music engine. The instruments are General "
    "MIDI soundfont patches, so judge composition, arrangement, register, rhythm and "
    "harmony — not recording fidelity. These clips are PURELY INSTRUMENTAL: there are "
    "NO vocals, lyrics, or singing — never mention or suggest vocals. Be specific and "
    "honest; do not flatter."
)


def build_prompt(clip: dict) -> str:
    genre = clip.get("genreName") or clip["genre"]
    emotion = clip.get("emotion")
    intent = f"intended to sound like the genre **{genre}**"
    if emotion:
        intent += f" with a **{emotion}** emotional character"
    return (
        f"This clip is {intent}.\n\n"
        "Answer each point briefly and concretely:\n"
        "1. GENRE HEARD: which genre(s) does it actually sound like?\n"
        "2. EMOTION HEARD: valence (positive/negative) and arousal (high/low), in a few words.\n"
        f"3. GENRE MATCH: score 1-5 how well it matches '{genre}' (5 = unmistakably that genre).\n"
        "4. EMOTION MATCH: score 1-5 how well the emotion matches the intent"
        + (" above" if emotion else " it seems to aim for") + ".\n"
        "5. FIXES: 2-3 concrete, actionable changes (instrument choice, octave/register, "
        "rhythm/groove, harmony) that would make it sound more like the intended genre. "
        "Name specifics (e.g. 'lead is an octave too high', 'needs a backbeat snare on 2 and 4').\n"
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    manifest_path = Path(sys.argv[1]).resolve()
    manifest = json.loads(manifest_path.read_text())
    out_dir = manifest_path.parent
    clips = manifest["clips"]

    print(f"Loading {MODEL_ID} … (first run downloads ~16 GB)", flush=True)
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = Qwen2AudioForConditionalGeneration.from_pretrained(
        MODEL_ID, device_map="auto", torch_dtype=torch.bfloat16
    )
    sr = processor.feature_extractor.sampling_rate

    results = []
    for i, clip in enumerate(clips, 1):
        wav = (out_dir / clip["file"]).resolve()
        print(f"[{i}/{len(clips)}] judging {clip['file']} ({clip.get('genreName', clip['genre'])}) …", flush=True)
        audio, _ = librosa.load(str(wav), sr=sr, mono=True)

        conversation = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [
                {"type": "audio", "audio_url": str(wav)},
                {"type": "text", "text": build_prompt(clip)},
            ]},
        ]
        text = processor.apply_chat_template(conversation, add_generation_prompt=True, tokenize=False)
        inputs = processor(text=text, audios=[audio], return_tensors="pt", padding=True)
        inputs = inputs.to(model.device)
        with torch.no_grad():
            gen = model.generate(**inputs, max_new_tokens=400)
        gen = gen[:, inputs.input_ids.size(1):]
        answer = processor.batch_decode(gen, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0].strip()

        results.append({**clip, "verdict": answer})
        print(answer + "\n" + ("-" * 60), flush=True)

    (out_dir / "report.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    md = ["# LIME judge report — Qwen2-Audio-7B\n"]
    for r in results:
        md.append(f"## {r.get('genreName', r['genre'])} — seed {r.get('seed', '?')} (`{r['file']}`)")
        if r.get("emotion"):
            md.append(f"*Intended emotion: {r['emotion']}*")
        md.append("")
        md.append(r["verdict"])
        md.append("")
    (out_dir / "report.md").write_text("\n".join(md))
    print(f"\nWrote {out_dir/'report.md'} and report.json", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
