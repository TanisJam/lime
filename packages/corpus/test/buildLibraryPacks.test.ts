import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLibraryPacks } from "../src/build/buildLibraryPacks.js";
import type { MidiFile } from "../src/build/walkMidi.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EMOPIA_DIR = resolve(HERE, "../data/emopia/EMOPIA_1.0/midis");
const hasEmopia = existsSync(EMOPIA_DIR);
const d = hasEmopia ? describe : describe.skip;

function emopiaFiles(n: number): MidiFile[] {
  return readdirSync(EMOPIA_DIR)
    .filter((f) => f.endsWith(".mid"))
    .slice(0, n)
    .map((f) => ({ abs: join(EMOPIA_DIR, f), rel: f }));
}

describe("buildLibraryPacks — guards", () => {
  it("returns nothing for no files", () => {
    expect(buildLibraryPacks([])).toEqual([]);
  });
});

d("buildLibraryPacks — over EMOPIA", () => {
  it("builds emotion packs with a playable StylePack shape", () => {
    const packs = buildLibraryPacks(emopiaFiles(120), {
      minSamples: 5,
      maxSectionsPerBucket: 300,
      buildGenre: false,
    });
    expect(packs.length).toBeGreaterThan(0);
    for (const p of packs) {
      expect(p.id).toMatch(/^feel-(happy|tense|sad|calm)$/);
      expect(p.kind).toBe("emotion");
      // A real, corpus-derived StylePack the engine can consume.
      expect(p.style.harmony?.transitions).toBeDefined();
      expect(Object.keys(p.style.harmony!.transitions!).length).toBeGreaterThan(0);
      expect(p.style.melody?.intervalWeights).toBeDefined();
      expect(p.style.rhythm?.onsetProfile?.length).toBe(16);
      expect(p.tempoRange[0]).toBeGreaterThanOrEqual(60);
      expect(p.tempoRange[1]).toBeLessThanOrEqual(130);
      expect(p.tempoRange[1]).toBeGreaterThan(p.tempoRange[0]);
      expect(p.suggestedState).toBeDefined();
    }
  });

  it("is deterministic for the same seed", () => {
    const opts = { minSamples: 5, maxSectionsPerBucket: 150, buildGenre: false, seed: "t" };
    const a = buildLibraryPacks(emopiaFiles(80), opts);
    const b = buildLibraryPacks(emopiaFiles(80), opts);
    expect(a.map((p) => [p.id, p.sampleCount])).toEqual(b.map((p) => [p.id, p.sampleCount]));
  });
});
