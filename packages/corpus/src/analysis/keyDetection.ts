import type { Mode } from "@lime/core";
import type { CorpusScore } from "../ir.js";

/**
 * Krumhansl–Schmuckler key finding.
 *
 * Build a duration-weighted pitch-class profile, correlate it against the major
 * and minor key profiles rotated to all 12 tonics, and pick the best match.
 * v0.1 detects major / natural-minor only; modal detection (dorian, mixolydian)
 * is a known follow-up.
 */

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface DetectedKey {
  readonly tonicPc: number;
  readonly mode: Mode;
  /** Correlation strength of the winning key (−1..1). */
  readonly confidence: number;
}

/** Duration-weighted pitch-class histogram (length 12), ignoring percussion. */
export function pitchClassProfile(score: CorpusScore): number[] {
  const hist = new Array<number>(12).fill(0);
  for (const n of score.notes) {
    if (n.isPercussion) continue;
    hist[((n.pitch % 12) + 12) % 12]! += n.duration;
  }
  return hist;
}

function pearson(a: number[], b: number[]): number {
  const n = 12;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

function rotate(profile: number[], tonic: number): number[] {
  const out = new Array<number>(12);
  for (let i = 0; i < 12; i++) out[i] = profile[(i - tonic + 12) % 12] as number;
  return out;
}

export function detectKey(score: CorpusScore): DetectedKey {
  const hist = pitchClassProfile(score);
  let best: DetectedKey = { tonicPc: 0, mode: "major", confidence: -Infinity };
  for (let tonic = 0; tonic < 12; tonic++) {
    const maj = pearson(hist, rotate(MAJOR_PROFILE, tonic));
    if (maj > best.confidence) best = { tonicPc: tonic, mode: "major", confidence: maj };
    const min = pearson(hist, rotate(MINOR_PROFILE, tonic));
    if (min > best.confidence) best = { tonicPc: tonic, mode: "naturalMinor", confidence: min };
  }
  return best;
}
