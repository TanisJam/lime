# Explore: Calibrate external genre evaluation

## Outcome

Build a reproducible, balanced, labelled **instrumental** reference corpus to calibrate the external genre evaluators before using them to judge LIME. Start with the demonstrated Funk/R&B weakness, but retain a corpus design that can expand across the existing candidate taxonomy. This change must not alter LIME composition or renderer behavior and must not download or commit media assets.

## Current system map

| Area | Current behavior | Implication for this change |
|---|---|---|
| `tools/judge/reference-genre.mjs` | Walks a local `MIDI_DIR`, infers nine labels from artist/title regexes, excludes known collisions, balances to the smallest bucket, renders 22-second FluidSynth/ffmpeg WAVs, and writes `out/reference-genre/manifest.json`. | It is the closest starting point, but labels are heuristic, provenance is only `midi-collection`, and its repertory includes copyrighted artist arrangements; it cannot substantiate a CC0 labelled corpus. |
| Reference manifest contract | Reference manifests declare `reference: true`, `task: "genre"`, ordered `candidates`, and clips with `file`, exact-string `truth`, `source`, and `seconds`. | New corpus output must preserve exact truth/candidate equality and one shared candidate set for all clips. Add stable provenance/licence/selection metadata without breaking consumers that spread each clip into results. |
| `tools/ear/tag.py` | Scores every WAV against manifest candidates via MuQ-MuLan; rejects fewer than two candidates; writes per-candidate numeric `scores`. | No tool change is inherently required if the new manifest remains compatible. |
| `tools/ear/tag-essentia.py` | Maps candidate text to Discogs genre sets, normalizes columns, writes calibration JSON only when the input is balanced, and supports a saved calibration for later unbalanced runs. | Candidate wording is an API: every new/renamed label must map through `CANDIDATE_RULES` and `GENRE_SETS`. A balanced corpus is required to produce defensible Essentia normalizers. |
| `tools/ear/fuse.py` | Requires all available reports to cover exactly the same files and candidate set; z-scores each ear per clip and combines MuQ with the averaged Essentia family. | Preserve identical manifests and candidate labels across all ears; do not add fitted fusion weights. |
| `tools/judge/matrix.mjs` | Reads any report shape, compares parsed best match to `truth`/genre, reports accuracy, chance, exact binomial p-value, and rank metrics when scores exist. | It already provides corpus-level gate metrics; a per-class/confusion breakdown is the likely reporting gap for a Funk-first diagnosis. |
| `tools/judge/sweep.mjs` | Sweeps rendered LIME variants against all 12 LIME labels and selects by mean true-label rank. | Calibration results must remain separate from sweep/tuning results; the reference corpus validates ears, not LIME variants. |
| `tools/judge/judge.py` / `calibrate.mjs` | The audio LLM supports blind classification and paired mislabelling; calibration swaps LIME labels but does not measure external-reference classification. | Keep this as a distinct prompt-bias control, not a replacement for corpus calibration. |

## Existing evidence and diagnosis

- The current `reference-genre` run is balanced at eight clips for each of nine broad candidate labels (72 total), but its source is an unpinned local general-MIDI collection and the manifest does not record individual source paths, authors, licences, or label-review evidence.
- Its candidate labels intentionally contain audible cue descriptions (for example, `Funk/R&B` and a long jazz description); labels must remain stable because both truth equality and Essentia mapping depend on their exact text/prefix.
- The existing reference reports and judge README establish that the three-ear fusion is parameter-free and that rank is a useful diagnostic beyond top-1. The fusion groups the two Essentia backends so their shared taxonomy does not count twice.
- Orchestrator evidence adds a focused failure: six externally sourced CC0 Funk tracks were tested against the current Funk/R&B, Jazz, Blues, Rock, Pop, and Electronic alternatives; fusion ranked only one of six Funk tracks first. This is insufficient evidence to retune LIME, but it is strong evidence that calibration needs labelled, provenance-verified instrumental controls and class-level reporting.
- The current source catalogue contains redistributable CC0/public-domain material principally for classical/folk sources; it does not identify a verified CC0 contemporary Funk/R&B corpus. Therefore the change cannot honestly claim broad CC0 coverage until a reviewed corpus registry supplies per-track licence and label evidence.

## Recommended design boundary

