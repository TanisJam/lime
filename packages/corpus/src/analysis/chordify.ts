import { MODE_INTERVALS, type Mode } from "@lime/core";
import type { CorpusScore } from "../ir.js";
import { scoreDurationTicks } from "../ir.js";

/** A harmonic window: a time span reduced to one diatonic degree (or a rest). */
export interface ChordWindow {
  readonly startTick: number;
  readonly endTick: number;
  /** Scale degree 1–7, or null for a rest / no clear chord. */
  readonly degree: number | null;
}

/** Pitch class of a scale degree in a key (with octave folding for >7). */
function degreePc(degree: number, tonicPc: number, mode: Mode): number {
  const intervals = MODE_INTERVALS[mode];
  const idx = (((degree - 1) % 7) + 7) % 7;
  return (tonicPc + (intervals[idx] as number)) % 12;
}

/** Bar length in ticks from the score's time signature and PPQ. */
export function barTicks(score: CorpusScore): number {
  const beatTicks = (score.ppq * 4) / score.timeSignature.denominator;
  return beatTicks * score.timeSignature.numerator;
}

/**
 * Reduce a score to a sequence of diatonic degrees, one per bar.
 *
 * For each bar, weight sounding pitch classes by overlap duration, then pick the
 * diatonic triad whose tones capture the most weight (root weighted higher).
 * Bars with no pitched content become rests (degree null).
 */
export function chordify(
  score: CorpusScore,
  key: { tonicPc: number; mode: Mode },
  windowTicks = barTicks(score),
): ChordWindow[] {
  const total = scoreDurationTicks(score);
  const windows: ChordWindow[] = [];
  const step = Math.max(1, windowTicks);

  for (let start = 0; start < total; start += step) {
    const end = start + step;
    const pcWeight = new Array<number>(12).fill(0);
    let sum = 0;
    for (const n of score.notes) {
      if (n.isPercussion) continue;
      const overlap = Math.min(end, n.start + n.duration) - Math.max(start, n.start);
      if (overlap <= 0) continue;
      pcWeight[((n.pitch % 12) + 12) % 12]! += overlap;
      sum += overlap;
    }
    if (sum === 0) {
      windows.push({ startTick: start, endTick: end, degree: null });
      continue;
    }

    let bestDegree = 1;
    let bestScore = -Infinity;
    for (let degree = 1; degree <= 7; degree++) {
      const rootPc = degreePc(degree, key.tonicPc, key.mode);
      const thirdPc = degreePc(degree + 2, key.tonicPc, key.mode);
      const fifthPc = degreePc(degree + 4, key.tonicPc, key.mode);
      const s = 1.5 * pcWeight[rootPc]! + pcWeight[thirdPc]! + pcWeight[fifthPc]!;
      if (s > bestScore) {
        bestScore = s;
        bestDegree = degree;
      }
    }
    windows.push({ startTick: start, endTick: end, degree: bestDegree });
  }

  return windows;
}
