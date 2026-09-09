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

## Auditable six-class calibration

Calibration is a review-first control for the external ears, not a source of
LIME variants. The checked-in `calibration-registry.json` is metadata only:
it contains exactly eight records for each exact label `Funk/R&B`, `Jazz`,
`Blues`, `Rock`, `Pop`, and `Electronic`. Every record must be reviewed with
a stable `id`, POSIX-relative `localPath`, `source.url` or `source.collectionId`,
`licence.id`, `licence.evidence`, `labelRationale`,
`instrumentalReview.status` and `.evidence`, and `selectionNotes`. The
rationale and review evidence, rather than a filename or prediction, establish
the truth label.

Do not fetch assets from the judge tools and do not commit MIDI, WAV, model
output, or generated reports. A reviewer supplies the acquired local files
separately. The expected root mirrors the registry paths, for example:

```text
$LIME_CALIBRATION_ASSETS/
  clean_midi/Al Jarreau/Roof Garden.mid
  clean_midi/<other reviewed paths>.mid
```

Validate the metadata before building (the builder repeats this check):

```bash
node --input-type=module -e 'import { readFileSync } from "node:fs"; import { validateRegistry } from "./tools/judge/calibration-corpus.mjs"; validateRegistry(JSON.parse(readFileSync("tools/judge/calibration-registry.json", "utf8"))); console.log("calibration registry: valid")'
```

Required local prerequisites are Node, `fluidsynth`, `ffmpeg`, the
`apps/demo/public/soundfonts/GeneralUser-GS.sf2` SoundFont, and all 48 MIDI
files under the supplied root. Build only after those prerequisites are
reviewed and present:

```bash
node tools/judge/build-calibration-corpus.mjs \
  --assets-root="$LIME_CALIBRATION_ASSETS" \
  --registry=tools/judge/calibration-registry.json \
  --out=tools/judge/out/calibration \
  --seconds=22
```

The builder validates every local path before spawning either renderer and
publishes only a complete ignored `tools/judge/out/calibration/manifest.json`.
A missing asset or SoundFont is reported; it is never downloaded.

Run both Essentia backends, MuQ-MuLan, fusion, and the matrix report against
that same manifest:

```bash
source /data/ai/ear/env.sh
/data/ai/ear/venv/bin/python tools/ear/tag.py tools/judge/out/calibration/manifest.json
/data/ai/ear/venv-essentia/bin/python tools/ear/tag-essentia.py tools/judge/out/calibration/manifest.json
/data/ai/ear/venv-essentia/bin/python tools/ear/tag-essentia.py tools/judge/out/calibration/manifest.json --backend=maest
python3 tools/ear/fuse.py tools/judge/out/calibration
node tools/judge/matrix.mjs tools/judge/out/calibration/report-fused.json
node tools/judge/matrix.mjs --json tools/judge/out/calibration/report-fused.json > tools/judge/out/calibration/matrix-summary.json
```

The terminal table and JSON evidence mark each class `TRUSTED FOR TUNING`
only when its inclusive gates all pass: top-1 at least 4/8 (50%), top-2 at
least 6/8 (75%), and mean true-label rank at most 2.5. A failed class is
explicitly `UNTRUSTED FOR TUNING`; a passing aggregate never overrides a
failed `Funk/R&B` or other class gate. Numeric score reports are strict: every
row needs the same candidate keys, finite scores, and a declared truth.
Prose-only legacy reports still retain overall chance and exact-binomial
output, but cannot establish class calibration gates.

A balanced calibration run may write
`tools/judge/out/calibration/essentia-calibration.json` and
`essentia-calibration-maest.json`. Reuse those saved normalizers for an
unbalanced LIME sweep instead of letting that sweep replace them:

```bash
/data/ai/ear/venv-essentia/bin/python tools/ear/tag-essentia.py tools/judge/out/lime/manifest.json \
  --calibration=tools/judge/out/calibration/essentia-calibration.json
/data/ai/ear/venv-essentia/bin/python tools/ear/tag-essentia.py tools/judge/out/lime/manifest.json \
  --backend=maest --calibration=tools/judge/out/calibration/essentia-calibration-maest.json
```

Calibration establishes evaluator fitness on reviewed external controls. It
does not select LIME variants (that remains `sweep.mjs`) and does not replace
the judge's blind or paired-mislabelling runs, which are separate prompt-bias
controls. The older `reference-genre.mjs` experiment is also separate: it
uses filename/artist heuristics and its output cannot establish calibration
trust.

### Measured result (2026-09-09, first full run)

The first executed calibration, over the checked-in 48-record registry rendered
through FluidSynth and scored by the fused ear:

| class | top-1 | top-2 | mean rank | primary confusion | gate |
|---|---|---|---|---|---|
| Blues | 5/8 63% | 7/8 88% | 1.50 | mixed | TRUSTED |
| Electronic | 6/8 75% | 7/8 88% | 1.50 | Jazz, Pop | TRUSTED |
| Jazz | 4/8 50% | 5/8 63% | 1.88 | Funk/R&B | untrusted (top-2) |
| Pop | 0/8 0% | 4/8 50% | 3.50 | Jazz | untrusted |
| Funk/R&B | 2/8 25% | 2/8 25% | 3.63 | Electronic | untrusted |
| Rock | 1/8 13% | 1/8 13% | 4.13 | Electronic | untrusted |

Overall 18/48 (38%) against 17% chance, mean rank 2.69/6, p=0.000: above
chance, but weak. **Only Blues and Electronic may be used to gate tuning.**

Funk's failure is not a rendering artifact. Six CC0 produced Funk recordings —
real audio, no MIDI and no General MIDI in the path — scored MuQ 0/6,
EfficientNet 1/6, MAEST 2/6, fused 1/6. Two independent corpora in two
different audio domains agree: the ear stack cannot identify Funk.

Rendering LIME's own clips through the sampled Tone.js palette instead of
FluidSynth does not fix this either. Over the same six candidates and seeds
5-8 it helps Jazz and Funk, hurts Blues and Rock, and is worse overall
(16/24 against 18/24). At four clips per class no single-class delta is
actionable.

### The gap that matters

Scored by the identical judge, render, duration and candidate set, LIME's own
clips reach 18/24 (75%, mean rank 1.42) where real, human-made, professionally
labelled music reaches 18/48 (38%, mean rank 2.69). Funk is the extreme case:
LIME 3/4 against real Funk 2/8.

Read that as "LIME matches what this judge rewards", never as "LIME is good".
The same caution the ears section raises for MuQ-MuLan applies to the fused
judge as a whole: LIME's genre tables were tuned against these ears across many
iterations, so part of that 75% measures the tuning loop rather than the music.
The external corpus is the held-out control that makes the gap visible; a
listening test is the only instrument that settles it.

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
