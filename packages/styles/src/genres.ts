import type {
  StylePack,
  Mode,
  ChordStyle,
  BassStyle,
  BassGrooveStyle,
  GrooveStyle,
  MelodyScale,
  MotionStyle,
  InstrumentationConfig,
  EnsembleStyle,
  FeelStyle,
} from "@lime/core";

/**
 * Authored genre StylePacks.
 *
 * Most of the twelve target genres aren't in the MIDI corpus (see GENRES.md §2),
 * so their grammar is authored from the validated fingerprints rather than
 * derived: scale, chord realization, groove, bass movement, and tempo. The
 * renderer supplies each genre's timbre palette; this file supplies its
 * composition character. Corpus-backed genres (rock, classical) keep their
 * derived packs — these fill the gaps and give every genre a consistent shape.
 */

/** A neutral instrumentation base; genre timbre comes from the renderer palette. */
const BASE_INSTRUMENTATION: InstrumentationConfig = {
  reverbWet: 0.22,
  reverbDecay: 2.4,
  delayWet: 0.05,
  percussionGain: 0.6,
  stereoWidth: 1,
  masterGain: 0.9,
  percussionReverbSend: 0.12,
  pad: { oscillator: "sawtooth", attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.5, filterCutoff: 3000, gain: 0.3 },
  bass: { oscillator: "sawtooth", attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.25, filterCutoff: 1800, gain: 0.46 },
  melody: { oscillator: "sawtooth", attack: 0.006, decay: 0.2, sustain: 0.6, release: 0.25, filterCutoff: 3500, gain: 0.32 },
};

/** Compact per-genre spec → StylePack (the fingerprint's composition knobs). */
interface GenreSpec {
  readonly id: string;
  readonly modes: readonly Mode[];
  readonly defaultMode: Mode;
  readonly keyPc: number;
  readonly tempoRange: readonly [number, number];
  readonly chordStyle?: ChordStyle;
  readonly bassStyle?: BassStyle;
  /**
   * Per-genre syncopation/kick-lock shaping for `bassStyle`'s own grammar
   * (see StylePack.ts BassGrooveStyle). Omit to keep that grammar's
   * unconfigured behaviour.
   */
  readonly bassGroove?: BassGrooveStyle;
  readonly groove?: GrooveStyle;
  /**
   * How much the named groove varies bar to bar, 0..1 — threaded straight into
   * `rhythm.grooveVariation` (see StylePack.ts). Omit for 0 (today's fixed,
   * unvarying pattern). A groove-less genre (`groove` unset or `"none"`) never
   * reads this, so leaving it off there documents nothing.
   */
  readonly grooveVariation?: number;
  readonly melodyScale?: MelodyScale;
  readonly motion?: MotionStyle;
  readonly phraseLengthBars?: 4 | 8;
  readonly ensemble?: EnsembleStyle;
  /** Per-voice feel; omit to fall back to core's DEFAULT_FEEL (see StylePack.ts). */
  readonly feel?: FeelStyle;
}

function genrePack(s: GenreSpec): StylePack {
  return {
    id: s.id,
    modes: s.modes,
    defaultMode: s.defaultMode,
    keyPc: s.keyPc,
    phraseLengthBars: s.phraseLengthBars ?? 8,
    tempoRange: s.tempoRange,
    instrumentation: BASE_INSTRUMENTATION,
    chordStyle: s.chordStyle,
    bassStyle: s.bassStyle,
    bassGroove: s.bassGroove,
    motion: s.motion,
    rhythm: s.groove
      ? { groove: s.groove, grooveVariation: s.grooveVariation }
      : undefined,
    melody: s.melodyScale ? { scale: s.melodyScale } : undefined,
    ensemble: s.ensemble,
    feel: s.feel,
  };
}

/** Metal — heavier, faster rock: power chords, minor pentatonic, driving. */
export const metalPack = genrePack({
  id: "genre-metal", modes: ["naturalMinor"], defaultMode: "naturalMinor", keyPc: 4,
  tempoRange: [140, 180], chordStyle: "power", bassStyle: "root-drive", groove: "backbeat",
  melodyScale: "minor-pentatonic",
  // The proven rock/metal calibration anchor (previously only set at the app
  // layer — see PercussionGenerator.backbeat()); kept as-is here.
  grooveVariation: 0.4,
});

