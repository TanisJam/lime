import type {
  StylePack,
  Mode,
  ChordStyle,
  BassStyle,
  GrooveStyle,
  MelodyScale,
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
    rhythm: s.groove ? { groove: s.groove } : undefined,
    melody: s.melodyScale ? { scale: s.melodyScale } : undefined,
  };
}

/** Metal — heavier, faster rock: power chords, minor pentatonic, driving. */
export const metalPack = genrePack({
  id: "genre-metal",
  modes: ["naturalMinor"],
  defaultMode: "naturalMinor",
  keyPc: 4, // E
  tempoRange: [140, 180],
  chordStyle: "power",
  bassStyle: "root-drive",
  groove: "backbeat",
  melodyScale: "minor-pentatonic",
});

/** Pop — bright diatonic four-chord loops over a straight backbeat. */
export const popPack = genrePack({
  id: "genre-pop",
  modes: ["major", "naturalMinor"],
  defaultMode: "major",
  keyPc: 0, // C
  tempoRange: [100, 128],
  chordStyle: "triad",
  bassStyle: "root-drive",
  groove: "backbeat",
});

/** Authored genre packs, growing toward the full twelve. */
export const GENRE_PACKS: readonly StylePack[] = [metalPack, popPack];
