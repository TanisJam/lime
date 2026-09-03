# @lime/corpus

Node-only tooling to turn free scores/MIDI into LIME **StylePacks**. It ingests
symbolic music, extracts **statistics** (chord-transition tendencies, key,
cadence rates, emotion-mapped state), and compiles them into styles the LIME core
consumes.

## Philosophy & licensing (read first)

LIME is a **procedural** composer. A corpus is never replayed — that would be
loops in disguise. Instead, a corpus **tunes the rules**: we extract aggregate
statistics and bake them into a `StylePack` (a weighted transition table, an
emotion→state mapping). LIME then generates procedurally from those weights.

This has a crucial consequence for licensing:

- We ship **derived statistics** (transition weights, histograms), never the
  source files. Aggregate statistics describe *style*, not the *works*.
- **Redistributable** sources (CC0 / public domain — OpenScore, PDMX, Mutopia)
  may be committed and used commercially.
- **Non-commercial / research** sources (EMOPIA, VGMIDI, GigaMIDI, Lakh) must be
  **downloaded by the user locally**. Put them under `packages/corpus/data/`
  (git-ignored). Only the compiled StylePacks leave that directory.

See `src/catalog/sources.ts` for the full verified catalog (license, formats,
genre/emotion coverage, URL) for each source.

## Pipeline

```
MIDI / MusicXML file
   → parseScoreFile()           → CorpusScore (IR)   [.mid → parseMidiFile;
                                   .xml/.musicxml/.mxl → parseMusicXml]
   → detectKey()                → tonic + mode (Krumhansl–Schmuckler)
   → chordify()                 → per-bar diatonic degrees
   → HarmonyModelBuilder.add()  → weighted transition table + cadence stats
   → MelodyModelBuilder.add()   → diatonic interval + duration distributions
   → RhythmModelBuilder.add()   → 16-step onset groove + syncopation
   → compileStylePack()         → StylePack (harmony/melody/rhythm [+ emotion→state])
   → new LimeEngine({ style })  → procedural generation, corpus-tuned
```

The compiled StylePack's `harmony.transitions` slots directly into the core
harmony rules; any degree the corpus never used falls back to the built-in
defaults, so a partial corpus never breaks harmony.

## Emotion

Datasets with Russell valence/arousal labels (EMOPIA, VGMIDI) map to LIME state
via `emotionToState()`: valence → valence/brightness, arousal →
energy/density/complexity, and the tense corner (high arousal + negative
valence) → tension/instability. `compileStylePack({ emotion })` returns a
`suggestedState` you can pass as the engine's `initialState` or a mood target.

## Validation

Corpus-driven styles are validated with the same analysis harness as the core:
`test/compile.test.ts` compiles a StylePack from a synthetic corpus, generates
with it, and asserts the output stays in-scale and musical — and that a
constrained corpus (e.g. I↔V only) provably dominates the generated harmony.

## Building StylePacks

1. Download the datasets (non-commercial ones stay local):

   ```bash
   bash packages/corpus/scripts/download-datasets.sh
   ```

2. Build the package and run the CLI:

   ```bash
   pnpm --filter @lime/corpus build
   node packages/corpus/dist/cli/build.js --limit 300 --analyze
   ```

   Options: `--datasets emopia,vgmidi,lakh`, `--limit N` (per bucket),
   `--phrase 4|8`, `--merge` (pool emotions across datasets), `--analyze`
   (score each pack with the core analyzer), `--data DIR`, `--out DIR`.

Output lands in `packages/corpus/generated/` — one `<id>.json` per bucket plus
`index.json`. EMOPIA and VGMIDI bucket by Russell quadrant (`Q1` happy, `Q2`
tense, `Q3` sad, `Q4` calm); Lakh is one mixed-genre pool. With `--merge`, the
same emotion is pooled across datasets into `emotion-happy/tense/sad/calm`
(blending genres and averaging the emotion), while non-emotion datasets stay
separate.
Each file is a self-contained, **committable** StylePack (derived statistics
only) plus a `suggestedState` from the emotion mapping.

3. Use one in LIME:

   ```ts
   import pack from "@lime/corpus/generated/emopia-Q4.json" assert { type: "json" };
   const music = createLime({ seed: "x", style: pack.style, renderer, initialState: pack.suggestedState });
   ```

## MusicXML

`parseScoreFile()` dispatches by extension, so MIDI and MusicXML feed the same
pipeline. The MusicXML parser (`parseMusicXml`) handles `score-partwise` with
document order preserved — `<backup>`/`<forward>` for multi-voice/multi-staff
parts, chords (shared onsets), `<alter>`, grace notes, and rests — and
normalizes any `<divisions>` to 480-tick IR. `.mxl` (zipped) files are supported
via `loadMusicXmlFile`. Drop CC0 MusicXML under `data/openscore/` or
`data/pdmx/` and build with `--datasets openscore` (or `pdmx`).

## Melody & rhythm

Beyond harmony, the corpus shapes melody and rhythm:

- **Melody** (`MelodyModelBuilder`): from the skyline (highest voice), a
  distribution of diatonic step intervals (leaps beyond an octave are dropped as
  voice-crossing) and note durations. Compiled into `StylePack.melody`, which
  the `MotifGenerator` uses for generated motif contours and rhythms.
- **Rhythm** (`RhythmModelBuilder`): a 16-step onset groove profile plus
  syncopation. Compiled into `StylePack.rhythm`, which biases the percussion
  hi-hat placement toward the corpus groove.

Both fall back to the built-in generators when absent, and both are verified to
actually change generation (see `test/extractors.test.ts`).

## Status

Implemented and tested (95 tests): MIDI + MusicXML ingestion, key detection,
chordify, harmony/melody/rhythm extraction (melody via a track-selection
heuristic, not a raw skyline), emotion mapping, cross-dataset emotion merging,
StylePack compilation, the source catalog, and the `corpus:build` CLI. A
real-data merged run produces `emotion-{calm,happy,sad,tense}` packs
(EMOPIA+VGMIDI) plus `lakh-all`, scoring ~87–91% on the core analyzer; the
MusicXML parser is validated on real files (LilyPond suite).

Next (optional): a StylePack selector in the demo to audition generated packs.
