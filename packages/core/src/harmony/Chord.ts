import {
  type ChordQuality,
  type HarmonicFunction,
  type Mode,
  degreePitch,
  triadDegrees,
  triadQuality,
  pitchClassName,
} from "./Scale.js";

/**
 * A harmonic event: one chord occupying a span of bars, expressed as a scale
 * degree (renderer-independent). Absolute pitches are derived on demand.
 */
export interface HarmonicEvent {
  /** Absolute bar index where this chord begins. */
  readonly bar: number;
  /** Length in bars. */
  readonly durationBars: number;
  /** Scale degree 1–7. */
  readonly degree: number;
  /** Diatonic triad quality. */
  readonly quality: ChordQuality;
  /** Approximate functional role. */
  readonly function: HarmonicFunction;
  /** Tonic pitch class this chord was planned in (0–11). */
  readonly keyPc: number;
  /** Mode this chord was planned in. */
  readonly mode: Mode;
}

/**
 * Map a scale degree to an approximate harmonic function.
 * Functional (not strictly mode-correct) but musically useful for direction.
 */
export function functionOfDegree(degree: number): HarmonicFunction {
  const d = ((degree - 1) % 7 + 7) % 7 + 1;
  switch (d) {
    case 1:
    case 3:
    case 6:
      return "tonic";
    case 2:
    case 4:
      return "predominant";
    case 5:
    case 7:
      return "dominant";
    default:
      return "tonic";
  }
}

/** Build a HarmonicEvent, filling quality and function from the degree. */
export function makeHarmonicEvent(params: {
  bar: number;
  durationBars: number;
  degree: number;
  keyPc: number;
  mode: Mode;
}): HarmonicEvent {
  return {
    bar: params.bar,
    durationBars: params.durationBars,
    degree: params.degree,
    quality: triadQuality(params.degree, params.mode),
    function: functionOfDegree(params.degree),
    keyPc: params.keyPc,
    mode: params.mode,
  };
}

/** Absolute MIDI pitches of a chord's triad in a given octave. */
export function chordPitches(chord: HarmonicEvent, octave: number): number[] {
  const [d1, d3, d5] = triadDegrees(chord.degree);
  return [
    degreePitch(d1, chord.keyPc, chord.mode, octave),
    degreePitch(d3, chord.keyPc, chord.mode, octave),
    degreePitch(d5, chord.keyPc, chord.mode, octave),
  ];
}

/** Root MIDI pitch of a chord. */
export function chordRoot(chord: HarmonicEvent, octave: number): number {
  return degreePitch(chord.degree, chord.keyPc, chord.mode, octave);
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII"];

/** Compact human-readable chord label, e.g. "Cmaj", "Am". */
export function chordLabel(chord: HarmonicEvent): string {
  const rootPc = (chord.keyPc + degreeToSemitone(chord)) % 12;
  const name = pitchClassName(rootPc);
  const suffix =
    chord.quality === "major"
      ? "maj"
      : chord.quality === "minor"
        ? "m"
        : chord.quality === "diminished"
          ? "dim"
          : "aug";
  return `${name}${suffix}`;
}

/** Roman-numeral label, e.g. "V", "vi". */
export function chordRoman(chord: HarmonicEvent): string {
  const d = ((chord.degree - 1) % 7 + 7) % 7 + 1;
  const roman = ROMAN[d] ?? "?";
  const lower = chord.quality === "minor" || chord.quality === "diminished";
  const base = lower ? roman.toLowerCase() : roman;
  return chord.quality === "diminished" ? `${base}°` : base;
}

function degreeToSemitone(chord: HarmonicEvent): number {
  const [rootDegree] = triadDegrees(chord.degree);
  return degreePitch(rootDegree, 0, chord.mode, 0) % 12;
}
