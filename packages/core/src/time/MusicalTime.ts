/**
 * Musical time primitives.
 *
 * Time is measured in integer *ticks* from an absolute origin, at a fixed
 * resolution ({@link TICKS_PER_QUARTER}). This is renderer-independent and maps
 * cleanly to MIDI later. Meter is represented explicitly so other time
 * signatures can be added without reworking callers, even though v0.1 only
 * uses 4/4.
 */

/** Pulses per quarter note. 480 is the common MIDI resolution. */
export const TICKS_PER_QUARTER = 480;

/** Absolute or relative time, in ticks. */
export type Ticks = number;

/** A duration, in ticks. Alias kept distinct from {@link Ticks} for intent. */
export type MusicalDuration = number;

/** Time signature. v0.1 only emits 4/4 but the shape supports others. */
export interface Meter {
  /** Beats per bar (e.g. 4 in 4/4). */
  readonly numerator: number;
  /** Note value that gets the beat (e.g. 4 = quarter note). */
  readonly denominator: number;
}

export const FOUR_FOUR: Meter = { numerator: 4, denominator: 4 };

/** Ticks in one beat for the given meter. */
export function ticksPerBeat(meter: Meter): Ticks {
  return (TICKS_PER_QUARTER * 4) / meter.denominator;
}

/** Ticks in one bar for the given meter. */
export function ticksPerBar(meter: Meter): Ticks {
  return ticksPerBeat(meter) * meter.numerator;
}

/** Common note durations, in ticks. */
export const Durations = {
  whole: TICKS_PER_QUARTER * 4,
  dottedHalf: TICKS_PER_QUARTER * 3,
  half: TICKS_PER_QUARTER * 2,
  dottedQuarter: TICKS_PER_QUARTER * 1.5,
  quarter: TICKS_PER_QUARTER,
  dottedEighth: TICKS_PER_QUARTER * 0.75,
  tripletQuarter: (TICKS_PER_QUARTER * 2) / 3,
  eighth: TICKS_PER_QUARTER / 2,
  tripletEighth: TICKS_PER_QUARTER / 3,
  sixteenth: TICKS_PER_QUARTER / 4,
} as const;

export type DurationName = keyof typeof Durations;

/** Structured position derived from an absolute tick. All values 0-based. */
export interface BarPosition {
  /** Bar index from the origin. */
  readonly bar: number;
  /** Beat index within the bar (0-based). */
  readonly beat: number;
  /** Tick offset within the beat. */
  readonly tick: number;
}

/** Convert an absolute tick to a structured bar/beat/tick position. */
export function toBarPosition(time: Ticks, meter: Meter): BarPosition {
  const perBar = ticksPerBar(meter);
  const perBeat = ticksPerBeat(meter);
  const bar = Math.floor(time / perBar);
  const inBar = time - bar * perBar;
  const beat = Math.floor(inBar / perBeat);
  const tick = inBar - beat * perBeat;
  return { bar, beat, tick };
}

/** Absolute tick at the start of a bar. */
export function barStart(bar: number, meter: Meter): Ticks {
  return bar * ticksPerBar(meter);
}

/** Absolute tick of a beat within a bar. */
export function beatTime(bar: number, beat: number, meter: Meter): Ticks {
  return barStart(bar, meter) + beat * ticksPerBeat(meter);
}

/** Which bar an absolute tick falls in. */
export function barOf(time: Ticks, meter: Meter): number {
  return Math.floor(time / ticksPerBar(meter));
}

/** Convert ticks to seconds at a given tempo (BPM, quarter-note beats). */
export function ticksToSeconds(ticks: Ticks, bpm: number): number {
  const secondsPerQuarter = 60 / bpm;
  return (ticks / TICKS_PER_QUARTER) * secondsPerQuarter;
}
