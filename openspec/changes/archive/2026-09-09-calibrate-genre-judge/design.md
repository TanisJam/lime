# Design: auditable six-class genre-judge calibration

Implement an additive, metadata-first calibration path under `tools/judge/`. A checked-in registry declares the approved 48 local-only instrumental controls; pure Node modules validate it, produce the existing runtime-manifest shape, and score evaluator reports with per-class trust gates. Rendering, tagger models, and fusion arithmetic remain unchanged.

## Quick path

1. Review and complete the metadata-only registry with exactly eight audited items for each fixed label.
2. Run the calibration builder against a user-supplied local asset root; it validates before invoking FluidSynth or ffmpeg and writes ignored output under `tools/judge/out/calibration/`.
3. Run existing MuQ, Essentia (both backends), fusion, then `matrix.mjs`; use only classes marked **trusted for tuning** as evaluator gates.

## Fixed decisions

| Topic | Decision |
|---|---|
| Candidate strings and order | `Funk/R&B`, `Jazz`, `Blues`, `Rock`, `Pop`, `Electronic`; exact strings are shared truth values and the manifest `candidates` array. |
| Corpus | Exactly 48 reviewed entries, eight per candidate, all locally acquired instrumental assets. |
| Trust floor | Per class: top-1 >= 50%, top-2 >= 75%, and mean true-label rank <= 2.5. Every condition must pass. |
| Authority | The new registry-backed corpus is calibration evidence; `reference-genre.mjs` remains a retained, explicitly non-authoritative filename-heuristic experiment. |
| Non-goals | No network retrieval, media commits, production/LIME changes, model changes, ear/fusion-weight fitting, or evaluator-weight work. |

## Components and boundaries

### `tools/judge/calibration-registry.mjs`

A data-only ESM export (or equivalently a JSON file read by the builder) is the sole checked-in calibration source. Prefer JSON, `tools/judge/calibration-registry.json`, because it is readily auditable without executing code. It contains:

```json
{
  "schemaVersion": 1,
  "corpusId": "lime-genre-calibration-v1",
  "candidates": ["Funk/R&B", "Jazz", "Blues", "Rock", "Pop", "Electronic"],
  "items": [{
    "id": "funk-rb-01",
    "label": "Funk/R&B",
    "localPath": "funk-rb/artist-track.mid",
    "source": { "url": "https://…", "collectionId": "optional-stable-id" },
    "licence": { "id": "CC-BY-4.0", "evidence": "https://…" },
    "labelRationale": "Reviewed musical/provenance basis for this assigned label.",
    "instrumentalReview": { "status": "instrumental", "evidence": "Review notes identifying no vocals." },
    "selectionNotes": "Arrangement/artist diversity and acquisition notes."
  }]
}
```

`source.url` or `source.collectionId` must be present. `licence.evidence`, `labelRationale`, `instrumentalReview.status`, `instrumentalReview.evidence`, and `selectionNotes` must be non-empty. Paths are POSIX relative paths below the supplied asset root, never absolute paths and never URLs. The registry contains no media bytes, checksums of uncommitted media, or download instructions executable by tooling. `id` is stable, unique, and used for deterministic output names rather than artist/title strings.

The implementation work includes populating all 48 reviewed records; review must reject placeholders or invented provenance. If a class—especially Funk/R&B—cannot meet this evidence bar, the registry remains invalid and calibration cannot be claimed.

### `tools/judge/calibration-corpus.mjs` (pure library)

This module has no `process`, filesystem, subprocess, clock, or random dependencies. Export named functions:

| Function | Input | Result / failure |
|---|---|---|
| `validateRegistry(registry)` | Parsed registry object | Returns normalized registry plus deterministic diagnostics; throws/returns a typed `CalibrationValidationError` with all validation codes when invalid. |
| `resolveAssets(registry, assetRoot, exists)` | Valid registry and injected existence predicate | Returns items with absolute resolved input paths; rejects missing local prerequisites and root escapes. |
| `planCorpus(registry, { seconds, sampleRate, outputDir })` | Valid registry and explicit build options | Returns ordered render jobs and a compatible manifest object, without touching disk. |
| `rankScores(scores, candidates)` | Numeric candidate-score map | Returns deterministic descending candidate/rank list; ties use declared candidate order. |
| `summarizeCalibration(results, candidates)` | Report rows carrying truth and numeric scores | Returns overall and per-class metrics, confusion counts, and gate decisions. |

