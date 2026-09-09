# Apply Progress: calibrate-genre-judge

## Status

- Phase: `sdd-apply`
- Work unit: PR-1 registry + pure corpus contract/tests
- Outcome: **blocked before implementation; registry evidence subsequently resolved**
- Structured status consumed: native `gentle-ai sdd-status calibrate-genre-judge --cwd /home/tanisjam/Projects/Personal/lime`
- Apply state: `ready`
- Task progress at start: `0/17`
- Action context: `repo-local`; workspace `/home/tanisjam/Projects/Personal/lime`; allowed edit root `/home/tanisjam/Projects/Personal/lime`
- Next recommended: `sdd-apply` after blockers are resolved

## Blocking conditions

1. The native runtime-attempt acquire was completed through the Pi host relay and the delegated continuation authenticated successfully. No relay variable was manually spoofed or exported.
2. At the initial attempt, PR-1 required an approved, independently auditable registry of 48 real local-only records, but `tools/judge/calibration-registry.json` and its evidence were absent. This blocker is now resolved by the supplemental research artifact and the metadata-only registry; implementation must still validate the registry before rendering or calibration.

## Completed tasks and checkbox updates

None. `tasks.md` remains unchanged with all implementation tasks unchecked.

## Files changed

- `openspec/changes/calibrate-genre-judge/apply-progress.md` (this blocker record only)

## Verification

No focused tests were run because implementation was not started and the required runtime acquire was blocked.

## Remaining PR-1 tasks

All six PR-1 implementation rows remain unchecked in `tasks.md`, including the registry audit, RED tests, pure validation, pure planning, registry commit, and triangulation/refactor.

## Workload / PR boundary

The requested boundary is the first slice of the `auto-chain`, `stacked-to-main` plan: PR-1 only. No PR-2 or PR-3 work was attempted.

## Deviations

No code or unrelated worktree changes were modified. The repository's pre-existing changes in `apps/demo/src/sampledGenre.ts`, `tools/judge/genreTables.mjs`, and `tools/judge/render.mjs` were preserved.

## Continuation attempt

- Parent acquired the bounded PR-1 attempt through the Pi host relay, and the delegated continuation completed successfully with the supplied opaque token; no relay variables were invented or exported. The failed attempt was settled with native state `proceed` and a 400-line changed-line bound.
- Current authoritative status was re-read from `gentle-ai sdd-status calibrate-genre-judge`: `openspec` store, `applyState: ready`, `0/17` tasks complete, repo-local action context rooted at `/home/tanisjam/Projects/Personal/lime`.
- The authoritative proposal, spec, design, tasks, and prior apply progress were read directly. The delivery strategy is now aligned to the planned `auto-chain` / `stacked-to-main` PR-1 boundary.
- Implementation stopped before code changes because the registry and its evidence were absent at the initial attempt. Supplemental research now records the source review, and `tools/judge/calibration-registry.json` contains exactly 48 metadata-only records with eight items per fixed candidate.
- No implementation task was completed, so `tasks.md` remains unchanged with all 17 implementation rows unchecked. No focused tests were run.
- Next action is to resume PR-1 apply with native acquire continuation and validate the registry. No rendering, media commit, or evaluator calibration claim is authorized until validation passes.

## PR-1 continuation implementation

- Native acquire continuation was run through the Pi host with the supplied opaque token and returned `proceed` for the active PR-1 attempt. No relay variables were exported or spoofed. Settlement remains bound to the failed evidence revision `sha256:fc017c33cb38e54177a62cdb52425d66626ea04eed2d4198ae58eba81e5ce13d`; a passing settle must name that revision and use distinct passing evidence.
- Structured status consumed before editing: `openspec` store; `applyState: ready`; `nextRecommended: apply`; repo-local workspace `/home/tanisjam/Projects/Personal/lime`; allowed edit root is the repository root; no action-context warnings. The workload forecast is `auto-chain` / `stacked-to-main`, so this execution is limited to PR-1.
- Registry curation supplied by the approved research is complete: `tools/judge/calibration-registry.json` remains metadata-only with exactly 48 records, eight per exact candidate, traceable CC BY 4.0 dataset evidence, underlying-rights caveats, and static instrumental-review evidence. No media was acquired, downloaded, rendered, or added.

