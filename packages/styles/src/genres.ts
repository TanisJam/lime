import type {
  StylePack,
  Mode,
  ChordStyle,
  BassStyle,
  GrooveStyle,
  MelodyScale,
  MotionStyle,
  InstrumentationConfig,
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
  readonly groove?: GrooveStyle;
  readonly melodyScale?: MelodyScale;
  readonly motion?: MotionStyle;
  readonly phraseLengthBars?: 4 | 8;
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
    motion: s.motion,
    rhythm: s.groove ? { groove: s.groove } : undefined,
    melody: s.melodyScale ? { scale: s.melodyScale } : undefined,
  };
}

/** Metal — heavier, faster rock: power chords, minor pentatonic, driving. */
export const metalPack = genrePack({
  id: "genre-metal", modes: ["naturalMinor"], defaultMode: "naturalMinor", keyPc: 4,
  tempoRange: [140, 180], chordStyle: "power", bassStyle: "root-drive", groove: "backbeat",
  melodyScale: "minor-pentatonic",
});

/** Pop — bright diatonic four-chord loops over a straight backbeat. */
export const popPack = genrePack({
  id: "genre-pop", modes: ["major", "naturalMinor"], defaultMode: "major", keyPc: 0,
  tempoRange: [100, 128], chordStyle: "triad", bassStyle: "root-drive", groove: "backbeat",
  motion: "arp",
});

/** Jazz — ii–V–I sevenths, swung ride, walking bass, comping stabs. */
export const jazzPack = genrePack({
  id: "genre-jazz", modes: ["major", "dorian", "mixolydian"], defaultMode: "major", keyPc: 0,
  tempoRange: [90, 180], chordStyle: "seventh", bassStyle: "walking", groove: "swing",
  motion: "stab",
});

/** Blues — dominant sevenths, shuffle, walking bass, blues scale. */
export const bluesPack = genrePack({
  id: "genre-blues", modes: ["mixolydian", "major"], defaultMode: "mixolydian", keyPc: 4,
  tempoRange: [70, 120], chordStyle: "seventh", bassStyle: "walking", groove: "shuffle",
  melodyScale: "blues",
});

/** Hip-hop — minor loops, boom-bap half-time, sub bass, pentatonic. */
export const hiphopPack = genrePack({
  id: "genre-hiphop", modes: ["naturalMinor", "dorian"], defaultMode: "naturalMinor", keyPc: 0,
  tempoRange: [82, 96], chordStyle: "seventh", bassStyle: "sub", groove: "boom-bap",
  melodyScale: "minor-pentatonic", motion: "arp", phraseLengthBars: 4,
});

/** Electrónica — minor riffs, four-on-the-floor, sub bass, arps. */
export const electronicPack = genrePack({
  id: "genre-electronic", modes: ["naturalMinor", "dorian"], defaultMode: "naturalMinor", keyPc: 9,
  tempoRange: [120, 130], chordStyle: "triad", bassStyle: "sub", groove: "four-on-floor",
  melodyScale: "minor-pentatonic", motion: "arp",
});

/** Folk — modal, open chords, drones, no drum kit. */
export const folkPack = genrePack({
  id: "genre-folk", modes: ["dorian", "mixolydian", "major"], defaultMode: "dorian", keyPc: 7,
  tempoRange: [80, 120], chordStyle: "triad", groove: "none",
});

/** Latina — sevenths, clave, anticipated tumbao bass. */
export const latinPack = genrePack({
  id: "genre-latin", modes: ["major", "naturalMinor"], defaultMode: "major", keyPc: 2,
  tempoRange: [90, 120], chordStyle: "seventh", bassStyle: "montuno", groove: "clave",
  motion: "ostinato",
});

/** R&B / soul / funk — extended chords, 16th funk groove, funk bass. */
export const funkPack = genrePack({
  id: "genre-funk", modes: ["dorian", "mixolydian"], defaultMode: "dorian", keyPc: 4,
  tempoRange: [95, 120], chordStyle: "seventh", bassStyle: "funk", groove: "funk",
  melodyScale: "minor-pentatonic", motion: "stab",
});

/** Clásica — functional triads, expressive, no drum kit. */
export const classicalPack = genrePack({
  id: "genre-classical", modes: ["major", "naturalMinor"], defaultMode: "major", keyPc: 0,
  tempoRange: [60, 140], chordStyle: "triad", groove: "none",
});

/** Experimental / ambient — modal drones, slow, textural, no kit. */
export const ambientPack = genrePack({
  id: "genre-ambient", modes: ["dorian", "naturalMinor"], defaultMode: "dorian", keyPc: 9,
  tempoRange: [50, 84], chordStyle: "triad", groove: "none",
});

/** All authored genre packs (every target genre except corpus-derived rock). */
export const GENRE_PACKS: readonly StylePack[] = [
  classicalPack, popPack, hiphopPack, electronicPack, jazzPack, bluesPack,
  folkPack, latinPack, funkPack, metalPack, ambientPack,
];
