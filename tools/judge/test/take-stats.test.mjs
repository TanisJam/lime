import assert from "node:assert/strict";
import test from "node:test";

import {
  EnvelopeStatsError,
  TAKE_METRIC_KEYS,
  TakeSummaryError,
  compareConditions,
  envelopeStats,
  summarizeTakes,
} from "../take-stats.mjs";

const EPSILON = 1e-9;

function closeTo(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

/** Flattens a list of per-window amplitudes into a constant-value signal, one
 *  window per amplitude. Every sample inside a window is that window's exact
 *  amplitude, so each window's RMS is exactly |amplitude| and the expected
 *  gapFloor/punch/median can be derived by hand from the amplitude list alone. */
function constantWindows(amplitudes, samplesPerWindow) {
  const samples = [];
  for (const amplitude of amplitudes) {
    for (let i = 0; i < samplesPerWindow; i += 1) samples.push(amplitude);
  }
  return samples;
}

test("envelopeStats: alternating loud and near-silent windows gives a gapFloor near zero", () => {
  // 5 windows at amplitude 1.0, 5 at amplitude 0.01 (not literally zero, so
  // none is discarded as a zero window). Sorted window RMS is
  // [0.01,0.01,0.01,0.01,0.01,1,1,1,1,1]; median = avg(0.01,1) = 0.505;
  // 10th percentile (linear interpolation, rank=0.9) = 0.01.
  const samples = constantWindows([1, 1, 1, 1, 1, 0.01, 0.01, 0.01, 0.01, 0.01], 10);
  const stats = envelopeStats(samples, { sampleRate: 1000, windowMs: 10 });

  assert.equal(stats.windows, 10);
  closeTo(stats.gapFloor, 0.01 / 0.505);
  assert.ok(stats.gapFloor < 0.05, `expected gapFloor near zero, got ${stats.gapFloor}`);
  closeTo(stats.punch, 1 / 0.505);
  assert.equal(stats.peak, 1);
  closeTo(stats.rms, Math.sqrt((50 * 1 + 50 * 0.0001) / 100));
});

test("envelopeStats: a constant-amplitude signal gives gapFloor and punch of exactly 1", () => {
  const samples = constantWindows(new Array(10).fill(0.3), 10);
  const stats = envelopeStats(samples, { sampleRate: 1000, windowMs: 10 });

  assert.equal(stats.windows, 10);
  assert.equal(stats.gapFloor, 1);
  assert.equal(stats.punch, 1);
  assert.equal(stats.peak, 0.3);
  closeTo(stats.rms, 0.3);
});

test("envelopeStats: level independence — scaling every sample leaves gapFloor/punch unchanged and halves peak", () => {
  const amplitudes = [1, 1, 1, 1, 1, 0.01, 0.01, 0.01, 0.01, 0.01];
  const base = envelopeStats(constantWindows(amplitudes, 10), { sampleRate: 1000, windowMs: 10 });
  const scaled = envelopeStats(
    constantWindows(amplitudes.map((a) => a * 0.5), 10),
    { sampleRate: 1000, windowMs: 10 },
  );

  closeTo(scaled.gapFloor, base.gapFloor);
  closeTo(scaled.punch, base.punch);
  assert.equal(scaled.peak, base.peak * 0.5);
});

test("envelopeStats: percentile edges resolve by linear interpolation across ten distinct windows", () => {
  // Amplitudes 1..10, already sorted ascending. median = avg(5,6) = 5.5.
  // p10: rank = 0.1*9 = 0.9 -> interpolate window[0]=1 and window[1]=2 -> 1.9.
  // p95: rank = 0.95*9 = 8.55 -> interpolate window[8]=9 and window[9]=10 -> 9.55.
  const amplitudes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const stats = envelopeStats(constantWindows(amplitudes, 4), { sampleRate: 1000, windowMs: 4 });

  closeTo(stats.gapFloor, 1.9 / 5.5);
  closeTo(stats.punch, 9.55 / 5.5);
});

test("envelopeStats: a single full window collapses every percentile to that window's own RMS", () => {
  const samples = new Int16Array([16384, -16384, 8192, -8192, 16384, -16384, 8192, -8192]);
  const stats = envelopeStats(samples, { sampleRate: 1000, windowMs: 8 });

  assert.equal(stats.windows, 1);
  assert.equal(stats.gapFloor, 1);
  assert.equal(stats.punch, 1);
  closeTo(stats.peak, 16384 / 32768);
});

test("envelopeStats: throws a typed error for empty input", () => {
  assert.throws(
    () => envelopeStats([], { sampleRate: 44100 }),
    (error) => error instanceof EnvelopeStatsError && error.code === "empty-input",
  );
});

test("envelopeStats: throws a typed error when the window exceeds the sample count", () => {
  assert.throws(
    () => envelopeStats(new Array(5).fill(0.1), { sampleRate: 44100, windowMs: 1000 }),
    (error) => error instanceof EnvelopeStatsError && error.code === "window-too-large",
  );
});

test("envelopeStats: throws a typed error when every window is exactly silent", () => {
  assert.throws(
    () => envelopeStats(new Array(20).fill(0), { sampleRate: 1000, windowMs: 10 }),
    (error) => error instanceof EnvelopeStatsError && error.code === "all-windows-silent",
  );
});

test("envelopeStats: is deterministic across repeated calls on the same input", () => {
  const samples = constantWindows([1, 1, 0.01, 0.01], 10);
  const first = envelopeStats(samples, { sampleRate: 1000, windowMs: 10 });
  const second = envelopeStats(samples, { sampleRate: 1000, windowMs: 10 });

  assert.deepEqual(first, second);
});

test("TAKE_METRIC_KEYS: is a frozen, ordered list the CLI and tests can share", () => {
  assert.deepEqual(TAKE_METRIC_KEYS, ["gapFloor", "punch", "peak", "rms"]);
  assert.ok(Object.isFrozen(TAKE_METRIC_KEYS));
});

test("summarizeTakes: exact median, spread and relSpread for an odd-length array", () => {
  const summary = summarizeTakes([3, 1, 2]);

  assert.deepEqual(summary, { n: 3, median: 2, min: 1, max: 3, spread: 2, relSpread: 1 });
});

test("summarizeTakes: exact median, spread and relSpread for an even-length array", () => {
  const summary = summarizeTakes([4, 1, 3, 2]);

  assert.deepEqual(summary, { n: 4, median: 2.5, min: 1, max: 4, spread: 3, relSpread: 1.2 });
});

test("summarizeTakes: guards relSpread against division by zero when the median is exactly zero", () => {
  const allZero = summarizeTakes([0, 0, 0]);
  const symmetric = summarizeTakes([-1, 0, 1]);

  assert.equal(allZero.median, 0);
  assert.equal(allZero.spread, 0);
  assert.equal(allZero.relSpread, 0);
  assert.equal(symmetric.median, 0);
  assert.equal(symmetric.spread, 2);
  assert.equal(symmetric.relSpread, 0);
});

test("summarizeTakes: throws a typed error for an empty or non-numeric array", () => {
  assert.throws(
    () => summarizeTakes([]),
    (error) => error instanceof TakeSummaryError && error.code === "empty-values",
  );
  assert.throws(
    () => summarizeTakes([1, "2", 3]),
    (error) => error instanceof TakeSummaryError && error.code === "invalid-value",
  );
});

test("summarizeTakes: is deterministic across repeated calls on the same input", () => {
  const values = [0.586, 0.55, 0.57, 0.58, 0.561];
  assert.deepEqual(summarizeTakes(values), summarizeTakes(values));
});

test("compareConditions: a delta inside the noise floor is not significant", () => {
  const result = compareConditions([1, 1.2, 1.4], [1.1, 1.3, 1.5]);

  // baseline median 1.2, spread 0.4; candidate median 1.3, spread 0.4.
  // delta = 0.1, noiseFloor = max(0.4, 0.4) = 0.4 -> |0.1| <= 0.4.
  closeTo(result.delta, 0.1);
  closeTo(result.noiseFloor, 0.4);
  assert.equal(result.significant, false);
});

test("compareConditions: a delta outside the noise floor is significant", () => {
  const result = compareConditions([1, 1.02, 1.04], [2, 2.02, 2.04]);

  // baseline median 1.02, spread 0.04; candidate median 2.02, spread 0.04.
  // delta = 1.0, noiseFloor = 0.04 -> |1.0| > 0.04.
  closeTo(result.delta, 1);
  closeTo(result.noiseFloor, 0.04);
  assert.equal(result.significant, true);
});

test("compareConditions: the noise floor takes the larger of the two conditions' spreads", () => {
  const wideBaseline = compareConditions([0, 1], [0.5, 0.5]);
  assert.equal(wideBaseline.noiseFloor, 1);

  const wideCandidate = compareConditions([0.5, 0.5], [0, 1]);
  assert.equal(wideCandidate.noiseFloor, 1);
});

test("compareConditions: real measured gap-floor numbers — GM vs sampled render is significant", () => {
  // Baseline: five sampled-renderer gap-floor takes spanning the measured
  // 0.550-0.586 range. Candidate: the measured GM figure, 0.079-0.094.
  const baseline = [0.55, 0.56, 0.57, 0.58, 0.586];
  const candidateGm = [0.079, 0.083, 0.086, 0.09, 0.094];
  const result = compareConditions(baseline, candidateGm);

  assert.equal(result.significant, true);
});

test("compareConditions: real measured gap-floor numbers — 0.570 vs 0.546 is not significant", () => {
  const baseline = [0.55, 0.56, 0.57, 0.58, 0.586];
  const candidateClose = [0.53, 0.54, 0.546, 0.552, 0.56];
  const result = compareConditions(baseline, candidateClose);

  assert.equal(result.significant, false);
});

test("compareConditions: is deterministic across repeated calls on the same input", () => {
  const baseline = [0.55, 0.56, 0.57, 0.58, 0.586];
  const candidate = [0.079, 0.083, 0.086, 0.09, 0.094];
  assert.deepEqual(compareConditions(baseline, candidate), compareConditions(baseline, candidate));
});
