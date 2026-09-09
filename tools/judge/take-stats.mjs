/**
 * take-stats.mjs — pure statistics for measuring render-to-render spread.
 *
 * WHY THIS EXISTS: `render-tone.mjs` (the Tone.js sampled renderer, run
 * through headless Chromium) is not bit-reproducible. Two renders of the
 * identical committed state, same genre and seed, differ by roughly -51 dB
 * RMS against a -29 dB signal, and peak level wanders run to run (0.605 /
 * 0.609 / 0.612 measured). The cause traces below this repository's own code,
 * into Chromium's OfflineAudioContext — reverb, sample-load ordering,
 * noise-synth drums and dropped notes were each ruled out by experiment.
 * `render.mjs` (FluidSynth) has no such problem; it is byte-identical across
 * runs.
 *
 * Given that, bit-exact reproducibility on the Tone path is not a goal this
 * module tries to restore. Instead it makes the *measurements* interpretable:
 * render N takes of the same state, summarize each metric's spread across
 * those takes, and refuse to call a difference between two conditions real
 * unless it exceeds that spread. Measured reference: over five renders of one
 * unchanged state, the gap-floor metric spanned 0.550-0.586 (about ±3%) — any
 * comparison that reports a smaller difference as meaningful is reporting
 * noise.
 *
 * This module is dependency-free and has no filesystem, process, clock, or
 * randomness — every side effect (spawning a renderer, reading a WAV,
 * decoding PCM through ffmpeg) belongs to measure-takes.mjs, the thin CLI
 * that wraps this module the same way build-calibration-corpus.mjs wraps
 * calibration-corpus.mjs.
 */

/** Typed-array constructors that hold integer PCM samples. `envelopeStats`
 *  scales these down to the -1..1 float range (assuming 16-bit depth, the
 *  format every renderer and ffmpeg invocation in this repo already produces)
 *  before computing anything. A plain Array or a Float32Array/Float64Array is
 *  assumed to already be normalized float samples and is left unscaled. */
const INTEGER_SAMPLE_TYPES = new Set([
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
]);

function isIntegerSamples(samples) {
  return INTEGER_SAMPLE_TYPES.has(samples?.constructor?.name);
}

/** Linear-interpolation percentile (the same convention numpy's default
 *  uses): for a sorted-ascending array, the value at percentile `p` is
 *  interpolated between its two bracketing ranks rather than snapped to the
 *  nearest sample. This keeps gapFloor/punch stable as N changes instead of
 *  jumping between discrete window values. */
function percentile(sortedAscending, p) {
  const n = sortedAscending.length;
  if (n === 1) return sortedAscending[0];
  const rank = (p / 100) * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedAscending[lower];
  const weight = rank - lower;
  return sortedAscending[lower] * (1 - weight) + sortedAscending[upper] * weight;
}

export class EnvelopeStatsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EnvelopeStatsError";
    this.code = code;
  }
}

/**
 * Splits a mono PCM signal into non-overlapping windows and reports its
 * envelope shape independent of overall level.
 *
 * `gapFloor` (10th-percentile window RMS / median window RMS) is the measure
 * that matters here: it answers how much energy sits between hits, and being
 * a ratio of two RMS values it is level-independent by construction — the
 * same shape scaled twice as loud reports the same gapFloor. `punch` is the
 * mirror measure at the top end (95th percentile / median).
 *
 * Windows whose RMS is exactly zero (true digital silence, e.g. a rendering
 * dropout) are discarded before computing percentiles — one truly-silent
 * window would otherwise anchor the 10th percentile at zero regardless of
 * everything else. A window that is merely quiet, not literally zero, is
 * real signal and is kept; that is what lets gapFloor measure quiet passages
 * rather than just detect padding.
 *
 * @param {ArrayLike<number>} samples - mono PCM, integer (any typed integer
 *   array) or float (Array, Float32Array, Float64Array; assumed already in
 *   -1..1).
 * @param {{ sampleRate: number, windowMs?: number }} options
 * @returns {{ windows: number, gapFloor: number, punch: number, peak: number, rms: number }}
 */