### Completed implementation tasks and persisted checkbox updates

- [x] Curate and independently audit the 48-record source registry (research supplied and exact registry validation passed).
- [x] RED test suite added before the pure module and observed failing with `ERR_MODULE_NOT_FOUND`.
- [x] GREEN `validateRegistry` implemented with exhaustive deterministic diagnostics, fixed schema/candidates/counts, provenance requirements, balanced labels, safe MIDI paths, and explicit instrumental status.
- [x] GREEN `resolveAssets` and `planCorpus` implemented with injected local existence checks, deterministic candidate-then-ID ordering, absolute input paths, collision-safe WAV names, compatible manifest fields, provenance pass-through, and no `generatedAt`.
- [x] Exact metadata-only registry validated by the focused suite; no registry metadata was changed because the recorded research evidence supports the checked-in values.
- [x] TRIANGULATE/REFACTOR cases cover path normalization collisions and normalization, candidate-order/content drift, source-vs-collection-ID alternatives, missing prerequisites, unsupported paths, and deterministic multi-error ordering. The persisted `tasks.md` rows for all six PR-1 implementation tasks are visibly checked `[x]`; PR-2 and PR-3 rows remain unchecked.

### TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| PR-1 RED fixture and validation contract | `tools/judge/test/calibration-corpus.test.mjs` | Unit | N/A (new) | Passed initial import failure: `ERR_MODULE_NOT_FOUND` | 16 focused tests passed after implementation | 10+ invalid-registry and diagnostic cases | Cleaned path/source helpers and retained pure boundaries; 16 tests still pass |
| PR-1 pure asset resolution and planning | `tools/judge/test/calibration-corpus.test.mjs` | Unit | N/A (new) | Tests referenced absent module | 16 focused tests passed | Safe normalization, missing asset, collection-only source, exact ordering, stable serialization | No side effects introduced; 16 tests still pass |
| PR-1 exact registry | `tools/judge/test/calibration-corpus.test.mjs` | Unit | N/A (new) | Valid fixture referenced absent module | 16 focused tests passed | 48-item balance, provenance omissions, status/path adversaries | Metadata-only registry preserved |

### Files changed in this continuation

- `tools/judge/calibration-corpus.mjs` — new dependency-free pure ESM validation, asset resolution, and planning library.
- `tools/judge/test/calibration-corpus.test.mjs` — new Node built-in focused RED/GREEN/TDD tests (16 passing).
- `openspec/changes/calibrate-genre-judge/tasks.md` — checked only the six PR-1 implementation rows; PR-2/PR-3 remain unchecked.
- `openspec/changes/calibrate-genre-judge/apply-progress.md` — cumulative continuation evidence.
- `tools/judge/calibration-registry.json` — read and validated; unchanged in this continuation.

### Verification

- `node --test tools/judge/test/calibration-corpus.test.mjs` — **16 passed, 0 failed** (Node v26.8.1).
- Pure-module static check found no `process`, filesystem, subprocess, clock, or random dependency.
- No media acquisition/download/rendering or generated output was performed.

### Remaining tasks

The following exact unchecked implementation rows remain in `tasks.md` and are intentionally deferred to PR-2/PR-3:

