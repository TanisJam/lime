import type { MusicalDuration } from "../time/MusicalTime.js";
import { type Mode, degreePitch } from "../harmony/Scale.js";

/**
 * A motif is a reusable melodic identity, stored abstractly so it can return
 * later transposed, varied, or fragmented and still be recognizable.
 *
 * `intervals` are DIATONIC scale-step offsets from the motif's anchor degree
 * (the first is 0). Realizing a motif over a key/mode/anchor keeps it in scale
 * by construction, which guarantees pitch validity.
 */
export interface Motif {
  readonly id: string;
  /** Diatonic step offsets from the anchor degree; intervals[0] === 0. */
  readonly intervals: number[];
  /** Duration of each note, in ticks. Same length as `intervals`. */
  readonly rhythm: MusicalDuration[];
}

/** Realize a motif to absolute MIDI pitches over a given harmonic anchor. */
export function realizeMotif(
  motif: Motif,
  anchorDegree: number,
  keyPc: number,
  mode: Mode,
  octave: number,
): number[] {
  return motif.intervals.map((step) =>
    degreePitch(anchorDegree + step, keyPc, mode, octave),
  );
}

/** Total length of a motif, in ticks. */
export function motifLength(motif: Motif): MusicalDuration {
  return motif.rhythm.reduce((s, d) => s + d, 0);
}
