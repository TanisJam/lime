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

# Blind runs must not mention LIME or its knobs. The reference corpus is
# human-composed music rendered through the same SoundFont, and the whole point
# of that control is that the model cannot tell which is which.
SYSTEM_BLIND = (
    "You are a musicologist identifying short instrumental clips by ear. Every "
    "clip is purely instrumental — no vocals. The instruments are General MIDI "
    "soundfont patches, so judge composition, arrangement, rhythm and harmony, "
    "not recording fidelity. Answer only from what you hear."
)

SYSTEM = (
    "You are a professional music producer evaluating short clips from LIME, a "
    "procedural music engine. Each clip is PURELY INSTRUMENTAL — there are NO vocals, "
    "lyrics or singing, so never mention or suggest vocals. Instruments are General "
    "MIDI soundfont patches, so judge composition, arrangement, register, rhythm and "
    "harmony, NOT recording fidelity or production polish.\n\n"
    "LIME layers up to five voices:\n"
    "  - PAD: the sustained harmony bed (chords).\n"
    "  - BASS: the bass line.\n"
    "  - MELODY: the lead line on top.\n"
    "  - MOTION: an optional arpeggio / ostinato / offbeat-stab layer.\n"
    "  - PERCUSSION: a General MIDI drum kit.\n\n"
    "Your feedback must be ACTIONABLE through the engine's real knobs (given per clip). "
    "Do NOT suggest things it cannot do (no vocals, no live-performer techniques, no "
    "effects pedals, no mixing). If a knob is ALREADY set correctly for the genre, say "
    "so rather than suggesting it — focus on what is actually wrong. Be specific and "
    "honest; do not flatter."
)

# The tunable knobs, described once so the model proposes real changes.
KNOBS = (
    "AVAILABLE KNOBS (what can be changed):\n"
    "  - instrument per voice: any General MIDI program (e.g. swap the lead to a "
    "different guitar/sax/synth).\n"
    "  - chordStyle: triad | power (root+fifth, for rock/metal) | seventh (jazz/blues).\n"
    "  - bassStyle: default | root-drive (driving straight-8th roots) | walking (jazz) | "
    "sub (sparse 808) | funk (syncopated 16ths + ghosts) | montuno (latin tumbao).\n"
    "  - groove: backbeat | four-on-floor | shuffle | swing | boom-bap | funk | clave | none.\n"
    "  - melodyScale: diatonic | minor-pentatonic | major-pentatonic | blues.\n"
    "  - motion layer: arp | ostinato | stab | none.\n"
    "  - melody register: shift the lead up/down by octaves.\n"
    "  - tempo (within the genre's range) and mood levels: energy, valence, tension, "
    "density, brightness (each 0-1).\n"
)


def build_blind_prompt(clip: dict, candidates: list) -> str:
    """Prompt that never reveals the intended genre or emotion.

    Telling the model what a clip is *supposed* to be poisons the measurement:
    paired mislabelling showed it scores the same audio 4/5 as "Ambient" and
    4/5 as "Metal", echoing the label back as its own perception. So here it is
    given the full candidate list with no hint of which one we want, and must
    commit to exactly one. Chance is 1/len(candidates); anything near that means
    the model cannot hear genre at all and is useless as a gate.
    """
    listed = "\n".join(f"  - {g}" for g in candidates)
    label = "CANDIDATE EMOTIONS" if clip.get("task") == "emotion" else "CANDIDATE GENRES"
    return (
        "Listen to this clip and identify it. You are NOT told what it is meant "
        "to be — judge only what you actually hear.\n\n"
        f"{label} (choose from these exactly):\n{listed}\n\n"
        "Answer each point briefly, IN ENGLISH:\n"
        "1. BEST MATCH: exactly ONE entry copied verbatim from the candidate list "
        "above. No explanation on this line, just the entry.\n"
        "2. RUNNER-UP: the second most likely entry from the list, or 'none'.\n"
        "3. WHY: the instrumentation, rhythm and harmony cues that led you there.\n"
        "4. EMOTION HEARD: valence (positive/negative) and arousal (high/low).\n"
        "5. INSTRUMENTS HEARD: name the actual timbres you hear per layer "
        "(chord bed, bass, lead, any arpeggio/ostinato, drums).\n"
        "6. HARMONY: do the chords move well, or feel static / repetitive / wrong? Rate 1-5.\n"
        "7. RHYTHM: does the groove lock in and drive, or feel stiff / cluttered / weak? Rate 1-5.\n"
        "8. MELODY: is the lead expressive, or aimless / too high / dull? Rate 1-5.\n"
    )


