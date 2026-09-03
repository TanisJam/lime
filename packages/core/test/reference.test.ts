import { describe, it, expect } from "vitest";
import {
  REFERENCE_SEEDS,
  SHOWCASE_SEQUENCE,
  expandShowcase,
  estimateShowcaseDurationSeconds,
  driveShowcase,
  type ShowcaseStageName,
} from "../src/reference/showcase.js";
import {
  NORMALIZED_KEYS,
  TEMPO_MIN,
  TEMPO_MAX,
} from "../src/state/MusicalState.js";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";

describe("REFERENCE_SEEDS", () => {
  it("has exactly 10 entries with the exact expected names, in order", () => {
    expect(REFERENCE_SEEDS).toEqual([
      "lime-reference-01",
      "lime-reference-02",
      "lime-reference-03",
      "lime-reference-04",
      "lime-reference-05",
      "lime-reference-06",
      "lime-reference-07",
      "lime-reference-08",
      "lime-reference-09",
      "lime-reference-10",
    ]);
    expect(REFERENCE_SEEDS.length).toBe(10);
  });
});

describe("SHOWCASE_SEQUENCE", () => {
  it("follows the exact CALM,EXPLORE,UNEASE,DANGER,RESOLUTION,CALM order", () => {
    const names = SHOWCASE_SEQUENCE.map((s) => s.name);
    expect(names).toEqual<ShowcaseStageName[]>([
      "CALM",
      "EXPLORE",
      "UNEASE",
      "DANGER",
      "RESOLUTION",
      "CALM",
    ]);
  });

  it("starts and ends with CALM", () => {
    expect(SHOWCASE_SEQUENCE[0]!.name).toBe("CALM");
    expect(SHOWCASE_SEQUENCE[SHOWCASE_SEQUENCE.length - 1]!.name).toBe("CALM");
  });

  it("gives every stage a state within valid bounds", () => {
    for (const stage of SHOWCASE_SEQUENCE) {
      for (const key of NORMALIZED_KEYS) {
        const v = stage.state[key];
        expect(v, `${stage.name}.${key}`).toBeDefined();
        expect(v!).toBeGreaterThanOrEqual(0);
        expect(v!).toBeLessThanOrEqual(1);
      }
      if (stage.state.tempo !== undefined) {
        expect(stage.state.tempo).toBeGreaterThanOrEqual(TEMPO_MIN);
        expect(stage.state.tempo).toBeLessThanOrEqual(TEMPO_MAX);
      }
      expect(stage.transitionBars).toBeGreaterThan(0);
      expect(stage.holdBars).toBeGreaterThan(0);
    }
  });
});

describe("expandShowcase", () => {
  it("produces the exact, stable atBar positions and totalBars", () => {
    const { changes, totalBars } = expandShowcase();
    expect(changes.map((c) => c.atBar)).toEqual([0, 20, 44, 68, 92, 116]);
    expect(changes.map((c) => c.transitionBars)).toEqual([4, 8, 8, 8, 8, 8]);
    expect(totalBars).toBe(140);
  });

  it("totalBars equals the sum of every transition + hold", () => {
    const { totalBars } = expandShowcase();
    const sum = SHOWCASE_SEQUENCE.reduce(
      (acc, s) => acc + s.transitionBars + s.holdBars,
      0,
    );
    expect(totalBars).toBe(sum);
  });

  it("is deterministic: two calls yield identical output", () => {
    expect(JSON.stringify(expandShowcase())).toBe(
      JSON.stringify(expandShowcase()),
    );
  });

  it("carries each stage's canonical state as the change patch", () => {
    const { changes } = expandShowcase();
    changes.forEach((c, i) => {
      expect(c.patch).toBe(SHOWCASE_SEQUENCE[i]!.state);
    });
  });
});

describe("estimateShowcaseDurationSeconds", () => {
  it("is comfortably beyond the ~5-minute goal", () => {
    const seconds = estimateShowcaseDurationSeconds();
    expect(seconds).toBeGreaterThanOrEqual(300);
    // Worst case: every bar at the sequence's fastest stage tempo (98 BPM) is
    // still ~5.7 minutes — well beyond the 5-minute goal.
    const { totalBars } = expandShowcase();
    const maxTempo = Math.max(...SHOWCASE_SEQUENCE.map((s) => s.state.tempo ?? 0));
    expect(maxTempo).toBeLessThanOrEqual(TEMPO_MAX);
    const fastest = (totalBars * 4 * 60) / maxTempo;
    expect(fastest).toBeGreaterThanOrEqual(300);
  });
});

describe("driveShowcase", () => {
  it("drives an engine deterministically through the whole journey", () => {
    const runOnce = () => {
      const engine = new LimeEngine({ seed: REFERENCE_SEEDS[0], style: testStyle });
      const schedule = driveShowcase(engine);
      const snap = engine.debug.snapshot();
      return { schedule, composedThroughBar: snap.composedThroughBar };
    };
    const a = runOnce();
    const b = runOnce();
    expect(a.schedule.totalBars).toBe(140);
    // composeThrough(totalBars - 1) leaves the frontier at totalBars.
    expect(a.composedThroughBar).toBe(140);
    expect(b.composedThroughBar).toBe(a.composedThroughBar);
  });

  it("lands current state near the final CALM target after the journey", () => {
    const engine = new LimeEngine({ seed: REFERENCE_SEEDS[0], style: testStyle });
    driveShowcase(engine);
    const s = engine.debug.snapshot().currentState;
    // After 16 held bars at CALM, easing has converged toward it.
    expect(s.energy).toBeLessThan(0.3);
    expect(s.tension).toBeLessThan(0.3);
    expect(s.valence).toBeGreaterThan(0.5);
  });
});