Validation is exhaustive and deterministic: schema/version; exact candidate array (content, order, uniqueness); exactly 48 items; required scalar/object fields; unique IDs; unique normalized local paths; labels in the fixed set; exactly eight records per label; only `instrumental` status; and no path escape. It must reject `vocal`, `unknown`, omitted, or arbitrary instrumental statuses. It must not infer truth from a filename, artist, source, or prediction.

`planCorpus` orders jobs by declared candidate order and then `id` in lexical order. It derives a collision-safe rendered filename such as `${id}.wav`, and emits:

```json
{
  "schemaVersion": 1,
  "corpusId": "lime-genre-calibration-v1",
  "reference": true,
  "task": "genre",
  "calibration": true,
  "sampleRate": 44100,
  "candidates": ["Funk/R&B", "Jazz", "Blues", "Rock", "Pop", "Electronic"],
  "clips": [{
    "file": "funk-rb-01.wav",
    "truth": "Funk/R&B",
    "source": "https://…",
    "seconds": 22,
    "registryId": "funk-rb-01",
    "provenance": { "collectionId": "…", "licence": "CC-BY-4.0", "licenceEvidence": "…", "labelRationale": "…", "instrumentalReview": "…", "selectionNotes": "…" }
  }]
}
```

The existing ears consume `file`, `truth`, `source`, `seconds`, `task`, and `candidates`; added fields are pass-through metadata. `truth` is validated to be exactly a candidate before rendering and again while scoring. `generatedAt` is intentionally assigned only by the CLI boundary, not by pure planning, so pure outputs are stable.

### `tools/judge/build-calibration-corpus.mjs` (CLI/side-effect adapter)

The CLI owns argument parsing, registry reading, root/path resolution, existence checks, directory creation, FluidSynth/ffmpeg calls, cleanup, and manifest writing. Suggested interface:

```text
node tools/judge/build-calibration-corpus.mjs \
  --assets-root=/absolute/path/to/acquired-assets \
  [--registry=tools/judge/calibration-registry.json] \
  [--out=tools/judge/out/calibration] [--seconds=22]
```

It runs `validateRegistry` and `resolveAssets` for every record before creating output or spawning either renderer. It verifies the SoundFont and local files next, then creates the ignored output directory. For each planned job it renders MIDI to a temporary raw WAV with FluidSynth, clips/transcodes with ffmpeg, verifies a nontrivial WAV, and removes the temporary file on success or failure. It fails non-zero on any rendering failure and must not write a manifest that represents a partial corpus. A staged temporary output directory followed by rename (or deletion on failure) prevents stale/partial manifests from being mistaken as calibration evidence. On success it adds `generatedAt` at the boundary, writes `manifest.json`, and prints class counts and exact paths.

The registry specifies local MIDI paths for the initial renderer because the current proven pipeline is FluidSynth MIDI rendering. The schema is deliberately provenance/media-format neutral enough to extend only in a later approved change; this slice must reject unsupported extensions rather than add audio decoding or fetch behavior.

### `tools/judge/matrix.mjs` plus the pure scorer

Refactor the present inline parsing/math into the pure functions above, leaving `matrix.mjs` as a small report-file CLI. It continues to support existing judge and ear report arrays, including prose-only results: top-1, overall chance, and exact-binomial output remain available. Calibration-only class gates require numeric `scores` for every row, because top-2 and true-label rank cannot be computed reliably from prose.

For scored reports, `matrix.mjs` determines the shared candidate set from score keys (and, when available, checks it against the reference-manifest candidates), rejects missing/non-numeric scores, missing truth, truth outside candidates, or inconsistent candidate sets rather than silently scoring a subset. A prediction is the first `rankScores` entry; true-label rank is one-based. The scorer computes:

