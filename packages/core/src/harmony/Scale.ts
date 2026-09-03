/**
 * Scales, modes, and diatonic triad construction.
 *
 * Everything here works in pitch classes (0–11) and scale degrees (1–7) so that
 * harmony stays symbolic and transposable — no hardcoded note names.
 */

/** Modes supported in v0.1. A StylePack decides which are available. */
export type Mode = "major" | "naturalMinor" | "dorian" | "mixolydian";

/** Diatonic triad quality. */
export type ChordQuality = "major" | "minor" | "diminished" | "augmented";

/** Approximate functional role of a chord. */
export type HarmonicFunction = "tonic" | "predominant" | "dominant";

/** Semitone offsets from the tonic for each supported mode. */
export const MODE_INTERVALS: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

export const ALL_MODES: readonly Mode[] = [
  "major",
  "naturalMinor",
  "dorian",
  "mixolydian",
];

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** Human-readable pitch-class name, for debug output. */
export function pitchClassName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12] as string;
}

/** MIDI pitch → name with octave, e.g. 60 → "C4". */
export function midiName(pitch: number): string {
  const pc = ((pitch % 12) + 12) % 12;
  const octave = Math.floor(pitch / 12) - 1;
  return `${pitchClassName(pc)}${octave}`;
}

/**
 * Semitone offset (0–11) of a scale degree above the tonic.
 * `degree` is 1-based; values outside 1–7 wrap with octave folding removed.
 */
export function degreeSemitone(degree: number, mode: Mode): number {
  const intervals = MODE_INTERVALS[mode];
  const idx = ((degree - 1) % 7 + 7) % 7;
  return intervals[idx] as number;
}

/**
 * Absolute MIDI pitch of a scale degree.
 * `degree` may exceed 7 to reach higher octaves (8 = tonic one octave up).
 */
export function degreePitch(
  degree: number,
  keyPc: number,
  mode: Mode,
  octave: number,
): number {
  const intervals = MODE_INTERVALS[mode];
  const zeroBased = degree - 1;
  const octaveShift = Math.floor(zeroBased / 7);
  const idx = ((zeroBased % 7) + 7) % 7;
  const semitone = intervals[idx] as number;
  return (octave + 1) * 12 + keyPc + semitone + octaveShift * 12;
}

/** Determine triad quality from the third and fifth intervals (semitones). */
function qualityFrom(third: number, fifth: number): ChordQuality {
  if (third === 4 && fifth === 7) return "major";
  if (third === 3 && fifth === 7) return "minor";
  if (third === 3 && fifth === 6) return "diminished";
  if (third === 4 && fifth === 8) return "augmented";
  // Fallback for unusual modal stacks: classify by the third.
  return third <= 3 ? "minor" : "major";
}

/** Diatonic triad quality of a scale degree in a mode. */
export function triadQuality(degree: number, mode: Mode): ChordQuality {
  const root = degreeSemitone(degree, mode);
  const third = (degreeSemitone(degree + 2, mode) - root + 12) % 12;
  const fifth = (degreeSemitone(degree + 4, mode) - root + 12) % 12;
  return qualityFrom(third, fifth);
}

/**
 * Chord-tone scale degrees for a diatonic triad on `degree` (1,3,5 stacked).
 * Returns three degrees, which may exceed 7 (caller folds octaves via
 * {@link degreePitch}).
 */
export function triadDegrees(degree: number): [number, number, number] {
  return [degree, degree + 2, degree + 4];
}

/** Absolute MIDI pitches of a diatonic triad. */
export function triadPitches(
  degree: number,
  keyPc: number,
  mode: Mode,
  octave: number,
): [number, number, number] {
  const [d1, d3, d5] = triadDegrees(degree);
  return [
    degreePitch(d1, keyPc, mode, octave),
    degreePitch(d3, keyPc, mode, octave),
    degreePitch(d5, keyPc, mode, octave),
  ];
}