- [ ] RED — extend `tools/judge/test/calibration-corpus.test.mjs` (or add a focused adapter test file under `tools/judge/test/`) with injected filesystem/command seams proving invalid registry, missing asset root/file, and missing SoundFont fail before directory creation, FluidSynth, or ffmpeg; prove render/transcode failure leaves neither a publishable manifest nor temporary WAV files. <!-- sdd-owner: implementation -->
- [ ] GREEN — add `tools/judge/build-calibration-corpus.mjs` with `--assets-root`, optional `--registry`, `--out`, and `--seconds`; read the JSON registry, run pure validation and all local prerequisite checks before output/spawn, reject non-MIDI input, render through FluidSynth then ffmpeg into a staged ignored directory, verify nontrivial WAVs, clean temporary files on every exit, atomically publish only a complete corpus, add `generatedAt` only at this CLI boundary, and return non-zero on failure; verify mocked success emits `manifest.json` with 48 clips and mocked failures invoke no forbidden command/output path. <!-- sdd-owner: implementation -->
- [ ] TRIANGULATE/REFACTOR — cover command quoting/argument construction, one mid-batch renderer failure, transcode failure, cleanup after exception, and staged-directory rename behavior through the adapter seams; refactor only to retain a small side-effect boundary, then run the complete Node judge-tool test command. <!-- sdd-owner: implementation -->
- [ ] RED — add `tools/ear/test/test_tag_essentia_calibration.py` (or the repository’s accepted adjacent lightweight Python-test target) for manifest-eligibility decisions: only `calibration === true`, `reference === true`, `task === "genre"`, the exact ordered six candidates, and eight truths per candidate may write a normalizer; saved calibration may apply to an unbalanced batch; unbalanced or non-calibration input cannot create or replace one. <!-- sdd-owner: implementation -->
- [ ] GREEN/TRIANGULATE — extract or add a narrow manifest-eligibility helper in `tools/ear/tag-essentia.py` and use it solely around `essentia-calibration*.json` creation; preserve `CANDIDATE_RULES`, `GENRE_SETS`, score aggregation, model behavior, and fusion weights, then verify the Python guard tests and a static diff show those prohibited mappings/weights unchanged. <!-- sdd-owner: implementation -->
- [ ] RED — add matrix/scorer cases in `tools/judge/test/calibration-corpus.test.mjs` for declared-order score ties, inclusive pass boundaries (4/8 top-1, 6/8 top-2, mean rank 2.5), each individual gate failure, overall success with failed Funk/R&B, known ranks/counts, tied and absent primary confusions, missing/unknown truth, inconsistent candidate sets, and missing/non-numeric scores; also fixture-test a prose-only legacy report retaining chance and exact-binomial output. <!-- sdd-owner: implementation -->
- [ ] GREEN — implement pure `rankScores(scores, candidates)` and `summarizeCalibration(results, candidates)` in `tools/judge/calibration-corpus.mjs`; require numeric scores for calibration gates, rank ties by declared candidate order, calculate overall metrics/exact-binomial-compatible inputs and per-class top-1/top-2/mean true-label rank/confusion frequencies, and set `trustedForTuning` only when every inclusive threshold passes; verify all scorer RED cases pass. <!-- sdd-owner: implementation -->
- [ ] GREEN — refactor `tools/judge/matrix.mjs` into a small report-file CLI over the pure scorer while preserving existing prose and scored-array output; validate shared score keys against manifest candidates when available, reject incomplete scored calibration data instead of silently subsetting it, print the deterministic class table before retained row/overall output, make failed classes explicitly `UNTRUSTED FOR TUNING`, and add `--json` stable summaries containing schema version, report path, corpus metadata, candidates, overall metrics, and ordered class results; verify legacy fixtures preserve chance/binomial behavior and calibration fixtures produce the expected terminal/JSON evidence. <!-- sdd-owner: implementation -->
- [ ] TRIANGULATE/REFACTOR — run `node --test tools/judge/test/calibration-corpus.test.mjs` and `pnpm test`; inspect `tools/judge/matrix.mjs` output for a passing boundary class and a failed Funk/R&B class to confirm no aggregate verdict claims the failed class is usable. <!-- sdd-owner: implementation -->
- [ ] Update `tools/judge/README.md` with a review-first local calibration workflow covering the no-fetch/no-media-commit rule, all registry audit fields, expected local root layout, validation/build prerequisites and command, both Essentia backends plus MuQ/fusion/matrix commands, JSON evidence, class-gate interpretation, saved-normalizer reuse for unbalanced LIME sweeps, and the distinction from LIME selection and prompt-bias controls; update only wording/docblock in `tools/judge/reference-genre.mjs` to label it a retained non-authoritative filename/artist heuristic that cannot establish calibration trust; verify every documented command/path matches the new CLI and no classification behavior changes in the legacy builder. <!-- sdd-owner: implementation -->
- [ ] Execute the documented full build → MuQ → Essentia (both backends) → fuse → matrix workflow only when reviewed local assets, SoundFont, binaries, and model environments exist; retain generated ignored manifest/report/JSON paths as local audit evidence, report unavailable prerequisites rather than fabricating a run, and verify no media or generated calibration output is staged for commit. <!-- sdd-owner: implementation -->