- overall `correct/total`, accuracy, chance `1 / candidateCount`, and exact binomial upper-tail p-value exactly as today;
- per label: `count`, top-1 `correct/count`, top-2 `withinTwo/count`, `meanTrueLabelRank`, and incorrect top-1 prediction frequencies;
- `primaryConfusions`: all incorrect predicted labels tied at the highest nonzero frequency, ordered by declared candidate order; `[]` when none exist;
- `trustedForTuning`: `true` only when all three inclusive floors pass, plus the individual threshold outcomes so a reviewer can see why it failed.

The report should show a concise deterministic terminal table first, for example:

```text
CALIBRATION TRUST GATES (report-fused.json; 48 clips; 6 candidates)
class       n   top-1     top-2     mean rank  primary confusion    tuning gate
Funk/R&B    8   3/8 38%   6/8 75%   2.25       Rock                 UNTRUSTED FOR TUNING (top-1)
Jazz        8   4/8 50%   6/8 75%   2.50       Blues, Pop          TRUSTED FOR TUNING
```

It then retains the current per-row identification display and overall `correct`, `accuracy`, `chance`, `top-2`, `top-3`, `mean rank`, and `p-value` lines. Gate language is class-specific: no aggregate verdict may label a failed class usable. A `--json` option should write/print a stable machine-readable summary with `schemaVersion`, report path, corpus metadata if present, candidate list, overall metrics, and ordered class summaries; this supports saved audit evidence without changing existing evaluator report formats.

### Essentia normalization boundary

No model mappings or weights change: the fixed labels already map in `tag-essentia.py` (`Funk/R&B` → funk; `Jazz`, `Blues`, `Rock`, `Pop`, and `Electronic` → existing mappings). Add a narrow validation/helper only if implementation needs to assert this six-label manifest before inference; do not edit `CANDIDATE_RULES`, `GENRE_SETS`, scoring aggregation, or fusion weights merely for this corpus.

Existing Essentia code may write normalization whenever a balanced candidate batch is seen. Tighten the eligibility check so writing/replacing `essentia-calibration*.json` requires `manifest.calibration === true`, `reference === true`, task `genre`, the exact six candidates, and eight truths per candidate. An unbalanced LIME sweep must supply `--calibration=<saved calibration>` and cannot overwrite it. This is validation policy, not weight fitting.

## Data flow

```text
reviewed JSON registry + user-acquired local MIDI root
  -> validateRegistry (pure; all 48/evidence/balance checks)
  -> resolveAssets (local prerequisite checks, no network)
  -> planCorpus (pure ordered jobs + compatible manifest)
  -> CLI render adapter (FluidSynth + ffmpeg, ignored calibration output)
  -> existing tag.py + tag-essentia.py x2
  -> existing fuse.py (unchanged parameter-free arithmetic)
  -> matrix CLI + summarizeCalibration
  -> terminal/JSON audit report with per-class trusted/untrusted gates
```

Calibration reports establish evaluator fitness only. They neither select LIME variants nor replace the distinct Qwen paired-mislabelling prompt-bias control. Saved Essentia normalizers produced by this balanced corpus may be applied to unbalanced LIME sweeps, but those sweeps cannot establish a replacement normalizer.

## Documentation and backward compatibility

Update `tools/judge/README.md` with a review-friendly calibration section: asset non-commit/no-fetch rule, registry evidence requirements, local acquisition and root layout, validate/build command, prerequisites, all three tag/fuse commands, score command, JSON evidence option, gate interpretation, and saved-normalizer reuse for an unbalanced sweep. Explicitly distinguish calibration from LIME selection and prompt-bias controls.

Update the banner/docblock and README reference for `reference-genre.mjs` to state that it is a retained non-authoritative heuristic experiment based on filename/artist patterns and cannot establish calibration trust. Do not remove it or mutate its classification behavior.

Existing `render.mjs`, `genreTables.mjs`, production packages, demo code, `tag.py`, and `fuse.py` remain unchanged. Existing report arrays stay supported by `matrix.mjs`; only the new per-class trust report rejects insufficient scored calibration data.

