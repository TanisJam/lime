# Groove criteria — what "human" means here, in numbers

This document is the acceptance contract for LIME's rhythmic feel. Every target
below is measurable from symbolic MIDI alone by `tools/judge/groove-stats.mjs`,
so a claim about the music can be checked instead of argued about.

It exists because of a specific failure. LIME's genre judge is a stack of audio
models, and audio models score timbre and texture. None of them ever measured
whether the bass locks to the kick, whether anything lands off the beat, or
whether the performance is quantised to the grid. So those defects survived
every round of tuning — the judge could not see them, and the scores went up
anyway. The fix was not a better judge. It was measuring the notes.

## Two kinds of target, and why they are kept apart

**Measured targets** come from real, human-labelled reference recordings: the 48
songs in `tools/judge/calibration-registry.json` (Lakh MIDI Clean subset,
CC-BY-4.0), eight per genre, measured with the same tool that measures our
output. The medians are frozen in `tools/judge/groove-reference.json`. Same
ruler on both sides — a target means nothing otherwise.

**Literature targets** come from the research literature, and are used only
where the reference corpus cannot answer. That is not a fallback of
convenience; there are metrics the corpus is genuinely unfit to measure, and
using it anyway would encode its artefacts as our goals.

### Where the reference corpus must not be trusted

Lakh clean MIDI are largely quantised, step-sequenced transcriptions rather than
performance captures. Two metrics are therefore meaningless in it:

- **`ghost`** measures ~0.00 for every label, Funk included. Real funk is full of
  ghost notes; the transcriptions flattened them.
- **`swing`** measures 0.03 for Jazz. Real jazz swings hard. Same cause.

A third metric fails for the same underlying reason, and it is the subtlest of
the three: **`drum16th` and `bass16th` are meaningless for Jazz and Blues.** A
swung eighth sits at 2/3 of a beat, which snaps to 16th step 3 — an *odd* step —
while a straight eighth lands on step 2. The reference recordings for those two
genres had their swing quantised away, so all their eighths read as even and
their 16th-share collapses toward zero. LIME's jazz and blues genuinely swing,
so theirs reads high.

Comparing the two would "reward" **deleting LIME's swing** to match a reference
that lost its own — and tempo-dependent jazz swing is the single best-measured
criterion in the whole study (Friberg & Sundström 2002). `groove-gap.mjs`
prints a dash for those cells rather than a target.

The lesson generalises: whenever a metric disagrees strongly for exactly the
swung genres, suspect the corpus before suspecting the engine.

`timingDevMs` does survive — its ordering is musically right (Electronic most
quantised at 3.07 ms, Blues most human at 19.2 ms) — but see the warning below
before treating the real magnitude as a goal.

## The most important finding: more jitter is not better

The obvious reading of our baseline was "real music has 9.6–19.2 ms of timing
deviation, LIME has 0.4 ms, so add ~14 ms of jitter." **The literature does not
support that, and following it would likely have made the output worse.**

- Senn et al. (2016) found perceived groove peaks near **40% of real-human
  deviation magnitude**, and *falls* beyond roughly 1.4–1.6× it.
- Davies et al. (2013) found fully quantised versions rated **highest** in most
  non-jazz genres.

So the target for random jitter is deliberately *below* what real music shows.
And it is per-genre: **Electronic's discriminating feature is grid-perfect
quantisation** — for that genre, near-zero deviation is correct, not a defect.

What the evidence does support strongly is **systematic** timing — swing ratios,
laid-back bias, metrical accent — rather than random noise. Structure, not
jitter, is what reads as human.

Because the measurement cannot adjudicate this one, **changes to jitter
magnitude must be confirmed by ear**, not by the number moving. A blind
listening test already caught one defect the whole model stack missed.

## Measured targets

Medians over 8 real recordings per genre. Source: `groove-reference.json`.