### Workload / PR boundary and deviations

- This is the assigned PR-1 `auto-chain` / `stacked-to-main` slice only. PR-2 builder, Essentia guard, and PR-3 scorer/matrix/documentation work were not implemented.
- Authored source/test files total 725 lines before the cumulative progress/checkbox documentation update, above the 400-line review budget. The cohesive PR-1 contract requires the exhaustive validation cases and pure implementation; this is not reduced by deleting tests, comments, blank lines, or behavior. Recommend `size:exception` or preserve the planned stacked PR boundary if the native line bound rejects settlement.
- Existing unrelated changes in `apps/demo/src/sampledGenre.ts`, `tools/judge/genreTables.mjs`, and `tools/judge/render.mjs` were preserved. CodeGraph was initialized as required but its MCP read-only server was unavailable, so structural exploration fell back to bounded filesystem reads after initialization.

### Structured status produced

- `applyState: ready` was consumed before implementation; with the six PR-1 rows now checked and PR-2/PR-3 rows pending, the next phase is `sdd-verify` for this implementation slice. Native artifact status should be refreshed by the parent after settlement.

### Native settlement result and remaining gate

- The first settle request was rejected only because CodeGraph initialization added `.codegraph/.gitignore` after acquire; it reported the current canonical inventory `sha256:b409a4e207a4cffd39a57eec96adb524797f75e1bbf27e05ee0082078819c6b9`. A distinct retry request supplied that inventory and declared all current untracked paths.
- The retry supplied the required remediation binding `sha256:fc017c33cb38e54177a62cdb52425d66626ea04eed2d4198ae58eba81e5ce13d`, distinct passing evidence revision `sha256:f977840d8d9883f6cc846a1983f6775d5306e87cc7529922bb220fb36001b707`, the opaque acquire token, and passing test evidence. Native recorded attempt ordinal 3 as `passed` with `changed_lines: 805`, but marked `changed_line_budget_exceeded: true` against the 400-line bound.
- The authoritative native attempt status after settlement was revision `sha256:51663914f056cf321b5361ca093153946cab49e48549ef7554fe71d574b48b1b`, `decision_required: true`, `complete: false`, and `next_action: reset`. The maintainer explicitly accepted `size:exception`; reset the objective before advancing, preserving the complete PR-1 validation/test contract rather than deleting coverage.

## PR-2 continuation implementation

### Structured status and native attempt

- Structured status consumed before implementation: `openspec` store; `applyState: ready`; `nextRecommended: apply`; repo-local workspace `/home/tanisjam/Projects/Personal/lime`; repository root is the allowed edit root; no action-context warnings.
- The workload decision is resolved by the parent-provided `auto-chain` / `stacked-to-main` delivery path. This execution is limited to PR-2; PR-1 remains historical and PR-3 remains out of scope.
- A fresh native bounded attempt was acquired before runtime-bearing implementation and returned `proceed`. No opaque token, unavailable counter, media, or integration result was fabricated or persisted.

### Completed tasks and persisted checkbox updates