/** Pop — bright diatonic four-chord loops over a straight backbeat. */
export const popPack = genrePack({
  id: "genre-pop", modes: ["major", "naturalMinor"], defaultMode: "major", keyPc: 0,
  tempoRange: [100, 128], chordStyle: "triad", bassStyle: "root-drive", groove: "backbeat",
  motion: "arp",
  // Pop's bass sits ON the beat far more than it syncopates — measured
  // bassOffbeat 0.16, the lowest of any genre, against a still-solid
  // bassKickLock 0.69 (GROOVE-CRITERIA.md: "pop bass sits on the beat, it
  // does not syncopate"). Low `syncopation` keeps the driving-eighths grammar
  // mostly to the two structural anchors (plus a modest on-beat filler);
  // `kickLock` only has to do a little extra work locking the rest, since
  // the sparse pocket already favours the anchors on its own.
  bassGroove: { syncopation: 0.07, kickLock: 0.165 },
  // Pop's measured backbeat is the highest of any genre (0.81,
  // GROOVE-CRITERIA.md) — pop drumming really is close to rigid, but not
  // literally 1.00; the fractional part below (0.15) gives occasional
  // fills/ghosts without losing the driving, dependable pop pocket. That is
  // deliberately unchanged from an earlier pass: backbeat()'s own
  // ghost-snare density (shared with Rock/Metal) dilutes pop's tight
  // backbeat fast, so pop needs little of it.
  //
  // The integer part (>= 1) is a second, independent signal: it opts pop
  // into backbeat()'s extra density layer (tambourine-like shaker + a light
  // hat ghost) without touching the backbeat looseness above. Pop measures
  // far busier than Rock (21.7 vs 15.6 hits/bar) despite the tighter
  // backbeat, and those two needs don't fit one scalar read the same way in
  // both places — see `looseness` in `PercussionGenerator.backbeat()`.
  grooveVariation: 1.15,
});

/**
 * The loosest feel in the set — jazz/blues rhythm sections play furthest from
 * the grid of anything LIME does, plus a laid-back drag on bass and kit (the
 * snare/hats live on the shared `percussion` voice, so the offset covers the
 * whole kit rather than just the snare — see Humanizer.ts). Jitter stays near
 * the top of the literature-supported band (≈7-8ms, not the 14-19ms the raw
 * corpus shows — see GROOVE-CRITERIA.md's "more jitter is not better").
 */
const LOOSE_SWUNG_FEEL: FeelStyle = {
  voices: {
    melody: { jitterMs: 8, offsetMs: 0 },
    bass: { jitterMs: 8, offsetMs: 12 },
    pad: { jitterMs: 7, offsetMs: 0 },
    motion: { jitterMs: 8, offsetMs: 0 },
    percussion: { jitterMs: 7, offsetMs: 10 },
  },
  accentDepth: 0.6,
};

/** Jazz — ii–V–I sevenths, swung ride, walking bass, comping stabs. */
export const jazzPack = genrePack({
  id: "genre-jazz", modes: ["major", "dorian", "mixolydian"], defaultMode: "major", keyPc: 0,
  tempoRange: [90, 180], chordStyle: "seventh", bassStyle: "walking", groove: "swing",
  motion: "stab", feel: LOOSE_SWUNG_FEEL,
  // Jazz and blues share `bassStyle: "walking"`, but the walked line should
  // NOT sound the same: jazz wants both a tighter kick-lock (0.86) AND more
  // off-beat motion (0.38) than blues (GROOVE-CRITERIA.md) — the line lands
  // with the kick on the strong beats and moves more in between. High
  // `kickLock` keeps the four quarter-note anchors reliably present (rarely
  // resting) and leans the walk's extra pickup onto the "and of 3", the same
  // spot PercussionGenerator.swing()'s dropped bombs land on; `syncopation`
  // then adds the eighth-note skips/chromatic approach/sixteenth pickup that
  // make it read as a real walked line rather than four quarters.
  bassGroove: { syncopation: 0.34, kickLock: 0.82 },
  // The drummer is a member of the band — brushes on the kit at every dynamic.
  ensemble: { percussion: { on: 0.22, off: 0.12 } },
  // Jazz has the lowest measured backbeat of any genre (0.40,
  // GROOVE-CRITERIA.md) and is the least pattern-locked drumming style here —
  // a high value so the ride/kick/snare all breathe bar to bar.
  grooveVariation: 0.85,
});

