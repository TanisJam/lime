# LIME audio judge

A local closed loop for judging LIME's output: render composed music to audio,
then have a local audio-LLM (**Qwen2-Audio-7B-Instruct**) listen and say how well
each clip matches its intended **genre** and **emotion**, with concrete fixes.

No iterating by ear — the judge hears the exact same instruments as the browser
(same GeneralUser-GS SoundFont, same per-voice GM programs, same lead register).

## Pieces

- **`render.mjs`** — drives the pure-TS composer headlessly per (genre, seed),
  writes a Standard MIDI File with the browser's GM programs + lead-register
  folding, and renders it to WAV via `fluidsynth`. Emits `out/manifest.json`.
- **`judge.py`** — loads Qwen2-Audio-7B and writes `out/report.md` + `report.json`.

## Prerequisites

- `fluidsynth` CLI (`sudo apt install -y fluidsynth`) and the SoundFont
  (`apps/demo/public/soundfonts/GeneralUser-GS.sf2`, from
  `node apps/demo/scripts/setup-fluidsynth.mjs`).
- Built packages: `pnpm -r --filter "./packages/**" build`.
- A CUDA GPU (~16 GB) for the judge. The Python env lives at
  `/data/ai/judge/venv` (this machine keeps CUDA inside `uv` venvs and model
  weights on `/data`, not in the repo), created by `~/scripts/setup-lime-judge.sh`.
  Model weights land in `/data/ai/judge/models` via `HF_HOME`, set by
  `source /data/ai/judge/env.sh`.

## Run

```bash
# 1. Render clips (all 12 genres, seed 1, 24s each; or narrow it down)
node tools/judge/render.mjs --genres=genre-metal,genre-rock-pop --seeds=1,2 --seconds=22

# 2. One-time Python env (downloads torch, and ~16 GB model on first judge run)
~/scripts/setup-lime-judge.sh

# 3. Judge
source /data/ai/judge/env.sh
/data/ai/judge/venv/bin/python tools/judge/judge.py tools/judge/out/manifest.json
```

Read `tools/judge/out/report.md` for the verdicts.

## Keeping it faithful

`render.mjs` mirrors two tables from the app — `GM` (from
`apps/demo/src/fluidRenderer.ts` `GM_PROGRAMS`) and `STATE` (from
`apps/demo/src/main.ts` `GENRE_STATE`). If you change per-genre programs, lead
folding, tempo or mood in the app, update the mirrors here too.

Not yet replicated: CC74 brightness cap (`melodyCut`) and pan. Add CC export to
`@lime/midi` if the judge flags timbre issues that trace to those.

## The ears

Three instruments write the same report shape, so `matrix.mjs` scores any of
them and they are directly comparable on identical clips.

```bash
# MuQ-MuLan — zero-shot, open label set, scores a sentence
source /data/ai/ear/env.sh
/data/ai/ear/venv/bin/python tools/ear/tag.py tools/judge/out/manifest.json

# Essentia genre_discogs400 — supervised, closed 400-style taxonomy, CPU
/data/ai/ear/venv-essentia/bin/python tools/ear/tag-essentia.py tools/judge/out/manifest.json
/data/ai/ear/venv-essentia/bin/python tools/ear/tag-essentia.py tools/judge/out/manifest.json --backend=maest

# Fuse them (parameter-free: per-clip z-scores, added; every ear present is used)
python3 tools/ear/fuse.py tools/judge/out

node tools/judge/matrix.mjs tools/judge/out/report-fused.json
```

On the human reference corpus (72 clips, 9 classes, chance 11%):

| ear | correct | |
|---|---|---|
| MuQ-MuLan | 24/72 = 33% | |
| Essentia EfficientNet | 31/72 = 43% | |
| Essentia MAEST | 30/72 = 42% | |
| **fused** | **38/72 = 53%** | McNemar vs MuQ-MuLan p=0.007 |
| oracle (any ear right) | 44/72 = 61% | an upper bound, not a target |

Picking a *subset* of ears was tried on one stratified half of that corpus and
the winner did not survive the other half, so the rule is to use them all.
Validated the same way, the fusion scores 19/36 on the held-out half against
MuQ-MuLan's 11/36.

The six clips between the fusion and the oracle do not come back. Reciprocal
rank fusion, winner-take-all on the most confident ear, and 27 per-ear-per-class
reliability weights fitted on one half were all measured on the other: every one
of them lands between 35 and 38 of 72. The oracle assumes something that tells
you which ear to trust on this clip, and no arithmetic over the scores
reconstructs it. Treat 61% as a bound on this trio, not as work left to do.

What the top-1 number hides is worth more. `matrix.mjs` now also reports where
the true label ranks, and on LIME's own clips the two readouts tell opposite
stories: MuQ-MuLan goes 28 → 29 → 32 from top-1 to top-3, so when it is wrong
the right answer is nowhere near; the fusion goes 19 → 35 → 39. Its top-1 is
worse and its ranking is far better, which is what a diagnostic wants. The
useful question is rarely "did it get it right" — it is "how far down did the
truth land, and under what".

**On LIME's own clips the ranking inverts** — MuQ-MuLan 28/48, MAEST 10/48,
EfficientNet 9/48, fused 15/48 — and that inversion is the reason to keep the
other two. MuQ-MuLan does *better* on LIME's procedural music (58%) than on
human arrangements (33%), which is backwards; both Essentia ears go the
expected way. LIME's genres, timbres and grooves were chosen by sweeping
against MuQ-MuLan, so a good part of that 58% is a measure of the sweep. The
other two ears have never been in that loop.

Tune with MuQ-MuLan; check with the others. A change that moves one and not the
rest moved the judge, not the music.