1. Add a small checked-in **reference registry/manifest source**, not audio, that explicitly lists each approved external instrumental item: stable id, local-relative input location or user-provided corpus root, source URL/collection id, composer/artist where known, licence identifier and evidence URL/text, assigned candidate label, instrumentation/vocal exclusion review, and any selection notes.
2. Add or reshape the reference-corpus builder to consume that registry rather than filename regexes. It should validate required metadata, reject duplicate IDs/files and labels outside the declared candidates, reject vocal/unknown-instrumental entries, and fail before rendering when the requested set cannot be balanced.
3. Make selection deterministic and stratified. The default corpus must include equal clips per candidate, avoid repeated arrangements of one work/artist where possible, and preserve a Funk/R&B cohort with enough independently reviewed examples to measure the known weakness. The exact per-class sample count and acceptance threshold remain a product decision; do not infer them from the six-track probe.
4. Render through the existing FluidSynth/ffmpeg chain into a dedicated ignored output directory and write a compatible runtime manifest. Do not download, check in, or redistribute MIDI/WAV assets. The registry may document user acquisition steps and expected local roots.
5. Extend reporting (preferably `matrix.mjs` or a companion pure Node scorer) with a deterministic per-class table: count, top-1 correct, top-2/top-3, mean true-label rank, and primary confusions. It must continue to report overall chance and exact binomial significance, and clearly identify the report/ear and corpus registry version.
6. Document the end-to-end calibration workflow in `tools/judge/README.md`: acquire approved local assets, validate/build the balanced manifest, run MuQ and both Essentia backends, fuse, score, save Essentia calibration files, and apply those files to unbalanced LIME sweeps. State that an evaluator failing Funk controls cannot be used as a Funk gate.

## Likely artifact surfaces

| Surface | Expected change | Notes |
|---|---|---|
| `tools/judge/reference-genre.mjs` or a new dedicated builder | Replace heuristic scan/classify selection with registry validation, deterministic balanced selection, and compatible manifest generation. | Prefer a new clearly named corpus-builder if retaining the old heuristic experiment is useful; avoid silently upgrading its provenance claims. |
| `tools/judge/<reference-registry>.json` or `.mjs` | Checked-in metadata only for reviewed external references. | No binary media and no remote fetch behavior. |
| `tools/judge/matrix.mjs` | Per-class and confusion/rank summaries plus robust malformed/missing-truth errors. | Existing generic report compatibility must remain intact. |
| `tools/judge/README.md` | Corpus provenance, reproducible commands, interpretation, and non-goals. | Explain candidate-string stability and saved Essentia calibration use. |
| Focused Node tests for judge tools | Validate registry, balancing, manifest shape, scoring summaries, and failure paths. | There are no existing tests under `tools/judge`; core Vitest genre tests are not sufficient for this toolchain. |
| `tools/ear/tag-essentia.py` (conditional) | Only if approved candidate wording lacks an existing mapping or calibration metadata needs explicit compatibility/version checks. | Do not alter mapping/weights merely to improve corpus results. |

## Test and execution conventions

- Workspace unit tests use pnpm/Vitest (`pnpm test` runs core, corpus, and MIDI); genre-focused core tests live in `packages/core/test/genreConformance.test.ts` and `genreStyle.test.ts` and test symbolic grammar, not external audio evaluation.
- Judge tooling is executable Node/Python scripts rather than package scripts. It relies on built package `dist` files, FluidSynth, ffmpeg, a local SoundFont, and local Python/model environments under `/data/ai`.
- Full calibration is environment- and asset-dependent. Automated tests should isolate pure registry, balancing, manifest, and report-summary logic; integration instructions should make external binaries/models/assets explicit and skip rather than fabricate results when unavailable.
- Essentia's batch z-normalization is valid only for a class-balanced calibration batch. Reuse its generated calibration JSON for unbalanced LIME sweeps; never let a one-genre sweep establish its own normalizer.

## Constraints and non-goals

- Do not change `tools/judge/render.mjs`, `tools/judge/genreTables.mjs`, or `apps/demo/src/sampledGenre.ts`; existing uncommitted validated fixes there are outside this change.
- Do not modify production composition, styles, renderer palettes, candidate genre behavior, ear model weights, or fusion weighting as part of evaluator calibration.
- Do not download assets, add remote network fetches, or commit external MIDI/WAV files. Preserve LIME's source-package independence from generated/external media.
- Do not treat artist-name regexes, filename labels, or a model's own predicted label as sufficient ground truth for the new corpus.
- Do not reduce the task to a Funk-only binary test: the supplied alternatives show the required near-neighbour set, while balanced multiclass controls are necessary for valid calibration and Essentia normalization.

## Decisions needed before proposal

1. Approve the exact CC0 source collection(s), acquisition instructions, and auditable per-track licence evidence for Funk/R&B; the repository currently has no verified contemporary CC0 Funk source in its catalogue.
2. Set the minimum reviewed tracks per class and the evaluator acceptance rule, including whether Funk must meet a separate floor for top-1 and/or mean rank.
3. Confirm whether the initial corpus remains nine broad external labels (current reference taxonomy) or is aligned to all 12 LIME labels; this changes the candidate contract and any required Essentia mapping work.
4. Decide whether the legacy heuristic `reference-genre.mjs` remains as an explicitly non-authoritative experiment or is replaced after migration.

## Exploration result

The bounded change is feasible without production-source or asset changes. The safe implementation path is metadata-first: establish auditable external ground truth and balanced selection, reuse the existing manifest/tagger/fusion pipeline, and add class-level reporting that makes the Funk/R&B failure visible before any LIME tuning is trusted.
