# Genre Judge Calibration Specification

## Purpose

Provide an auditable, balanced external instrumental reference corpus that establishes whether each approved genre class is trustworthy as a LIME tuning gate, without changing production generation or evaluator weighting.

## Requirements

### Requirement: Reviewed six-class calibration registry

The system MUST maintain a checked-in metadata-only registry of exactly 48 reviewed external instrumental references: exactly eight records for each of these exact candidate strings: `Funk/R&B`, `Jazz`, `Blues`, `Rock`, `Pop`, and `Electronic`.

Each registry record MUST include a stable item ID, assigned candidate label, local acquisition path, source URL or collection identifier, licence identifier, licence evidence, label rationale, instrumental/vocal review result, and selection notes. Ground truth MUST be derived from the reviewed provenance, licence evidence, and label rationale, not from filenames, artist names, or evaluator predictions.

#### Scenario: Complete reviewed registry

- GIVEN a registry with eight reviewed instrumental records for each approved label
- WHEN the registry is validated
- THEN validation succeeds and identifies 48 total records

#### Scenario: Missing review evidence

- GIVEN a registry record without licence evidence, label rationale, or instrumental review
- WHEN the registry is validated
- THEN validation fails before any asset is rendered

### Requirement: Deterministic balanced corpus construction

The system MUST construct the calibration corpus deterministically from the reviewed registry and MUST require the declared six-label candidate set and exactly eight records per label.

The builder MUST reject duplicate item IDs, duplicate local acquisition paths, labels outside the declared candidate set, missing required metadata, non-instrumental records, records with unknown instrumental status, and any unbalanced registry. The builder MUST perform these validations before rendering output.

#### Scenario: Duplicate local asset path

- GIVEN two registry records that declare the same local acquisition path
- WHEN the builder validates the registry
- THEN it rejects the corpus without rendering either record

#### Scenario: Vocal entry

- GIVEN a registry record whose instrumental review identifies vocals
- WHEN the builder validates the registry
- THEN it rejects the corpus as ineligible for calibration

#### Scenario: Incorrect class count

- GIVEN a registry with seven `Pop` records and nine `Rock` records
- WHEN the builder validates the registry
- THEN it rejects the corpus because every approved label requires exactly eight records

### Requirement: Compatible runtime manifest

The corpus builder MUST emit a runtime manifest consumable by the existing MuQ, Essentia, fusion, and matrix workflows. The manifest MUST identify the corpus as a genre reference corpus, declare one ordered shared six-label candidate set, and give every clip a truth value that exactly equals one member of that declared set.

The runtime manifest MUST retain the information required by existing consumers, including each clip's rendered file, truth, source, and duration, and MAY add provenance metadata without changing the meaning of existing fields.

#### Scenario: Exact truth and candidate equality

- GIVEN a valid reviewed registry
- WHEN the builder emits the runtime manifest
- THEN every clip truth is exactly one of `Funk/R&B`, `Jazz`, `Blues`, `Rock`, `Pop`, or `Electronic` using the manifest's declared strings

#### Scenario: Existing evaluator pipeline input

- GIVEN a generated calibration manifest and reports produced for its clips
- WHEN the manifest is supplied to the existing tagging, fusion, and matrix workflows
- THEN each workflow can use the shared files and candidate set without any fusion-weight change

### Requirement: Local-only media handling

The calibration workflow MUST render only user-acquired local assets into a dedicated ignored output directory. The repository MUST NOT download external media, add remote-fetch behavior for corpus assets, or commit MIDI, audio, or other binary corpus media.

#### Scenario: Registry-only repository change

- GIVEN an approved calibration registry
- WHEN the repository is prepared for corpus construction
- THEN it contains metadata and acquisition guidance but no acquired media assets

#### Scenario: Local acquisition prerequisite

- GIVEN one or more registry acquisition paths are unavailable locally
- WHEN a user attempts to build the corpus
- THEN the workflow reports the unavailable prerequisite rather than fetching the asset

### Requirement: Per-class calibration report and trust gate

Judge reporting for a calibration corpus MUST provide deterministic per-class counts, top-1 accuracy, top-2 accuracy, mean true-label rank, and primary confusions. It MUST retain overall accuracy/chance and exact-binomial reporting.

For every class, the report MUST mark it **trusted for tuning** only when all of the following are true: top-1 accuracy is at least 50%, top-2 accuracy is at least 75%, and mean true-label rank is at most 2.5. A class that fails any one condition MUST be marked **untrusted for tuning**. An overall passing result MUST NOT override a failed class gate.

Primary confusions MUST identify the incorrect predicted class or classes most frequently selected for that true class; tied highest frequencies MUST be represented deterministically.

#### Scenario: Passing class gate

- GIVEN eight `Jazz` references with top-1 accuracy of 50%, top-2 accuracy of 75%, and mean true-label rank of 2.5
- WHEN the calibration report is generated
- THEN `Jazz` is marked trusted for tuning

#### Scenario: Overall success cannot mask a weak class

- GIVEN a report with passing overall metrics and a `Funk/R&B` class whose top-1 accuracy is below 50%
- WHEN the calibration report is generated
- THEN `Funk/R&B` is marked untrusted for tuning

#### Scenario: Deterministic tied primary confusions

- GIVEN a class has equal highest incorrect-prediction counts for two candidate labels
- WHEN the calibration report is generated
- THEN it reports both labels in a deterministic order

### Requirement: Balanced Essentia normalization boundary

Only the balanced six-class calibration corpus MAY establish Essentia normalization data. Generated calibration normalization data MAY be reused for unbalanced LIME sweeps, but an unbalanced LIME sweep MUST NOT establish or replace Essentia normalization data.

#### Scenario: Balanced calibration establishes normalization

- GIVEN a valid 48-track balanced calibration corpus
- WHEN Essentia calibration is run successfully
- THEN its normalization data is eligible to be saved for later reuse

#### Scenario: Unbalanced sweep cannot reset normalization

- GIVEN an unbalanced LIME sweep and previously saved calibration normalization data
- WHEN the sweep is tagged with Essentia
- THEN the workflow may reuse the saved data and does not establish new normalization data from the sweep

### Requirement: Auditable workflow and legacy compatibility

Documentation MUST describe acquisition, registry validation, corpus build, tagging, fusion, scoring, trust-gate interpretation, and reuse of saved Essentia normalization data for unbalanced LIME sweeps. It MUST state that calibration evidence is distinct from LIME variant selection and prompt-bias controls.

`tools/judge/reference-genre.mjs` MUST be retained and explicitly labelled as a non-authoritative heuristic experiment. It MUST NOT be represented as the reviewed calibration corpus or promoted as calibration evidence merely because it produces a reference manifest.

#### Scenario: Reviewer follows the calibration workflow

- GIVEN a reviewer has only the checked-in registry and documentation
- WHEN the reviewer follows the documented workflow with locally acquired assets and available prerequisites
- THEN the reviewer can validate, build, tag, fuse, score, and interpret the corpus without treating the legacy heuristic builder as authoritative

#### Scenario: Legacy experiment remains distinct

- GIVEN a user encounters `tools/judge/reference-genre.mjs`
- WHEN they consult its label or associated documentation
- THEN they are informed that its heuristic output is non-authoritative and cannot establish calibration trust

## Non-goals

- This change does not alter production composition, rendering, styles, palettes, candidate-genre behavior, or LIME sweep selection.
- This change does not alter ear-model parameters, ear-model weights, or fusion weights.
- This change does not expand the initial corpus beyond the six fixed labels or eight tracks per label.
- This change does not promote, delete, or reclassify the legacy heuristic reference builder.