/** Blues — dominant sevenths, shuffle, walking bass, blues scale. */
export const bluesPack = genrePack({
  id: "genre-blues", modes: ["mixolydian", "major"], defaultMode: "mixolydian", keyPc: 4,
  tempoRange: [70, 120], chordStyle: "seventh", bassStyle: "walking", groove: "shuffle",
  melodyScale: "blues", feel: LOOSE_SWUNG_FEEL,
  // Unlike jazz, blues wants BOTH the tightest kick-lock of the set (0.89)
  // AND the lowest off-beat share of the two walking genres (0.17,
  // GROOVE-CRITERIA.md) — a consistent, unhurried shuffle pocket rather than
  // jazz's busier interplay. Low `syncopation` keeps the walk close to plain
  // quarters (few skips/chromatic approaches); low-moderate `kickLock` mostly
  // just keeps the four anchors reliably present rather than reaching for
  // the extra "and of 3" pickup jazz leans on.
  bassGroove: { syncopation: 0.1, kickLock: 0.16 },
  // The drummer is a member of the band — present through the shuffle at any energy.
  ensemble: { percussion: { on: 0.22, off: 0.12 } },
  // Measured backbeat 0.55 (GROOVE-CRITERIA.md) — a shuffle groove sits
  // between jazz's looseness and rock's discipline.
  grooveVariation: 0.6,
});

/** Hip-hop — minor loops, boom-bap half-time, sub bass, pentatonic. */
export const hiphopPack = genrePack({
  id: "genre-hiphop", modes: ["naturalMinor", "dorian"], defaultMode: "naturalMinor", keyPc: 0,
  tempoRange: [82, 96], chordStyle: "seventh", bassStyle: "sub", groove: "boom-bap",
  melodyScale: "minor-pentatonic", motion: "arp", phraseLengthBars: 4,
  // No measured target (hip-hop is outside the six calibrated genres) — a
  // moderate value keyed to the chopped-breakbeat feel described in
  // PercussionGenerator.boomBap().
  grooveVariation: 0.55,
});

/**
 * Electronic's timing feel: (near) zero on purpose, not an oversight.
 * Four-on-the-floor plus grid-perfect quantisation IS the genre's
 * discriminating feature (GROOVE-CRITERIA.md); giving it the default human
 * jitter would blur exactly the thing that makes it read as electronic.
 * Velocity accent is kept modest (not disabled) — the kick still wants to
 * feel like a pulse, just not a wandering one.
 */
const GRID_PERFECT_FEEL: FeelStyle = {
  voices: {
    melody: { jitterMs: 0, offsetMs: 0 },
    bass: { jitterMs: 0, offsetMs: 0 },
    pad: { jitterMs: 0, offsetMs: 0 },
    motion: { jitterMs: 0, offsetMs: 0 },
    percussion: { jitterMs: 0, offsetMs: 0 },
  },
  accentDepth: 0.5,
};

/** Electrónica — minor riffs, four-on-the-floor, sub bass, arps. */
export const electronicPack = genrePack({
  id: "genre-electronic", modes: ["naturalMinor", "dorian"], defaultMode: "naturalMinor", keyPc: 9,
  tempoRange: [120, 130], chordStyle: "triad", bassStyle: "sub", groove: "four-on-floor",
  melodyScale: "minor-pentatonic", motion: "arp", feel: GRID_PERFECT_FEEL,
  // Measured backbeat is the lowest of any genre (0.29, GROOVE-CRITERIA.md) —
  // real EDM claps roll and build far more than a bare 2-&-4 clap. The kick
  // itself never varies (see fourOnFloor()); this only ever touches the
  // open-hat accent and how far the clap/shaker roll fills in, which is
  // where all the movement has to come from, so it needs a high value to
  // move the needle at all.
  grooveVariation: 0.85,
});

/**
 * Folk — modal, open chords, drones, no kit.
 *
 * No ensemble override: `groove: "none"` means the percussion generator emits
 * nothing whatever the gate says, so lowering the gate here would only look
 * like a decision. Folk is also absent from the calibration corpus, so there is
 * no measured target to give it a groove against — earn one first.
 */
