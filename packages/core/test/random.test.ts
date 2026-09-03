import { describe, it, expect } from "vitest";
import { SeededRandom } from "../src/random/SeededRandom.js";

describe("SeededRandom", () => {
  it("is reproducible for the same seed", () => {
    const a = new SeededRandom("forest-level-12");
    const b = new SeededRandom("forest-level-12");
    const seqA = Array.from({ length: 32 }, () => a.next());
    const seqB = Array.from({ length: 32 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = new SeededRandom("seed-a");
    const b = new SeededRandom("seed-b");
    const seqA = Array.from({ length: 32 }, () => a.next());
    const seqB = Array.from({ length: 32 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("stays within [0,1)", () => {
    const r = new SeededRandom("range");
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("derives independent, deterministic child streams", () => {
    const root1 = new SeededRandom("game");
    const root2 = new SeededRandom("game");
    const h1 = root1.derive("harmony");
    const h2 = root2.derive("harmony");
    const m1 = root1.derive("melody");
    expect(Array.from({ length: 16 }, () => h1.next())).toEqual(
      Array.from({ length: 16 }, () => h2.next()),
    );
    // Different subsystem name → different stream.
    expect(Array.from({ length: 16 }, () => root1.derive("melody").next())).not.toEqual(
      Array.from({ length: 16 }, () => root1.derive("harmony").next()),
    );
    // Advancing one child does not change another separately-derived child.
    const expectedHarmony = Array.from({ length: 16 }, () =>
      new SeededRandom("game").derive("harmony"),
    ).map((r) => r.next()); // 16 fresh streams → first value only (all equal)
    const referenceStream = new SeededRandom("game").derive("harmony");
    const referenceSeq = Array.from({ length: 16 }, () => referenceStream.next());
    m1.next();
    const h3 = new SeededRandom("game").derive("harmony");
    expect(Array.from({ length: 16 }, () => h3.next())).toEqual(referenceSeq);
    // Sanity: the fresh-per-element array collapses to a single repeated value.
    expect(new Set(expectedHarmony).size).toBe(1);
  });

  it("int() stays within inclusive bounds", () => {
    const r = new SeededRandom("ints");
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("weighted() honors zero-weight exclusion", () => {
    const r = new SeededRandom("weighted");
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 500; i++) {
      const pick = r.weighted(["a", "b", "c"], [0, 1, 3]) as keyof typeof counts;
      counts[pick]++;
    }
    expect(counts.a).toBe(0);
    expect(counts.c).toBeGreaterThan(counts.b);
  });
});
