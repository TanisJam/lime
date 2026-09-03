import { describe, it, expect } from "vitest";
import { SeededRandom } from "../src/random/SeededRandom.js";
import { MotifGenerator } from "../src/motif/MotifGenerator.js";
import { Durations } from "../src/time/MusicalTime.js";

describe("MotifGenerator — corpus melody style", () => {
  it("uses corpus interval weights for the contour", () => {
    const g = new MotifGenerator(new SeededRandom("mi"), { intervalWeights: { "2": 1 } });
    for (let i = 0; i < 25; i++) {
      const m = g.create(0.5);
      for (const iv of m.intervals) expect(iv % 2).toBe(0); // only +2 steps → even positions
    }
  });

  it("uses corpus duration weights for the rhythm", () => {
    const g = new MotifGenerator(new SeededRandom("md"), { durationWeights: { half: 1 } });
    const m = g.create(0.5);
    for (const d of m.rhythm) expect(d).toBe(Durations.half);
  });

  it("falls back to the built-in grammar without a melody style", () => {
    const g = new MotifGenerator(new SeededRandom("mf"));
    const m = g.create(0.2);
    expect(m.intervals[0]).toBe(0);
    expect(m.intervals.length).toBeGreaterThanOrEqual(3);
    expect(m.rhythm.length).toBe(m.intervals.length);
  });

  it("is deterministic for the same seed and style", () => {
    const style = { intervalWeights: { "1": 3, "-1": 3, "2": 1 } };
    const a = new MotifGenerator(new SeededRandom("s"), style).create(0.5);
    const b = new MotifGenerator(new SeededRandom("s"), style).create(0.5);
    expect(a.intervals).toEqual(b.intervals);
    expect(a.rhythm).toEqual(b.rhythm);
  });
});