| metric | Funk | Jazz | Blues | Rock | Pop | Electronic |
|---|---|---|---|---|---|---|
| `notesPerBeat` | 7.92 | 5.01 | 6.11 | 4.83 | 7.33 | 4.30 |
| `drumHitsPerBar` | 18.1 | 18.2 | 16.6 | 15.6 | 21.7 | 30.5 |
| `drumOffbeat` | 0.48 | 0.38 | 0.43 | 0.46 | 0.47 | 0.62 |
| `drum16th` | 0.28 | 0.06 | 0.21 | 0.03 | 0.12 | 0.28 |
| `backbeat` | 0.63 | 0.40 | 0.55 | 0.46 | 0.81 | 0.29 |
| `bassOffbeat` | 0.53 | 0.38 | 0.17 | 0.53 | 0.16 | 0.63 |
| `bass16th` | 0.20 | 0.05 | 0.12 | 0.08 | 0.00 | 0.10 |
| `bassKickLock` | 0.74 | 0.86 | 0.89 | 0.66 | 0.69 | 0.31 |
| `velStd` | 0.17 | 0.17 | 0.15 | 0.14 | 0.16 | 0.18 |

Two of these deserve comment. **`backbeat` is not 1.00 anywhere** — real
drummers put snares in other places too, and a rigid 1.00 is the signature of a
caricature. And **`bassKickLock` is high everywhere except Electronic** (0.66–0.89):
real rhythm sections interlock, they do not merely share a downbeat.

## Literature targets

Used where the corpus cannot answer. Confidence is carried deliberately — a
low-confidence target is a hypothesis to test by ear, not a number to hit.

| metric | target | confidence | source |
|---|---|---|---|
| Swing ratio, jazz (tempo-dependent) | ≈3.5:1 below 120 bpm → ≈2:1 at 160–200 bpm → ≈1:1 by ~300 bpm | **high** | Friberg & Sundström 2002 |
| Swing short-note floor | short note stays ≥ ~100 ms at any tempo | **high** | Friberg & Sundström 2002 |
| Shuffle ratio, blues | ≈2:1 triplet feel | medium | pedagogical convention |
| Swing ratio, funk 16ths | 1.07–1.8:1 (mild) | medium | ZGMTH corpus study |
| Random jitter magnitude | ~40% of real-human SD, i.e. **≈5–7 ms**, never above ~1.4× human | medium | Senn et al. 2016 |
| Jitter scaling | proportional to the note's IOI, not a fixed tick count | medium | Repp-line findings |
| Percussion jitter, tight groove | ≈5–10 ms SD; exactly 0 is unsupported | medium | Räsänen et al. 2024 |
| Electronic jitter | near-zero — grid-perfect quantisation is the genre's discriminator | **high** | genre research; corpus (3.07 ms) |
| Accent velocity ratio | ≈2:1 accented vs unaccented | medium | Räsänen et al. 2024 |
| Ghost-note velocity | ~10–20% of backbeat velocity | low | practitioner consensus only |
| Laid-back / pushed offset | ≈16–40 ms between feels | medium | RITMO studies |
| Downbeat deviation gradient | largest at the downbeat (~25–30 ms), smaller at weaker positions | medium | Peter et al. 2023 |
| Staccato / repeated / legato duration ratio | ≈40% / ≈60% / >100% of IOI | medium | Bresin & Battel 2000 |

## Discriminating features

The one or two statistics that separate each genre from the other five. These
matter more than the descriptive averages: a genre that hits every average and
misses its discriminator does not read as that genre.

| genre | discriminator | secondary |
|---|---|---|
| **Funk** | mild 16th-note swing plus audible ghost notes | static dominant-7/9 vamp harmony |
| **Jazz** | tempo-dependent 8th swing ratio (best-measured statistic in the whole study) | high harmonic extension density |
| **Blues** | dominant-7 on I, IV *and* V inside a 12-bar cycle — no other genre does this | shuffle ratio ≈2:1 |
| **Rock** | chord-root/quality distribution (I/IV/V/♭VII/VI ≈ 87%, 94.1% root position) | Syncopation Quotient ≈0.228 |
| **Pop** | I–V–vi–IV family dominance with simple triads (65–85.7% triadic) | moderate tempo, non-four-on-floor kick |
| **Electronic** | four-on-the-floor kick plus grid-perfect quantisation | very slow harmonic rhythm (multi-bar vamps) |