def build_prompt(clip: dict) -> str:
    genre = clip.get("genreName") or clip["genre"]
    emotion = clip.get("emotion")
    intent = f"intended to sound like the genre **{genre}**"
    if emotion:
        intent += f" with a **{emotion}** emotional character"
    # Deliberately do NOT reveal the clip's current knob values — judging by ear
    # keeps the genre/emotion read honest and stops the model parroting settings.
    return (
        f"This clip is {intent}.\n\n"
        f"{KNOBS}\n"
        "Judge PURELY BY EAR (you are not told the current settings). Answer each point briefly:\n"
        "1. GENRE HEARD: which genre(s) does it actually sound like?\n"
        "2. EMOTION HEARD: valence (positive/negative) and arousal (high/low), in a few words.\n"
        f"3. GENRE MATCH: score 1-5 how well it matches '{genre}' (5 = unmistakably that genre).\n"
        "4. EMOTION MATCH: score 1-5 how well the emotion matches the intent above.\n"
        "5. HARMONY: the chords and progression — do they move well and fit the genre, or "
        "feel static / repetitive / wrong? Rate 1-5.\n"
        "6. RHYTHM: the groove — drums and bass pocket, feel, tempo. Does it lock in and "
        "drive, or feel stiff / cluttered / weak? Rate 1-5.\n"
        "7. MELODY: the lead line — phrasing, contour, memorability, register. Is it "
        "expressive and genre-appropriate, or aimless / too high / dull? Rate 1-5.\n"
        "8. FIXES: the 2-3 highest-impact knob changes from the list above, each as "
        "'set <knob> to <value>' with a one-line reason grounded in what you HEAR. Only "
        "propose a change if you actually hear the problem.\n"
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    blind = "--blind" in sys.argv
    if not args:
        print(__doc__)
        return 2
    manifest_path = Path(args[0]).resolve()
    manifest = json.loads(manifest_path.read_text())
    out_dir = manifest_path.parent
    clips = manifest["clips"]

    # Sorted, not render order, so position in the list carries no information
    # about which clip is which. A manifest may declare its own candidate set
    # (e.g. the reference corpus, which is labelled by emotion, not genre).
    task = manifest.get("task", "genre")
    candidates = manifest.get("candidates") or sorted(
        {c.get("genreName") or c["genre"] for c in clips}
    )
    candidates = sorted(candidates)
    if blind:
        print(f"BLIND mode — {len(candidates)} candidates, chance = {1/len(candidates):.0%}", flush=True)

    print(f"Loading {MODEL_ID} … (first run downloads ~16 GB)", flush=True)
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = Qwen2AudioForConditionalGeneration.from_pretrained(
        MODEL_ID, device_map="auto", torch_dtype=torch.bfloat16
    )
    sr = processor.feature_extractor.sampling_rate

    results = []
    for i, clip in enumerate(clips, 1):
        wav = (out_dir / clip["file"]).resolve()
        print(f"[{i}/{len(clips)}] judging {clip['file']} ({clip.get("genreName") or clip.get("genre") or clip.get("truth") or clip["file"]}) …", flush=True)
        audio, _ = librosa.load(str(wav), sr=sr, mono=True)

        conversation = [
            {"role": "system", "content": SYSTEM_BLIND if blind else SYSTEM},
            {"role": "user", "content": [
                {"type": "audio", "audio_url": str(wav)},
                {"type": "text", "text": build_blind_prompt({**clip, "task": task}, candidates)
                 if blind else build_prompt(clip)},
            ]},
        ]
        text = processor.apply_chat_template(conversation, add_generation_prompt=True, tokenize=False)
        inputs = processor(text=text, audio=[audio], sampling_rate=sr, return_tensors="pt", padding=True)
        inputs = inputs.to(model.device)
        with torch.no_grad():
            gen = model.generate(**inputs, max_new_tokens=550)
        gen = gen[:, inputs.input_ids.size(1):]
        answer = processor.batch_decode(gen, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0].strip()

        results.append({**clip, "verdict": answer})
        print(answer + "\n" + ("-" * 60), flush=True)

    stem = "report-blind" if blind else "report"
    (out_dir / f"{stem}.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    md = ["# LIME judge report — Qwen2-Audio-7B\n"]
    for r in results:
        md.append(f"## {r.get("genreName") or r.get("genre") or r.get("truth") or r["file"]} — seed {r.get('seed', '?')} (`{r['file']}`)")
        if r.get("emotion"):
            md.append(f"*Intended emotion: {r['emotion']}*")
        md.append("")
        md.append(r["verdict"])
        md.append("")
    (out_dir / f"{stem}.md").write_text("\n".join(md))
    print(f"\nWrote {out_dir/f'{stem}.md'} and {stem}.json", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