- [x] RED adapter tests were written first against the absent builder and then passed through injected filesystem and command seams; the persisted PR-2 RED row is visibly checked.
- [x] GREEN `build-calibration-corpus.mjs` was added with registry validation, local-only prerequisite checks, MIDI rejection, FluidSynth/ffmpeg argument adapters, staged rendering, nontrivial-WAV checks, cleanup, atomic publication, CLI timestamp assignment, and non-zero CLI failures; the persisted PR-2 GREEN row is visibly checked.
- [x] TRIANGULATE/REFACTOR coverage now includes argument construction, mid-batch FluidSynth failure, ffmpeg failure, trivial WAV rejection, cleanup, existing-output replacement, publish-rename failure, CLI parsing, and complete Node judge-tool tests; the persisted PR-2 triangulation row is visibly checked.
- [x] RED Python guard tests were written before the tagger helper existed and exercised through lightweight dependency stubs; the persisted PR-2 Python RED row is visibly checked.
- [x] GREEN/TRIANGULATE `can_establish_essentia_calibration` now requires exact booleans, task, ordered candidates, 48 clips, and eight truths per class, and is used only around `essentia-calibration*.json` creation; the persisted PR-2 Python GREEN row is visibly checked.

### Files changed in this continuation

- `tools/judge/build-calibration-corpus.mjs` — new CLI and side-effect adapter boundary.
- `tools/judge/test/build-calibration-corpus.test.mjs` — injected success, prerequisite, renderer, transcode, WAV, cleanup, atomic publication, and argument tests.
- `tools/ear/tag-essentia.py` — narrow exact-manifest normalizer-write guard; existing mappings, aggregators, model calls, and fusion behavior were not changed.
- `tools/ear/test/test_tag_essentia_calibration.py` — lightweight Python helper tests using only import stubs.
- `openspec/changes/calibrate-genre-judge/tasks.md` — checked only the five completed PR-2 implementation rows; all PR-3 rows remain unchecked.
- `openspec/changes/calibrate-genre-judge/apply-progress.md` — cumulative PR-2 evidence appended without replacing PR-1 history.

### TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| PR-2 local builder failure contract | `tools/judge/test/build-calibration-corpus.test.mjs` | Unit with injected adapters | N/A (new) | `ERR_MODULE_NOT_FOUND` before builder existed | 6 tests passed after minimum builder | 13 focused cases cover missing prerequisites, renderer/transcode failures, trivial WAVs, and publication | Side effects remain behind adapter methods; 13 tests pass |
| PR-2 builder CLI and atomic workflow | `tools/judge/test/build-calibration-corpus.test.mjs` | Unit with injected adapters | N/A (new) | CLI seam referenced absent parser/builder | Success emits a 48-clip manifest in the fake staged output | Argument vectors, mid-batch failure, rename failure, existing-output replacement, and CLI forms | No shell interpolation; complete Node command passes 29/29 |
| PR-2 Essentia normalizer eligibility | `tools/ear/test/test_tag_essentia_calibration.py` | Lightweight Python unit with dependency stubs | `python3 -m py_compile` baseline passed | Missing tag helper produced `AttributeError` | Exact balanced helper and negative cases pass 4/4 | Flag, order, balance, malformed-clip, and unbalanced cases pass | Helper is narrow and the tagger diff contains no prohibited mapping/weight additions |

### Verification

- `node --test tools/judge/test/build-calibration-corpus.test.mjs` — **13 passed, 0 failed**.
- `node --test tools/judge/test/*.test.mjs` — **29 passed, 0 failed** (16 PR-1 pure tests plus 13 PR-2 adapter tests).
- `python3 -m unittest tools/ear/test/test_tag_essentia_calibration.py` — **4 passed, 0 failed**.
- The final Python helper was loaded from `tag-essentia.py` with stubs for unavailable heavy dependencies; Python guard tests passed without importing or running Essentia.
- `node tools/judge/build-calibration-corpus.mjs --assets-root=/definitely-missing-local-calibration-assets` returned exit 1 before creating `tools/judge/out/calibration` and reported the unavailable local prerequisite.
- `git diff --check` passed. A zero-addition/deletion diff filter found no changes to `CANDIDATE_RULES`, `GENRE_SETS`, aggregators, fusion, or weight symbols; the only tagger diff is helper constants/import, the narrow eligibility function, and its write-site guard.
- No FluidSynth, ffmpeg, assets, model, SoundFont, network retrieval, media bytes, or generated calibration output was used; ignored pre-existing `tools/judge/out/` artifacts remain outside commit scope.

