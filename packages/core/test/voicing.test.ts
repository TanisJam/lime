import { describe, it, expect } from "vitest";
import { voiceLeadChord, voicingCost } from "../src/harmony/Voicing.js";
import { makeHarmonicEvent, chordPitches } from "../src/harmony/Chord.js";
import type { HarmonicEvent } from "../src/harmony/Chord.js";

function chord(degree: number): HarmonicEvent {
  return makeHarmonicEvent({ bar: 0, durationBars: 1, degree, keyPc: 0, mode: "major" });
}

/** Total absolute movement and common tones held across a voice-led progression. */
function chainStats(degrees: number[]): { movement: number; common: number; voicings: number[][] } {
  let prev: number[] | undefined;
  let movement = 0;
  let common = 0;
  const voicings: number[][] = [];
  for (const d of degrees) {
    const v = voiceLeadChord(chord(d), 4, prev, 67);
    if (prev) {
      for (let i = 0; i < 3; i++) {
        const delta = Math.abs(v[i]! - prev[i]!);
        movement += delta;
        if (delta === 0) common++;
      }
    }
    voicings.push(v);
    prev = v;
  }
  return { movement, common, voicings };
}

describe("voice leading", () => {
  const PROG = [1, 6, 4, 5, 1, 4, 2, 5];

  it("moves far less than naive root-position voicing", () => {
    const vl = chainStats(PROG).movement;
    let prev: number[] | undefined;
    let rootMove = 0;
    for (const d of PROG) {
      const v = chordPitches(chord(d), 4).slice().sort((a, b) => a - b);
      if (prev) for (let i = 0; i < 3; i++) rootMove += Math.abs(v[i]! - prev[i]!);
      prev = v;
    }
    expect(vl).toBeLessThan(rootMove / 2);
  });

  it("holds common tones between chords that share pitch classes", () => {
    // I -> vi shares two pitch classes (C, E); the voicing should hold them.
    const { common } = chainStats([1, 6]);
    expect(common).toBeGreaterThanOrEqual(2);
  });

  it("returns a sorted voicing (voices never cross)", () => {
    for (const v of chainStats(PROG).voicings) {
      const sorted = [...v].sort((a, b) => a - b);
      expect(v).toEqual(sorted);
    }
  });

  it("keeps every note inside the pad register", () => {
    for (const v of chainStats([1, 2, 3, 4, 5, 6, 7]).voicings) {
      expect(Math.min(...v)).toBeGreaterThanOrEqual(40);
      expect(Math.max(...v)).toBeLessThanOrEqual(84);
    }
  });

  it("scores a common-tone voicing below a distant one", () => {
    const prev = [60, 64, 67]; // C major
    const near = voicingCost([60, 64, 69], prev, 67); // holds 60, 64
    const far = voicingCost([72, 76, 81], prev, 67); // an octave up, nothing held
    expect(near).toBeLessThan(far);
  });

  it("is deterministic", () => {
    expect(chainStats(PROG).voicings).toEqual(chainStats(PROG).voicings);
  });
});
