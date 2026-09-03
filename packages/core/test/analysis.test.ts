import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { analyzeComposition, formatReport } from "../src/analysis/analyze.js";
import type { AnalysisReport, CompositionCapture } from "../src/analysis/types.js";
import type { MusicalStatePatch } from "../src/state/MusicalState.js";
import { testStyle } from "./helpers.js";

const MOODS: MusicalStatePatch[] = [
  { energy: 0.15, tension: 0.1, valence: 0.7, density: 0.2, complexity: 0.2, instability: 0.1, tempo: 72 },
  { energy: 0.42, tension: 0.32, valence: 0.55, density: 0.42, complexity: 0.42, instability: 0.38, tempo: 80 },
  { energy: 0.5, tension: 0.62, valence: 0.32, density: 0.45, complexity: 0.48, instability: 0.55, tempo: 84 },
  { energy: 0.88, tension: 0.92, valence: 0.2, density: 0.72, complexity: 0.62, instability: 0.58, tempo: 90 },
  { energy: 0.4, tension: 0.15, valence: 0.78, density: 0.34, complexity: 0.3, instability: 0.2, tempo: 76 },
];

/** Compose `bars` bars while sweeping through the moods (realistic usage). */
function sweptCapture(seed: string, bars: number): CompositionCapture {
  const engine = new LimeEngine({ seed, style: testStyle, initialState: MOODS[0] });
  const seg = Math.max(1, Math.floor(bars / MOODS.length));
  const collected = [];
  let moodIdx = 0;
  for (let bar = 0; bar < bars; bar++) {
    if (bar > 0 && bar % seg === 0 && moodIdx < MOODS.length - 1) {
      moodIdx++;
      engine.transitionTo(MOODS[moodIdx]!, { duration: { bars: 4 } });
    }
    collected.push(engine.step());
  }
  return engine.buildCapture(collected);
}

function staticCapture(seed: string, bars: number, state: MusicalStatePatch): CompositionCapture {
  const engine = new LimeEngine({ seed, style: testStyle, initialState: state });
  return engine.captureComposition(bars);
}

const SEEDS = ["forest-1", "cavern-2", "meadow-3", "storm-4", "dawn-5"];

/**
 * Quality thresholds. These are gates: if a change to the composer regresses
 * musical structure below these, the suite fails. Tuned with margin under the
 * observed ~0.94 overall on the reference seed.
 */
const THRESHOLDS = {
  overall: 0.78,
  harmony: 0.85,
  rhythm: 0.68,
  melody: 0.72,
  responsiveness: 0.8,
  cadenceScore: 0.8,
  maxLoopSimilarity: 0.5,
  minEnergyDensityCorr: 0.5,
};

describe("composition analysis — quality gates", () => {
  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      const report: AnalysisReport = analyzeComposition(sweptCapture(seed, 96));

      it("all pitched notes are in scale", () => {
        expect(report.melody.metrics.inScale!.value).toBeGreaterThan(0.999);
      });

      it("meets the overall quality bar", () => {
        expect(report.overall, formatReport(report)).toBeGreaterThanOrEqual(THRESHOLDS.overall);
      });

      it("meets per-dimension bars", () => {
        expect(report.harmony.score).toBeGreaterThanOrEqual(THRESHOLDS.harmony);
        expect(report.rhythm.score).toBeGreaterThanOrEqual(THRESHOLDS.rhythm);
        expect(report.melody.score).toBeGreaterThanOrEqual(THRESHOLDS.melody);
        expect(report.responsiveness.score).toBeGreaterThanOrEqual(THRESHOLDS.responsiveness);
      });

      it("resolves cadences and avoids obvious looping", () => {
        expect(report.harmony.metrics.cadence!.score).toBeGreaterThanOrEqual(THRESHOLDS.cadenceScore);
        expect(report.rhythm.metrics.loop!.value).toBeLessThan(THRESHOLDS.maxLoopSimilarity);
      });

      it("realizes energy immediately (density + velocity)", () => {
        expect(report.responsiveness.metrics.energyDensity!.value).toBeGreaterThan(THRESHOLDS.minEnergyDensityCorr);
        expect(report.responsiveness.metrics.energyVelocity!.value).toBeGreaterThan(0.3);
      });
    });
  }

  it("is deterministic: same seed → identical report", () => {
    const a = analyzeComposition(sweptCapture("determinism", 64));
    const b = analyzeComposition(sweptCapture("determinism", 64));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("handles a constant (calm) state without faulting responsiveness", () => {
    const report = analyzeComposition(staticCapture("calm-static", 64, MOODS[0]!));
    expect(report.melody.metrics.inScale!.value).toBeGreaterThan(0.999);
    // Constant energy → correlation metrics are n/a and must not tank the score.
    expect(report.responsiveness.metrics.energyDensity!.detail).toContain("n/a");
    expect(report.overall).toBeGreaterThan(0.6);
  });
});