### Remaining tasks

The following exact unchecked implementation rows remain in `tasks.md` and are intentionally deferred to PR-3:

- [ ] RED — add matrix/scorer cases in `tools/judge/test/calibration-corpus.test.mjs` for declared-order score ties, inclusive pass boundaries (4/8 top-1, 6/8 top-2, mean rank 2.5), each individual gate failure, overall success with failed Funk/R&B, known ranks/counts, tied and absent primary confusions, missing/unknown truth, inconsistent candidate sets, and missing/non-numeric scores; also fixture-test a prose-only legacy report retaining chance and exact-binomial output. <!-- sdd-owner: implementation -->
- [ ] GREEN — implement pure `rankScores(scores, candidates)` and `summarizeCalibration(results, candidates)` in `tools/judge/calibration-corpus.mjs`; require numeric scores for calibration gates, rank ties by declared candidate order, calculate overall metrics/exact-binomial-compatible inputs and per-class top-1/top-2/mean true-label rank/confusion frequencies, and set `trustedForTuning` only when every inclusive threshold passes; verify all scorer RED cases pass. <!-- sdd-owner: implementation -->
- [ ] GREEN — refactor `tools/judge/matrix.mjs` into a small report-file CLI over the pure scorer while preserving existing prose and scored-array output; validate shared score keys against manifest candidates when available, reject incomplete scored calibration data instead of silently subsetting it, print the deterministic class table before retained row/overall output, make failed classes explicitly `UNTRUSTED FOR TUNING`, and add `--json` stable summaries containing schema version, report path, corpus metadata, candidates, overall metrics, and ordered class results; verify legacy fixtures preserve chance/binomial behavior and calibration fixtures produce the expected terminal/JSON evidence. <!-- sdd-owner: implementation -->
- [ ] TRIANGULATE/REFACTOR — run `node --test tools/judge/test/calibration-corpus.test.mjs` and `pnpm test`; inspect `tools/judge/matrix.mjs` output for a passing boundary class and a failed Funk/R&B class to confirm no aggregate verdict claims the failed class is usable. <!-- sdd-owner: implementation -->
- [ ] Update `tools/judge/README.md` with a review-first local calibration workflow covering the no-fetch/no-media-commit rule, all registry audit fields, expected local root layout, validation/build prerequisites and command, both Essentia backends plus MuQ/fusion/matrix commands, JSON evidence, class-gate interpretation, saved-normalizer reuse for unbalanced LIME sweeps, and the distinction from LIME selection and prompt-bias controls; update only wording/docblock in `tools/judge/reference-genre.mjs` to label it a retained non-authoritative filename/artist heuristic that cannot establish calibration trust; verify every documented command/path matches the new CLI and no classification behavior changes in the legacy builder. <!-- sdd-owner: implementation -->
- [ ] Execute the documented full build → MuQ → Essentia (both backends) → fuse → matrix workflow only when reviewed local assets, SoundFont, binaries, and model environments exist; retain generated ignored manifest/report/JSON paths as local audit evidence, report unavailable prerequisites rather than fabricating a run, and verify no media or generated calibration output is staged for commit. <!-- sdd-owner: implementation -->

### Workload / PR boundary and deviations

- This is the assigned PR-2 `auto-chain` / `stacked-to-main` slice only. PR-1 was not reworked, and PR-3 scorer/matrix/documentation/media workflow work was not attempted.
- Authored PR-2 source/test changes total 683 changed lines (624 additions in three new source/test files plus 59 changes in `tag-essentia.py`), above the fresh 400-line review budget by 283 lines. The builder, injected failure tests, and exact normalizer guard are one cohesive work unit; shrinking it would delete required failure-path coverage or the safety boundary. Recommend an explicit `size:exception` decision for PR-2 while retaining the stacked boundary.
- Existing unrelated modifications in `apps/demo/src/sampledGenre.ts`, `tools/judge/genreTables.mjs`, and `tools/judge/render.mjs` were preserved. The generated `tools/judge/out/` calibration artifacts were not created, modified, staged, or added to the intended work-unit scope.

