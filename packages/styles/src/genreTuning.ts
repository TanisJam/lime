import type {
  StylePack,
  Mode,
  BassStyle,
  BassGrooveStyle,
  HarmonyStyle,
  MelodyStyle,
  RhythmStyle,
  FeelStyle,
} from "@lime/core";

/**
 * Canonical per-genre tuning, layered on top of a genre's base StylePack —
 * corpus-derived (rock) or authored (genres.ts).
 *
 * This used to be an override table maintained BY HAND in three separate
 * application-layer files (`tools/judge/genreTables.mjs`, the demo's
 * `main.ts` and its offline-render `render.ts`), with a comment asking
 * whoever touched one to "mirror the keeper" into the others. They drifted,
 * and the drift was not cosmetic:
 *
 *  - `grooveVariation` lived only in those tables, for rock and metal. The
 *    other ten genres ran at 0 in the LIBRARY itself, so every ghost note
 *    and fill in the percussion grammar was unreachable there — the
 *    library's own output was a caricature while only the demo sounded
 *    right (see GROOVE-CRITERIA.md).
 *  - Rock has no authored StylePack in genres.ts at all — it is
 *    corpus-derived — so its entire genre definition lived only in these
 *    tables and could not be configured from the library.
 *  - One override silently discarded the corpus bass pack's own
 *    `"root-drive"` for `"default"` (see {@link ROCK_TUNING} below).
 *
 * This module is the fix: the tuning lives here, once, and
 * {@link applyGenreTuning} is the one place it gets merged onto a base pack.
 * All three consumers import from here instead of restating it.
 */
export interface GenreTuning {
  readonly defaultMode?: Mode;
  readonly bassStyle?: BassStyle;
  readonly bassGroove?: BassGrooveStyle;
  readonly harmony?: HarmonyStyle;
  readonly melody?: MelodyStyle;
  readonly rhythm?: RhythmStyle;
  readonly feel?: FeelStyle;
}

/**
 * Rock's base pack is corpus-derived, generated at
 * `packages/corpus/generated/genre-rock-pop.json`. That JSON carries
 * genuinely corpus-derived data (`rhythm.onsetProfile`,
 * `melody.intervalWeights`/`durationWeights`, `harmony.transitions`) that a
 * corpus rebuild regenerates — it must never be hand-authored. Everything
 * below is the hand-tuned delta on top of it: real listening decisions, kept
 * out of the corpus JSON so a rebuild can't clobber them.
 */
export const ROCK_TUNING: GenreTuning = {
  // The corpus rock pack came out in major, which reads emotionally "happy";
  // force natural minor so it lands dark/aggressive as the genre intends.
  defaultMode: "naturalMinor",
  // The corpus matrix circled back to the tonic every chord (repetitive), so
  // give it harmonyMotion so the progression travels further before
  // resolving instead of circling home every chord.
  harmony: { harmonyMotion: 0.8 },
  // The corpus rock lead was ~75% sixteenth/eighth notes → a choppy, nervous
  // melody. Rebalance toward sustained values so the lead sings on every
  // seed, with a touch of motifDevelopment so it evolves instead of
  // restating one shape.
  melody: {
    motifDevelopment: 0.3,
    durationWeights: {
      whole: 1,
      half: 7,
      dottedQuarter: 3,
      quarter: 9,
      dottedEighth: 0.2,
      eighth: 0.5,
      sixteenth: 0.1,
    },
  },
  // Rock has no authored StylePack (unlike metal/pop/jazz), so without this
  // its rhythm.grooveVariation is simply absent — the percussion grammar
  // gets zero variation and plays one identical bar 96 times in a row (the
  // defect this module exists to fix; see GROOVE-CRITERIA.md).
  rhythm: { grooveVariation: 0.5 },
  // Deliberately no bassStyle override: an earlier version of this table set
  // `bassStyle: "default"` here, silently discarding the corpus pack's own
  // `"root-drive"`. MEASURED (not confirmed by ear — GROOVE-CRITERIA.md is
  // explicit that a moving number alone doesn't settle a question of feel):
  // dropping that override moves bassOffbeat 0.26 → 0.44 (target 0.53) and
  // bassOnsetsPerBar 3.74 → 4.24 (target 5.71), against a marginal
  // bassKickLock regression, 0.46 → 0.42 (target 0.66, off-target either
  // way). Net improvement. Revisit if a listening pass disagrees.
  //
  // Rock and pop both use `root-drive`, but rock's bass sits further off the
  // beat (measured bassOffbeat target 0.53 vs pop's 0.16) while needing a
  // comparable kick-lock (0.66 vs pop's 0.69, GROOVE-CRITERIA.md) — a driving
  // rock eighth-note pulse, not pop's tighter pocket. High `syncopation`
  // keeps the off-anchor eighths busy; high `kickLock` leans them onto the
  // "and of 3" (the same spot the backbeat's own extra kick push lands on)
  // and keeps the on-beat filler minimal, so the line locks hardest exactly
  // where the kick does instead of spreading evenly across the bar.
  bassGroove: { syncopation: 0.45, kickLock: 0.65 },
  // Deliberately no `feel` override, and rock's velStd is a known marginal
  // miss: 0.19-0.20 measured against a real 0.14, the evenest of the six
  // reference genres.
  //
  // Pulling FeelStyle.accentDepth from 0.6 down to 0.32 was tried and moved
  // the number not at all. velStd is the spread across EVERY voice, and it is
  // dominated by the gap between the generators' own choices — a hat at 0.34
  // against a kick at 0.78 — not by the metrical accent riding on top. So
  // closing it would mean narrowing the hat-to-kick gap, i.e. flattening the
  // mix, to chase 0.05 on a metric already at the tolerance boundary.
  //
  // (The corpus was checked as the alternative explanation and cleared: the
  // reference recordings carry a median of 72-96 distinct velocity values per
  // song, so this is real data, not the flattened-transcription artifact that
  // makes `ghost` and `swing` unusable. A handful of files are flattened but
  // they do not move the median.)
};