## Evidence quality — read before trusting a number

Not every row above is equally earned.

- **Strongest**: De Clercq & Temperley 2011 (rock harmony, n=100) and Friberg &
  Sundström 2002 (jazz swing). Both are measured corpus studies.
- **Weakest**: Blues has no corpus study at all — its criteria are pedagogical
  convention. Ghost-note velocity ranges have no peer-reviewed quantification.
  The shuffle ratio and the pre-backbeat lengthening pattern come from a single
  song (n=1), so they are indicative, not norms.
- **Contested**: whether microtiming magnitude improves perceived quality at all
  (see above). Expert and non-expert listeners also disagree sharply on
  sensitivity thresholds, so any single ceiling is audience-dependent.

## Two measurement traps

Both of these hid real defects for a long time. Neither is obvious.

**Strip velocity before asking whether a groove varies.** Counting distinct
bars *including* velocity showed 92–96 out of 96 for every genre — healthy
variation, apparently. It was an illusion: the phrase plan varies velocities
every bar while the rhythm underneath never changes. With velocity stripped,
six genres turned out to be playing **exactly one drum pattern, ninety-six
times**. The same count would have reported the fix for that as a no-op too.

**Snap onsets to a coarse grid before comparing positions.** Now that the
humanisation layer displaces every onset by a few milliseconds, no two bars are
ever byte-identical, so any position comparison must snap first (a 60-tick,
32nd-note grid is the convention here — well above worst-case jitter, well
below the spacing between genuinely distinct positions). Without it, jitter
reads as rhythmic variety and every regression looks like an improvement.

`tools/judge/groove-gap.mjs` does both correctly. Prefer it over hand-rolled
counting.

## Deliberately open

Two gaps are left open on purpose. Both are recorded here so nobody "fixes"
them without knowing what they are trading away.

**Funk's syncopation overshoot** — `bassOffbeat` 0.79 against 0.53, `bass16th`
0.40 against 0.20, `drumOffbeat` 0.64 against 0.48.

The cause is understood exactly: the funk bass onset set is `{0, 3, 6, 10, 13}`,
so four of five onsets fall off the quarter (0.80) and two of five land on odd
16ths (0.40) — matching the measurements to two decimals. A set of
`{0, 3, 6, 8, 10, 12}` would give 0.50 and 0.17 while keeping the `[0, 6]`
kick anchor intact.

It is left alone because **Funk is the one genre a human has confirmed by ear.**
Changing it to chase a number is precisely the failure this document exists to
prevent. It needs a listening pass, not a patch.

**Rock's `velStd`** — 0.19 against 0.14, at the tolerance boundary. Reducing
the metrical accent depth was tried and moved it not at all: `velStd` is the
spread across every voice, dominated by the generators' own choices (a hat at
0.34 against a kick at 0.78), not by the accent riding on top. Closing it means
narrowing the hat-to-kick gap — flattening the mix — for 0.05 on a marginal
metric. The corpus was checked as the alternative explanation and cleared: the
reference recordings carry a median of 72–96 distinct velocity values per song,
so unlike `ghost` this is real data.

## How to use this

1. Run `node tools/judge/groove-gap.mjs`. It renders, measures, and prints only
   the metrics that are off target, largest gap first.
2. Fix the largest gap **structurally** — in the StylePack or the generator, not
   as a local patch that can drift back. A knob that only the demo sets is not a
   fix; the library's own output is what the criteria are about.
3. Re-run it. **A passing unit test is not evidence that the music changed** —
   it says the code does what it was told, not that the output improved.
4. For anything the measurement cannot adjudicate — jitter magnitude above all —
   confirm by ear before believing it.
5. When a metric moves but you cannot explain *why*, stop and find out. A number
   that improved for a reason you do not understand will regress for a reason
   you do not understand.