export const folkPack = genrePack({
  id: "genre-folk", modes: ["dorian", "mixolydian", "major"], defaultMode: "dorian", keyPc: 7,
  tempoRange: [80, 120], chordStyle: "triad", groove: "none",
});

/** Latina — sevenths, clave, anticipated tumbao bass. */
export const latinPack = genrePack({
  id: "genre-latin", modes: ["major", "naturalMinor"], defaultMode: "major", keyPc: 2,
  tempoRange: [90, 120], chordStyle: "seventh", bassStyle: "montuno", groove: "clave",
  motion: "ostinato",
  // No measured target — latin isn't a calibrated genre and the clave metric
  // (there's no true backbeat "snare") doesn't apply. Moderate: the clave
  // figure itself never varies (see clave()), so this only moves the conga
  // ornaments and the shaker bed.
  grooveVariation: 0.5,
});

/**
 * Funk's feel: precision plus a slight drag, not looseness. Jitter stays
 * tighter than the default (this groove lives and dies by the pocket), but
 * bass and kit lean a few ms behind the beat — the "laid-back" component the
 * literature backs most strongly, and what actually reads as funk rather
 * than just "quantised with noise added".
 */
const FUNK_FEEL: FeelStyle = {
  voices: {
    melody: { jitterMs: 4, offsetMs: 0 },
    bass: { jitterMs: 4, offsetMs: 8 },
    pad: { jitterMs: 4, offsetMs: 0 },
    motion: { jitterMs: 4, offsetMs: 4 },
    percussion: { jitterMs: 4, offsetMs: 6 },
  },
  accentDepth: 0.7,
};

/** R&B / soul / funk — extended chords, 16th funk groove, funk bass. */
export const funkPack = genrePack({
  id: "genre-funk", modes: ["dorian", "mixolydian"], defaultMode: "dorian", keyPc: 4,
  tempoRange: [95, 120], chordStyle: "seventh", bassStyle: "funk", groove: "funk",
  melodyScale: "minor-pentatonic", motion: "stab", feel: FUNK_FEEL,
  // Measured backbeat 0.63 (GROOVE-CRITERIA.md) plus the genre's real
  // discriminator the corpus can't show: dense ghost notes (see funk() and
  // the "ghost" note in GROOVE-CRITERIA.md). High, but the funk() ghost
  // probabilities themselves also matter more than this knob alone.
  grooveVariation: 0.75,
  // Grounded, from a blind listening test — see GROOVE-CRITERIA.md, "Deliberately
  // open" → resolved. The pushed line (syncopation >= 0.6, onsets {0,3,6,10,13})
  // overshoots real funk (bassOffbeat 0.79 against 0.53, bass16th 0.40 against
  // 0.20) while the grounded one ({0,3,6,8,10,12}) lands on the reference (0.50,
  // 0.17). The listener preferred neither over the other across 8 clips, and the
  // pre-registered rule for that outcome was to take the measured target, since
  // nothing is lost by preferring it. The [0,6] kick anchor is identical in both,
  // so the interlock — the line's identity — is untouched.
  bassGroove: { syncopation: 0.3 },
});

/** Clásica — functional triads, expressive, no drum kit. */
export const classicalPack = genrePack({
  id: "genre-classical", modes: ["major", "naturalMinor"], defaultMode: "major", keyPc: 0,
  tempoRange: [60, 140], chordStyle: "triad", groove: "none",
  // No ensemble override: orchestral percussion (timpani, cymbals) really is
  // reserved for the loud passages, so the default gate is correct here.
});

/** Experimental / ambient — modal drones, slow, textural, no kit. */
export const ambientPack = genrePack({
  id: "genre-ambient", modes: ["dorian", "naturalMinor"], defaultMode: "dorian", keyPc: 9,
  tempoRange: [50, 84], chordStyle: "triad", groove: "none",
  // Above 1 means unreachable — energy never gets there, so ambient never gets a kit.
  ensemble: { percussion: { on: 1.01, off: 1.01 } },
});

/** All authored genre packs (every target genre except corpus-derived rock). */
export const GENRE_PACKS: readonly StylePack[] = [
  classicalPack, popPack, hiphopPack, electronicPack, jazzPack, bluesPack,
  folkPack, latinPack, funkPack, metalPack, ambientPack,
];