/**
 * Metal is structurally rock-like (minor, power chords, backbeat). Its
 * groove and pentatonic character already come from its own authored
 * StylePack (`metalPack` in genres.ts) — only the harmony needs a nudge
 * here, to move it off the tonic the same way rock does.
 */
export const METAL_TUNING: GenreTuning = {
  harmony: { harmonyMotion: 0.7 },
};

/**
 * Latin reads harmonically static in the corpus; a moderate push helps
 * without de-genre-ing the clave groove (already set on `latinPack`).
 */
export const LATIN_TUNING: GenreTuning = {
  harmony: { harmonyMotion: 0.5 },
};

/** Folk reads harmonically static too; the same moderate push. */
export const FOLK_TUNING: GenreTuning = {
  harmony: { harmonyMotion: 0.5 },
};

/**
 * Blues corpus transitions wandered (III/VI/VII); force a I-IV-V progression
 * so it reads as a 12-bar blues. Dominant 7ths still come from the base
 * `bluesPack`'s mixolydian+seventh; dorian here reads darker/sadder than
 * that default.
 */
export const BLUES_TUNING: GenreTuning = {
  defaultMode: "dorian",
  harmony: {
    transitions: {
      1: [
        { degree: 4, weight: 3 },
        { degree: 1, weight: 2.5 },
        { degree: 5, weight: 1 },
      ],
      4: [
        { degree: 1, weight: 3 },
        { degree: 4, weight: 1.5 },
        { degree: 5, weight: 1 },
      ],
      5: [
        { degree: 4, weight: 2.5 },
        { degree: 1, weight: 2.5 },
      ],
    },
  },
};

/** Genre id → canonical tuning. The only place this mapping is declared. */
export const GENRE_TUNING: Record<string, GenreTuning> = {
  "genre-rock-pop": ROCK_TUNING,
  "genre-metal": METAL_TUNING,
  "genre-latin": LATIN_TUNING,
  "genre-folk": FOLK_TUNING,
  "genre-blues": BLUES_TUNING,
};

/**
 * Merge a genre's canonical tuning onto its base StylePack — corpus-derived
 * (rock) or authored (metal/latin/folk/blues). A genre with no entry in
 * {@link GENRE_TUNING} is returned unchanged.
 *
 * This is the one place "base pack + tuning = the genre's real StylePack" is
 * expressed. Every consumer (the demo, its offline render page, the judge
 * tooling) calls this instead of hand-copying the deep merge.
 */
export function applyGenreTuning(base: StylePack): StylePack {
  const tuning = GENRE_TUNING[base.id];
  if (!tuning) return base;
  return {
    ...base,
    ...(tuning.defaultMode !== undefined ? { defaultMode: tuning.defaultMode } : {}),
    ...(tuning.bassStyle !== undefined ? { bassStyle: tuning.bassStyle } : {}),
    ...(tuning.bassGroove !== undefined ? { bassGroove: tuning.bassGroove } : {}),
    ...(tuning.harmony ? { harmony: { ...base.harmony, ...tuning.harmony } } : {}),
    ...(tuning.melody ? { melody: { ...base.melody, ...tuning.melody } } : {}),
    ...(tuning.rhythm ? { rhythm: { ...base.rhythm, ...tuning.rhythm } } : {}),
    ...(tuning.feel ? { feel: tuning.feel } : {}),
  };
}
