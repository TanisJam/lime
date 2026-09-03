import { describe, it, expect } from "vitest";
import { Arrangement } from "../src/orchestration/Arrangement.js";

const voices = (a: Arrangement, energy: number): string[] =>
  [...a.update(energy)].sort();

describe("Arrangement", () => {
  it("builds orchestration up in energy bands", () => {
    const a = new Arrangement();
    expect(voices(a, 0.05)).toEqual(["pad"]); // very low: pad alone
    expect(voices(a, 0.25)).toEqual(["melody", "pad"]); // low: + melody
    expect(voices(a, 0.45)).toEqual(["bass", "melody", "pad"]); // medium: + bass
    expect(voices(a, 0.7)).toEqual(["bass", "melody", "pad", "percussion"]); // high: + percussion
  });

  it("strips voices back out as energy falls", () => {
    const a = new Arrangement();
    a.update(0.9); // everything in
    expect(voices(a, 0.05)).toEqual(["pad"]); // back to pad alone
  });

  it("uses hysteresis so a voice does not flicker around its threshold", () => {
    const a = new Arrangement();
    // Bass turns on at 0.38. Oscillating just under and over its ON threshold,
    // but never below its OFF threshold (0.30), must not toggle it back off.
    a.update(0.38); // bass enters
    expect(a.current.has("bass")).toBe(true);
    for (const e of [0.36, 0.39, 0.35, 0.4, 0.34]) {
      a.update(e);
      expect(a.current.has("bass")).toBe(true); // stays — no flicker
    }
    a.update(0.29); // clearly below OFF: now it leaves
    expect(a.current.has("bass")).toBe(false);
  });

  it("keeps the pad present at all times", () => {
    const a = new Arrangement();
    for (const e of [0, 0.5, 1, 0.01]) {
      expect(a.update(e).has("pad")).toBe(true);
    }
  });
});