## Test plan

Use Node's built-in test runner for dependency-free tool tests, e.g. `node --test tools/judge/test/calibration-corpus.test.mjs`, and keep filesystem/subprocess tests separate from pure unit tests. No test acquires media, runs models, or needs FluidSynth/ffmpeg.

| Test area | Cases |
|---|---|
| Registry validation | Valid 48-entry fixture; candidate order/content drift; 47/49 totals; seven/nine class distribution; missing each required review/provenance field; duplicate ID; duplicate normalized path; unknown/out-of-set label; vocal/unknown status; absolute/traversal path. |
| Pure planning | Stable candidate-then-ID order; deterministic file naming; exact truth/candidate equality; manifest required legacy fields and additive provenance; no `generatedAt` from pure output. |
| Local adapter | Missing asset root/file and SoundFont fail before renderer invocation; validation failure invokes neither renderer nor output write; a failed render leaves no publishable manifest; successful behavior uses mocked command/filesystem seams. |
| Scoring | Inclusive boundary pass (4/8 top-1, 6/8 top-2, 2.5 rank); each independent gate failure; overall pass with failed Funk gate; known counts/ranks; missing/unknown truth; inconsistent/missing/non-numeric scores; deterministic ties in score ranking and primary confusions; no-confusion class. |
| Matrix compatibility | Existing prose report still prints overall chance/binomial output; existing scored ear/fusion array produces legacy overall metrics plus class details when valid. |
| Essentia policy | Unit-test extracted manifest-eligibility helper or a lightweight Python test: only exact balanced calibration manifests can write a normalizer; saved normalizer can apply to unbalanced input; unbalanced/non-calibration input cannot write/replace one. |

Run the Node tests in CI/local development; retain `pnpm test` for existing package suites. The full build/tag/fuse workflow is a documented manual integration run, executed only when locally acquired assets, SoundFont, binaries, model environments, and model files are available. Its evidence is a generated ignored manifest/reports, never fabricated or checked in.

## File-level change plan

| File | Change |
|---|---|
| `tools/judge/calibration-registry.json` | Add the reviewed metadata-only v1 registry with exactly 48 audited entries. |
| `tools/judge/calibration-corpus.mjs` | Add pure registry normalization/validation, asset-resolution planning seams, manifest planning, score ranking, per-class summary, and gate constants. |
| `tools/judge/build-calibration-corpus.mjs` | Add CLI orchestration and local FluidSynth/ffmpeg rendering into ignored `out/calibration/`. |
| `tools/judge/matrix.mjs` | Consume the pure scorer; preserve legacy output and add deterministic calibration class table, gate messages, strict scored-report validation, and optional JSON summary. |
| `tools/judge/test/calibration-corpus.test.mjs` | Add registry/planning/scoring unit tests and mocked adapter failure-path tests. |
| `tools/ear/tag-essentia.py` | Restrict normalizer creation to the exact balanced calibration manifest; optional compatibility assertion only. |
| `tools/ear/test/test_tag_essentia_calibration.py` (or adjacent lightweight test location) | Add normalization-eligibility tests if Python tooling has an accepted test entry point; otherwise cover the extracted pure helper through a direct Python test command documented in README. |
| `tools/judge/reference-genre.mjs` | Add explicit non-authoritative heuristic-experiment wording only. |
| `tools/judge/README.md` | Document the complete auditable local workflow, trust gates, normalizer boundary, and legacy distinction. |
| `.gitignore` | No change expected: `tools/judge/out/` already excludes rendered clips, reports, and calibration files. |

## Rollout and rollback

Land metadata, pure logic/tests, builder, reporting, Essentia guard, and documentation as one additive calibration capability. Before any tuning decision, reviewers audit all 48 registry records and run the local integration workflow; failed classes remain untrusted rather than triggering retuning. Roll back by removing these additive files/changes; no production behavior, committed media, or evaluator weights require migration. Local `tools/judge/out/calibration/` assets and saved normalization files can be deleted independently.