### Structured status produced

- `applyState: ready` was consumed before editing; five additional implementation rows are now visibly checked (`11/17` complete), six PR-3 rows remain unchecked, and the next phase for this implementation slice is `sdd-verify` after native settlement. Native status should be refreshed by the parent after settlement.

## PR-3 continuation implementation

### Structured status and native attempt

- Structured status consumed before implementation: `openspec` store; `applyState: ready`; `nextRecommended: apply`; repo-local workspace `/home/tanisjam/Projects/Personal/lime`; allowed edit root is the repository root; no action-context warnings. The workload decision was resolved by the parent-provided `auto-chain` / `stacked-to-main` delivery path, and this execution was limited to the final PR-3 boundary.
- The fresh native bounded acquire for PR-3 returned `proceed` before runtime-bearing implementation. No opaque token, unavailable counter, media, integration result, or size exception was invented or persisted.

### Completed implementation tasks and persisted checkbox updates

- [x] RED scorer and matrix tests were added before the new scorer/report behavior; coverage includes declared-order ties, inclusive class thresholds, individual gate failures, failed Funk/R&B despite a passing aggregate, known ranks/counts, tied and absent confusions, invalid truth/score data, legacy prose chance/binomial output, strict matrix input, terminal gates, and JSON evidence. The persisted PR-3 RED row is visibly checked.
- [x] GREEN `rankScores` and `summarizeCalibration` were added to the dependency-free pure corpus module. Scores must be finite and complete, ties follow declared candidate order, and summaries expose overall exact-binomial-compatible metrics, ordered class metrics, confusion frequencies, primary confusions, threshold outcomes, and `trustedForTuning` only when all inclusive gates pass. The persisted PR-3 scorer row is visibly checked.
- [x] GREEN matrix reporting now consumes the pure scorer, preserves prose-only legacy output, validates scored candidate sets/truths/scores, prints class gates before retained row/overall output, explicitly marks failed classes `UNTRUSTED FOR TUNING`, and emits stable `--json` summaries with report and corpus metadata. The persisted PR-3 matrix row is visibly checked.
- [x] TRIANGULATE/REFACTOR focused and repository tests passed, and the matrix CLI was inspected with a boundary-passing Jazz class and failed Funk/R&B class. The persisted PR-3 triangulation row is visibly checked.
- [x] Review-first calibration documentation was added with all registry audit fields, local root layout, no-fetch/no-media-commit rules, validation/build command, both Essentia backends, MuQ, fusion, matrix/JSON evidence, gate interpretation, saved-normalizer reuse, and distinctions from LIME selection and prompt-bias controls. The retained `reference-genre.mjs` docblock now explicitly labels its filename/artist heuristic output non-authoritative. The persisted PR-3 documentation row is visibly checked.
- [x] The manual integration prerequisite check found `fluidsynth`, `ffmpeg`, the SoundFont, MuQ and Essentia environments, and the judge model directory present, but no `LIME_CALIBRATION_ASSETS` root. The full build/tag/fuse/matrix workflow was therefore not run, no media was acquired, and no generated calibration output was staged. The persisted PR-3 prerequisite row is visibly checked.

### TDD Cycle Evidence

