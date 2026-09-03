import type { Motif } from "./Motif.js";

/**
 * Motif transformations. A transformed motif keeps the same identity but varies
 * its surface, so the listener hears development rather than repetition. v0.1
 * ships four: transpose, invert, fragment, augment.
 */

/** Shift every note by a diatonic step count. Identity preserved. */
export function transpose(motif: Motif, steps: number): Motif {
  if (steps === 0) return motif;
  return {
    id: `${motif.id}^t${steps}`,
    intervals: motif.intervals.map((v) => v + steps),
    rhythm: [...motif.rhythm],
  };
}

/** Mirror the contour around the anchor (negate step offsets). */
export function invert(motif: Motif): Motif {
  return {
    id: `${motif.id}^inv`,
    intervals: motif.intervals.map((v) => -v),
    rhythm: [...motif.rhythm],
  };
}

/** Keep only the first `count` notes (>=1). */
export function fragment(motif: Motif, count: number): Motif {
  const n = Math.max(1, Math.min(count, motif.intervals.length));
  return {
    id: `${motif.id}^frag${n}`,
    intervals: motif.intervals.slice(0, n),
    rhythm: motif.rhythm.slice(0, n),
  };
}

/** Scale all durations by `factor` (e.g. 2 = augmentation, 0.5 = diminution). */
export function augment(motif: Motif, factor: number): Motif {
  return {
    id: `${motif.id}^aug${factor}`,
    intervals: [...motif.intervals],
    rhythm: motif.rhythm.map((d) => Math.max(1, Math.round(d * factor))),
  };
}
