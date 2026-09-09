# Calibrate the genre judge with an auditable instrumental corpus

Create a metadata-first, externally sourced instrumental calibration corpus so genre-evaluator results are trustworthy before they influence LIME tuning. The first slice covers six near-neighbour labels with reviewed provenance and class-level acceptance gates; it does not change composition, rendering, model weights, or fusion weights.

## Intent

The fused judge ranked only one of six independently sourced CC0 Funk/R&B controls as Funk/R&B. This makes generator tuning against that class unreliable. The change establishes reproducible, auditable controls that reveal whether each evaluator class is fit to act as a tuning gate.

## Scope

1. Add a checked-in metadata registry for **48** reviewed external instrumental tracks: eight each for `Funk/R&B`, `Jazz`, `Blues`, `Rock`, `Pop`, and `Electronic`.
2. Record a stable item ID, source URL or collection ID, licence identifier and evidence, local acquisition path, assigned label and rationale, instrumental/vocal review, and selection notes for every item.
3. Add a dedicated deterministic corpus builder that validates the registry, requires the declared six-label candidate set and eight items per label, rejects duplicate IDs/paths and unreviewed or non-instrumental entries, and emits a runtime manifest compatible with the existing ears and fusion pipeline.
4. Render only user-acquired local assets into a dedicated ignored output directory. The repository will neither download nor commit MIDI, audio, or other media.
5. Extend judge reporting with deterministic per-class counts, top-1 and top-2 accuracy, mean true-label rank, and primary confusions, while retaining overall chance and exact-binomial reporting.
6. Document acquisition, validation, build, tagging, fusion, scoring, interpretation, and saved Essentia-normalizer use for unbalanced LIME sweeps.
7. Preserve `tools/judge/reference-genre.mjs` as an explicitly labelled non-authoritative heuristic experiment.

## Acceptance gate

A class is trusted as a tuning gate only when all conditions hold:

| Metric | Required result |
|---|---:|
| Top-1 accuracy | at least 50% |
| Top-2 accuracy | at least 75% |
| Mean true-label rank | at most 2.5 |

Reports must mark every failing class as **untrusted for tuning**. A passing overall score must not override a failed class gate.

## Affected areas

| Area | Change |
|---|---|
| `tools/judge/` | Metadata registry, dedicated corpus-builder logic, class-level scoring, and clear legacy-experiment labelling. |
| `tools/judge/README.md` | Reproducible local-asset workflow, provenance rules, gates, and result interpretation. |
| Judge-tool tests | Pure tests for registry validation, balancing, manifest compatibility, reporting summaries, and failure paths. |
| `tools/ear/tag-essentia.py` | Only if the approved fixed candidate wording requires mapping or calibration-compatibility validation; no model or weighting retuning. |

## Product and operational rules

- Ground truth comes from reviewed provenance, licence evidence, and label rationale—not filename regexes, artist names, or evaluator predictions.
- Because this is an internal judge-training corpus, a traceable non-CC0 dataset licence (such as CC BY 4.0) is acceptable when its obligations and underlying-rights caveats are recorded; the repository does not redistribute acquired media.
- Every runtime manifest truth value must exactly match one shared declared candidate string.
- The calibration batch remains balanced at eight tracks per class; only this balanced corpus may establish Essentia normalizers.
- Generated Essentia calibration files may be reused for unbalanced LIME sweeps, but those sweeps must not establish a new normalizer.
- Calibration evidence remains distinct from LIME variant selection and prompt-bias controls.

## Non-goals

- No production composition, renderer, style, palette, candidate-genre, or LIME sweep behavior changes.
- No ear-model changes, ear-model weights, or fusion-weight fitting.
- No remote fetching, bundled assets, or binary MIDI/audio commits.
- No promotion, deletion, or provenance reclassification of the legacy heuristic builder.
- No expansion beyond the initial six labels or eight tracks per label in this slice.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Source material has non-CC0 or mixed underlying rights | Record the dataset licence and caveat accurately, keep media local-only, and do not redistribute it; reject records whose provenance or instrumental review cannot be audited. |
| Candidate wording breaks Essentia mappings or manifest equality | Keep the six approved strings fixed and validate them before building. |
| Overall metrics hide a weak class | Make per-class gates and the untrusted status first-class report output. |
| Local binaries, models, or assets are unavailable | Unit-test pure metadata and scoring logic; document integration prerequisites and skip unavailable integration runs without fabricating results. |
| Repeated artists or arrangements bias controls | Store selection notes and make diversity review part of registry approval. |

## Rollback

All new corpus behavior is additive and isolated from production generation. Roll back by removing the new registry, builder, report additions, tests, and documentation; retain the existing `reference-genre.mjs` experiment unchanged. Generated local output and calibration files are not repository assets and can be discarded independently.

## Success criteria

- [ ] A reviewed registry declares exactly 48 instrumental references across the six fixed labels, with eight entries per label and complete provenance/licence/review metadata.
- [ ] The corpus builder deterministically rejects invalid, duplicate, unbalanced, out-of-candidate, vocal, or unknown-instrumental registry entries before rendering.
- [ ] The generated manifest remains consumable by existing MuQ, Essentia, fusion, and matrix workflows without changing fusion weights.
- [ ] Score output presents each class’s top-1, top-2, mean true-label rank, primary confusions, and explicit trusted/untrusted tuning-gate status.
- [ ] A class cannot be used to justify LIME tuning unless it passes all three stated thresholds.
- [ ] Documentation makes clear that assets are locally acquired, media is not committed or fetched, and the legacy reference builder is non-authoritative.

## Proposal question round

The orchestrator supplied confirmed decisions for corpus size and labels, class gates, legacy-builder treatment, and internal-only use of a traceable mixed-licence source. Before implementation, reviewers should verify the registry’s per-track source and licence evidence—especially Funk/R&B availability—and reject any entry whose instrumental status or label rationale cannot be independently audited.