| Task | Test file | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| PR-3 pure scorer contract | `tools/judge/test/calibration-corpus.test.mjs` | Unit | 29/29 Node judge tests passed | New imports failed before scorer exports existed | 26 focused tests passed after implementation | Boundary gates, independent failures, ties, confusions, invalid inputs, and aggregate/class separation | Removed unused ordering state and clamped floating-point binomial tails; 26 tests still pass |
| PR-3 matrix compatibility/reporting | `tools/judge/test/calibration-corpus.test.mjs` | CLI fixture plus unit | Existing 29/29 Node judge tests passed | `--json` was rejected by the old path-only CLI | 26 focused tests and terminal/JSON fixtures passed | Legacy prose, incomplete scored data, manifest candidate validation, boundary Jazz, and failed Funk/R&B | Isolated file reading, scoring, rendering, and JSON output; 39 complete Node tests still pass |
| PR-3 documentation/prerequisite workflow | `tools/judge/test/calibration-corpus.test.mjs` | Documentation/manual prerequisite check | Existing tests and `pnpm test` passed | Documentation and manual evidence were absent | Focused and full repository suites passed | CLI paths, output wording, ignored-output status, and unavailable asset-root branch inspected | Documentation remained additive and legacy heuristic behavior was not changed |

### Files changed in this continuation

- `tools/judge/calibration-corpus.mjs` — pure deterministic score ranking, exact-binomial-compatible summary, class gates, and confusion metrics.
- `tools/judge/test/calibration-corpus.test.mjs` — PR-3 scorer, matrix fixture, compatibility, and strict-validation tests.
- `tools/judge/matrix.mjs` — compatibility-preserving report CLI, strict scored validation, class table, and stable JSON output.
- `tools/judge/README.md` — complete local calibration and reviewer workflow.
- `tools/judge/reference-genre.mjs` — wording-only non-authoritative heuristic notice.
- `openspec/changes/calibrate-genre-judge/tasks.md` — checked only the six completed PR-3 implementation rows; all 17 implementation rows are now visibly checked.
- `openspec/changes/calibrate-genre-judge/apply-progress.md` — cumulative PR-3 evidence appended without replacing PR-1/PR-2 history.

### Verification

- `node --test tools/judge/test/calibration-corpus.test.mjs` — **26 passed, 0 failed**.
- `node --test tools/judge/test/*.test.mjs` — **39 passed, 0 failed**.
- `pnpm test` — **249 passed, 3 skipped, 0 failed** across core, corpus, and MIDI packages.
- `node --check tools/judge/calibration-corpus.mjs`, `matrix.mjs`, and `reference-genre.mjs` — passed.
- `node --input-type=module -e '…validateRegistry…'` — metadata-only registry validation passed.
- Matrix output inspection showed Jazz at `4/8`, `6/8`, mean rank `2.50`, `TRUSTED FOR TUNING`, and Funk/R&B at `0/8`, `0/8`, mean rank `3.00`, `UNTRUSTED FOR TUNING`; aggregate output explicitly says failed classes are not usable for tuning.
- Manual prerequisite check: `fluidsynth`, `ffmpeg`, SoundFont, MuQ package/environment, Essentia package/environment, and judge model directory were present; the local calibration asset root was unavailable, so no full integration workflow was fabricated.
- `git diff --check` passed; `tools/judge/out/` remains ignored and no media or generated calibration output is staged.

### Remaining tasks

None. All 17 implementation rows in the persisted `tasks.md` artifact are visibly checked `[x]`. The next route is native settlement followed by `sdd-verify`; do not start verification before native settlement and status authorize it.

### Workload / PR boundary and deviations

- This is the final implementation boundary, PR-3 of the `auto-chain` / `stacked-to-main` delivery. PR-1 and PR-2 were reused and not reworked; full build/tag/fuse execution remains unavailable until a reviewed local asset root is supplied.
- The review forecast remains high because the pure scorer, compatibility CLI, tests, and reviewer documentation are one cohesive final work unit. The native bounded attempt was opened with a 1,000 changed-line ceiling; final native accounting and any budget disposition must come from settlement, not estimation.
- Existing unrelated modifications in `apps/demo/src/sampledGenre.ts`, `tools/judge/genreTables.mjs`, and `tools/judge/render.mjs` were preserved. No model mappings, fusion arithmetic, production composition, media, or generated output were changed.

### Structured status produced

- After the six PR-3 rows were checked, the expected native artifact status is `applyState: all_done`, `taskProgress: 17/17`, `nextRecommended: verify`, with `verify` awaiting native settlement. The parent must refresh authoritative native status after settlement before routing to `sdd-verify`.
