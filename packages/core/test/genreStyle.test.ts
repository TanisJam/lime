import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { powerChordVoicing } from "../src/harmony/Voicing.js";
import { makeHarmonicEvent } from "../src/harmony/Chord.js";
import { testStyle } from "./helpers.js";
import type { StylePack } from "../src/style/StylePack.js";

const rockStyle: StylePack = {
  ...testStyle,
  chordStyle: "power",
  rhythm: { ...(testStyle.rhythm ?? {}), groove: "backbeat" },
};

const BAR = 1920; // ticks per 4/4 bar at ppq 480
const BEAT = 480;

describe("powerChordVoicing", () => {
  const chord = makeHarmonicEvent({ bar: 0, durationBars: 1, degree: 1, keyPc: 0, mode: "major" });

  it("is root + fifth + octave", () => {
    const v = powerChordVoicing(chord, 4, undefined, 60);
    expect(v.length).toBe(3);
    expect(v[1]! - v[0]!).toBe(7); // perfect fifth
    expect(v[2]! - v[0]!).toBe(12); // octave
  });

  it("has no third", () => {
    const v = powerChordVoicing(chord, 4, undefined, 60);
    const pcs = v.map((p) => ((p % 12) + 12) % 12);
    const rootPc = pcs[0]!;
    expect(pcs).not.toContain((rootPc + 4) % 12); // no major third
    expect(pcs).not.toContain((rootPc + 3) % 12); // no minor third
  });

  it("voice-leads the root toward the previous chord", () => {
    const next = makeHarmonicEvent({ bar: 1, durationBars: 1, degree: 5, keyPc: 0, mode: "major" });
    const prev = powerChordVoicing(chord, 4, undefined, 60);
    const cur = powerChordVoicing(next, 4, prev, 60);
    expect(Math.abs(cur[0]! - prev[0]!)).toBeLessThanOrEqual(7); // no big root leap
  });
});

describe("rock StylePack — backbeat groove", () => {
  it("lays a snare on beats 2 & 4", () => {
    const eng = new LimeEngine({
      seed: "rock",
      style: rockStyle,
      initialState: { energy: 0.8, density: 0.6, tempo: 120 },
    });
    let found = false;
    for (let bar = 0; bar < 12 && !found; bar++) {
      const snares = eng
        .composeBar(bar)
        .filter((e) => e.voice === "percussion" && e.percussion === "snare")
        .map((e) => e.time - bar * BAR);
      if (snares.includes(BEAT) && snares.includes(BEAT * 3)) found = true;
    }
    expect(found).toBe(true);
  });

  it("lays a kick on beat 1", () => {
    const eng = new LimeEngine({
      seed: "rock",
      style: rockStyle,
      initialState: { energy: 0.8, density: 0.6, tempo: 120 },
    });
    let found = false;
    for (let bar = 0; bar < 12 && !found; bar++) {
      const kicks = eng
        .composeBar(bar)
        .filter((e) => e.voice === "percussion" && e.percussion === "kick")
        .map((e) => e.time - bar * BAR);
      if (kicks.includes(0)) found = true;
    }
    expect(found).toBe(true);
  });
});

describe("rock StylePack — power-chord pad", () => {
  it("voices a perfect fifth with no third", () => {
    const eng = new LimeEngine({
      seed: "rock",
      style: rockStyle,
      initialState: { energy: 0.55, density: 0.5, tempo: 120 },
    });
    let sawFifth = false;
    for (let bar = 0; bar < 8; bar++) {
      const pad = eng.composeBar(bar).filter((e) => e.voice === "pad");
      const byTime = new Map<number, number[]>();
      for (const e of pad) (byTime.get(e.time) ?? byTime.set(e.time, []).get(e.time)!).push(e.pitch);
      for (const pitches of byTime.values()) {
        const pcs = new Set(pitches.map((p) => ((p % 12) + 12) % 12));
        for (const p of pcs) if (pcs.has((p + 7) % 12)) sawFifth = true;
      }
    }
    expect(sawFifth).toBe(true);
  });
});
