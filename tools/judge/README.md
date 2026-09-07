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

# Fuse the two (parameter-free: per-clip z-scores, added)
python3 tools/ear/fuse.py tools/judge/out

node tools/judge/matrix.mjs tools/judge/out/report-fused.json
```

On the human reference corpus (72 clips, 9 classes, chance 11%) the fusion is
the best ear measured: 34/72 against MuQ-MuLan's 24/72, McNemar p=0.041.

**On LIME's own clips it is the opposite** — MuQ-MuLan 28/48, Essentia 9/48,
fused 12/48 — and that gap is the reason to keep Essentia around. LIME's
genres, timbres and grooves were chosen by sweeping against MuQ-MuLan, so
MuQ-MuLan's 58% is partly a measure of that fitting. Essentia has never been in
that loop. Tune with MuQ-MuLan; check with Essentia. A change that moves one
and not the other moved the judge, not the music.
