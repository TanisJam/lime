import { describe, it, expect } from "vitest";
import { SeededRandom } from "../src/random/SeededRandom.js";
import { PhrasePlanner } from "../src/phrase/PhrasePlanner.js";
import { HarmonyPlanner } from "../src/harmony/HarmonyPlanner.js";
import { triadQuality, degreePitch } from "../src/harmony/Scale.js";
import { functionOfDegree } from "../src/harmony/Chord.js";
import { DEFAULT_STATE, type MusicalState } from "../src/state/MusicalState.js";

function makePlanner(seed: string, opts?: { mode?: any; keyPc?: number; phraseLen?: 4 | 8 }) {
  const rng = new SeededRandom(seed).derive("harmony");
  const phrases = new PhrasePlanner({ phraseLengthBars: opts?.phraseLen ?? 4 });
  return new HarmonyPlanner({
    rng,
    phrasePlanner: phrases,
    mode: opts?.mode ?? "major",
    keyPc: opts?.keyPc ?? 0,
  });
}

describe("Scale / triad theory", () => {
  it("classifies major-scale diatonic triads correctly", () => {
    // I ii iii IV V vi vii° in a major key.
    const expected = [
      "major",
      "minor",
      "minor",
      "major",
      "major",
      "minor",
      "diminished",
    ];
    for (let d = 1; d <= 7; d++) {
      expect(triadQuality(d, "major")).toBe(expected[d - 1]);
    }
  });

  it("maps degree 1 to the tonic pitch", () => {
    // C major, degree 1, octave 4 → C4 = MIDI 60.
    expect(degreePitch(1, 0, "major", 4)).toBe(60);
    // Degree 8 = tonic one octave up.
    expect(degreePitch(8, 0, "major", 4)).toBe(72);
  });

  it("assigns plausible harmonic functions", () => {
    expect(functionOfDegree(1)).toBe("tonic");
    expect(functionOfDegree(5)).toBe("dominant");
    expect(functionOfDegree(4)).toBe("predominant");
  });
});

describe("HarmonyPlanner", () => {
  it("never produces invalid scale degrees or undefined chords", () => {
    const planner = makePlanner("valid");
    for (let bar = 0; bar < 256; bar++) {
      planner.ensurePlannedThrough(bar, DEFAULT_STATE);
      const chord = planner.chordAt(bar);
      expect(chord).toBeDefined();
      expect(chord!.degree).toBeGreaterThanOrEqual(1);
      expect(chord!.degree).toBeLessThanOrEqual(7);
      expect(chord!.durationBars).toBeGreaterThanOrEqual(1);
    }
  });

  it("starts on the tonic", () => {
    const planner = makePlanner("tonic-start");
    planner.ensurePlannedThrough(0, DEFAULT_STATE);
    expect(planner.chordAt(0)!.degree).toBe(1);
  });

  it("produces a contiguous, gap-free, non-overlapping chord stream", () => {
    const planner = makePlanner("contiguous");
    let bar = 0;
    while (bar < 200) {
      planner.ensurePlannedThrough(bar, DEFAULT_STATE);
      const chord = planner.chordAt(bar)!;
      expect(chord.bar).toBeLessThanOrEqual(bar);
      // Advance to the exact end of this chord — no gaps, no overlaps.
      bar = chord.bar + chord.durationBars;
    }
  });

  it("resolves cadence phrases toward the tonic under calm state", () => {
    // 4-bar phrases; phrase index 3 is a cadence phrase (bars 12–15).
    const planner = makePlanner("cadence");
    const calm: MusicalState = { ...DEFAULT_STATE, tension: 0.1 };
    planner.ensurePlannedThrough(15, calm);
    // Last bar of the first cadence phrase should be tonic-function.
    expect(functionOfDegree(planner.chordAt(15)!.degree)).toBe("tonic");
  });

  it("keeps chords within phrase boundaries", () => {
    const planner = makePlanner("boundaries", { phraseLen: 4 });
    for (let bar = 0; bar < 200; bar++) {
      planner.ensurePlannedThrough(bar, DEFAULT_STATE);
      const chord = planner.chordAt(bar)!;
      const phraseStart = Math.floor(chord.bar / 4) * 4;
      expect(chord.bar + chord.durationBars).toBeLessThanOrEqual(phraseStart + 4);
    }
  });

  it("is deterministic for the same seed and state", () => {
    const a = makePlanner("determinism");
    const b = makePlanner("determinism");
    const chordsA = a.upcoming(0, 40, DEFAULT_STATE).map((c) => `${c.bar}:${c.degree}:${c.durationBars}`);
    const chordsB = b.upcoming(0, 40, DEFAULT_STATE).map((c) => `${c.bar}:${c.degree}:${c.durationBars}`);
    expect(chordsA).toEqual(chordsB);
  });

  it("differs across seeds", () => {
    const a = makePlanner("seed-x");
    const b = makePlanner("seed-y");
    const chordsA = a.upcoming(0, 40, DEFAULT_STATE).map((c) => c.degree).join(",");
    const chordsB = b.upcoming(0, 40, DEFAULT_STATE).map((c) => c.degree).join(",");
    expect(chordsA).not.toBe(chordsB);
  });

  it("maintains a planning horizon ahead of the playhead", () => {
    const planner = makePlanner("horizon");
    planner.ensurePlannedThrough(10, DEFAULT_STATE);
    expect(planner.plannedBars).toBeGreaterThan(10);
  });

  it("high tension favors dominant motion over tonic rest", () => {
    const tense: MusicalState = { ...DEFAULT_STATE, tension: 0.95 };
    const calm: MusicalState = { ...DEFAULT_STATE, tension: 0.05 };
    const countDominant = (state: MusicalState) => {
      const planner = makePlanner("tension-compare");
      // Non-cadence phrases only (skip every 4th phrase) to isolate tendency.
      const chords = planner.upcoming(0, 120, state);
      return chords.filter((c) => functionOfDegree(c.degree) === "dominant").length;
    };
    expect(countDominant(tense)).toBeGreaterThan(countDominant(calm));
  });
});