export function envelopeStats(samples, options) {
  const { sampleRate, windowMs = 20 } = options ?? {};

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new EnvelopeStatsError("invalid-sample-rate", "sampleRate must be a positive finite number");
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new EnvelopeStatsError("invalid-window-ms", "windowMs must be a positive finite number");
  }

  const length = samples?.length ?? 0;
  if (length === 0) {
    throw new EnvelopeStatsError("empty-input", "samples must contain at least one value");
  }

  const windowSize = Math.round((sampleRate * windowMs) / 1000);
  if (windowSize < 1) {
    throw new EnvelopeStatsError(
      "window-too-small",
      `windowMs (${windowMs}ms) resolves to less than one sample at sampleRate ${sampleRate}`,
    );
  }
  if (windowSize > length) {
    throw new EnvelopeStatsError(
      "window-too-large",
      `windowMs (${windowMs}ms => ${windowSize} samples) exceeds the ${length}-sample input`,
    );
  }

  const scale = isIntegerSamples(samples) ? 1 / 32768 : 1;
  const windowCount = Math.floor(length / windowSize);
  const usedSamples = windowCount * windowSize;

  let peak = 0;
  let sumSquares = 0;
  const windowRms = [];

  for (let w = 0; w < windowCount; w += 1) {
    let windowSumSquares = 0;
    const base = w * windowSize;
    for (let i = 0; i < windowSize; i += 1) {
      const value = samples[base + i] * scale;
      const abs = Math.abs(value);
      if (abs > peak) peak = abs;
      const square = value * value;
      windowSumSquares += square;
      sumSquares += square;
    }
    const rms = Math.sqrt(windowSumSquares / windowSize);
    if (rms > 0) windowRms.push(rms);
  }

  if (windowRms.length === 0) {
    throw new EnvelopeStatsError(
      "all-windows-silent",
      "every window's RMS is exactly zero; gapFloor and punch are undefined for pure silence",
    );
  }

  windowRms.sort((a, b) => a - b);
  const median = percentile(windowRms, 50);
  const gapFloor = percentile(windowRms, 10) / median;
  const punch = percentile(windowRms, 95) / median;
  const rms = Math.sqrt(sumSquares / usedSamples);

  return { windows: windowRms.length, gapFloor, punch, peak, rms };
}

export class TakeSummaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TakeSummaryError";
    this.code = code;
  }
}

/**
 * Summarizes one metric's values across N takes of the same state.
 *
 * `spread` (max - min) is the noise floor for that metric under this
 * harness: `compareConditions` below refuses to call a difference real
 * unless it exceeds the larger of two conditions' spreads.
 */
export function summarizeTakes(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TakeSummaryError("empty-values", "values must be a non-empty array of numbers");
  }
  for (const [index, value] of values.entries()) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TakeSummaryError("invalid-value", `values[${index}] must be a finite number`);
    }
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const min = sorted[0];
  const max = sorted[n - 1];
  const spread = max - min;
  // A zero median has no meaningful percentage baseline (spread / 0 is
  // NaN/Infinity either way); report 0 rather than forcing every caller to
  // special-case the division themselves.
  const relSpread = median === 0 ? 0 : spread / median;

  return { n, median, min, max, spread, relSpread };
}

/**
 * Compares one metric's per-take values between a baseline and a candidate
 * condition, and decides whether the difference between them is bigger than
 * take-to-take noise.
 *
 * This is the point of the whole harness: `delta` alone cannot say anything,
 * because render-tone.mjs's non-determinism produces a nonzero delta between
 * two renders of the *same* state. `noiseFloor` — the larger of the two
 * conditions' own take-to-take spreads — is the yardstick; `significant` is
 * true only when the delta clears it.
 */
export function compareConditions(baseline, candidate) {
  const baselineSummary = summarizeTakes(baseline);
  const candidateSummary = summarizeTakes(candidate);

  const delta = candidateSummary.median - baselineSummary.median;
  const relDelta = baselineSummary.median === 0 ? 0 : delta / baselineSummary.median;
  const noiseFloor = Math.max(baselineSummary.spread, candidateSummary.spread);
  const significant = Math.abs(delta) > noiseFloor;

  return { delta, relDelta, noiseFloor, significant };
}

/** The metrics `envelopeStats` reports, in the fixed order the CLI's table
 *  and JSON output use — kept here as the single source of truth so the CLI
 *  and the tests can never drift apart on what "the metrics" means. */
export const TAKE_METRIC_KEYS = Object.freeze(["gapFloor", "punch", "peak", "rms"]);
