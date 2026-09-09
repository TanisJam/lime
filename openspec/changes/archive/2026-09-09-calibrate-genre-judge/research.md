# Research: Calibrate genre judge

```yaml
schema: gentle-ai.sdd-research/v1
revision: 2
outcome: supplemental-research-complete
sdd-admission: blocked-by-runtime-grant-policy
```

## Decision

Use the Lakh Clean MIDI subset as the initial six-class metadata source for this internal calibration corpus. The user explicitly authorized internal judge training without treating redistribution licensing as a release gate. The registry still records the dataset licence and the underlying-rights caveat truthfully; no claim of CC0/public-domain status is made.

This source provides eight exact-labelled candidates for each fixed class, unlike the Groove MIDI Dataset, whose verified `blues` and `dance` coverage is too small for the required 8-per-class matrix.

## Verified sources

1. **Lakh MIDI Dataset — official project page**  
   https://colinraffel.com/projects/lmd/
   - Describes LMD-full, the Clean MIDI subset, the clean subset's artist/title paths, and the dataset's CC BY 4.0 distribution licence.
   - States that files were scraped from publicly available Internet sources and that attribution to each underlying MIDI author is not consistently available.
   - Warns that MIDI may contain optional lyrics and other annotations; those fields therefore require per-file review.
2. **Lakh Clean Analysis metadata**  
   https://lakhcleananalysis.sourceforge.io/  
   https://sourceforge.net/projects/lakhcleananalysis/files/genre.tsv/download  
   https://sourceforge.net/projects/lakhcleananalysis/files/lakhdb.csv/download
   - The downloaded metadata exposes artist/title paths, source genre, defective-file flag, track/channel counts, BPM, and event lengths.
   - The target genres have ample exact-label coverage in the metadata, including Blues, Electronic, Funk, Jazz, Pop, and Rock. The metadata is manually/Google-derived and may be noisy; it is evidence for candidate selection, not an independent ground truth.
3. **Groove MIDI Dataset — comparison source**  
   https://magenta.withgoogle.com/datasets/groove
   - Officially describes 1,150 human-performed drum MIDI files, drummer-provided styles, and CC BY 4.0 licensing.
   - Its style list includes blues, funk, jazz, pop, rock, and dance, but the archive inventory has only four `blues-shuffle` and seven `dance-*` records. It is a strong instrumentality control but cannot alone satisfy this exact balanced matrix.
4. **CC0 alternatives searched**  
   https://opengameart.org/content/procedural-midi-music  
   https://opengameart.org/content/airos-cc0-music-midi  
   https://carf-coder.itch.io/keynata-commons-music-pack
   - These provide useful CC0 material, but the verified genre coverage is too narrow or insufficiently annotated for this six-class, eight-per-class matrix.

## Candidate curation and audit

The parent research process downloaded the official LMD Clean archive to a temporary directory only; no media was copied into the repository. It joined the official clean archive paths to `lakhdb.csv`, selected eight distinct artists for each exact source genre, rejected defective records, and statically inspected all 48 selected MIDI files.

The per-file instrumental screen required:

- a valid MIDI header and non-zero note events;
- zero MIDI lyric events; and
- no track/meta marker containing `vocal(s)`, `voice`, `words`, `karaoke`, `chant`, `choir`, or `lyric`.

The selected records are recorded in `tools/judge/calibration-registry.json` with stable IDs, normalized local paths, source collection IDs, dataset licence evidence, exact source genre rationale, static instrumental-review evidence, and selection notes. The registry has exactly 48 items and exactly eight items for each fixed candidate, in the declared candidate order.

This is a static MIDI audit, not a claim that the original songs are free of vocal source material or that the metadata labels are infallible. A local integration run may still reject an asset after acquisition if the file is missing, malformed, or fails a deeper review.

## Licensing and non-goals

The user authorized local/internal use for judge training. The registry therefore permits the documented LMD distribution licence for this research slice, but records `CC-BY-4.0` as the dataset licence and explicitly warns that underlying scraped-file rights may require additional review. No media bytes, download instructions, checksums of local media, or generated audio are committed. This change does not authorize redistribution or alter evaluator/model/fusion behavior.

## Readiness

The supplemental parent research is sufficient to begin PR-1 implementation against the registry. The installed SDD research executor still reported `blocked` because this runtime declares no `open-web` evidence grant; that runtime admission result is preserved in the pre-proposal state and is distinct from the directly captured research evidence above. PR-1 must continue to validate the registry and its static audit fields before any rendering or evaluator calibration claim.
