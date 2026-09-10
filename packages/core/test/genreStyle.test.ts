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

const latinStyle: StylePack = {
  ...testStyle,
  chordStyle: "seventh",
  bassStyle: "montuno",
  rhythm: { ...(testStyle.rhythm ?? {}), groove: "clave" },
};

describe("latin StylePack — clave groove", () => {
  // The groove is deterministic, so one bar carries the whole pattern.
  const barOf = (bar: number) =>
    new LimeEngine({
      seed: "latin",
      style: latinStyle,
      initialState: { energy: 0.8, density: 0.6, tempo: 105 },
    })
      .composeBar(bar)
      .filter((e) => e.voice === "percussion");
  const CELL = BAR / 16;
  // Onset checks below assert exact grid positions, but this style gets
  // core's DEFAULT_FEEL humanization (Humanizer.ts) since it declares no feel
  // of its own. Snap back to the grid — the tolerance is comfortably above
  // the default feel's worst-case per-note deviation and below the spacing
  // between distinct clave/conga/kick positions, so distinct hits never merge.
  const JITTER_TOL = 60;
  const snap = (t: number) => Math.round(t / JITTER_TOL) * JITTER_TOL;
  const at = (sound: string) =>
    barOf(0)
      .filter((e) => e.percussion === sound)
      .map((e) => snap(e.time))
      .sort((a, b) => a - b);

  it("plays the 3-2 son clave on the clave itself, not on the shaker", () => {
    expect(at("clave")).toEqual([0, 3, 6, 10, 12].map((s) => s * CELL));
  });

  it("keeps the clave louder than the shaker bed, so the figure is audible", () => {
    const perc = barOf(0);
    const quietest = (s: string) =>
      Math.min(...perc.filter((e) => e.percussion === s).map((e) => e.velocity));
    const loudest = (s: string) =>
      Math.max(...perc.filter((e) => e.percussion === s).map((e) => e.velocity));
    expect(quietest("clave")).toBeGreaterThan(loudest("shaker"));
  });

  it("plays a conga tumbao with its two open tones at the end of the bar", () => {
    expect(at("congaLow")).toEqual([0, 8 * CELL]);
    expect(at("conga")).toEqual([4, 12, 14].map((s) => s * CELL));
  });

  it("follows the bombo instead of a backbeat: no kick on beat 3", () => {
    const kicks = at("kick");
    expect(kicks).toContain(6 * CELL); // the "and of 2"
    expect(kicks).not.toContain(BEAT * 2);
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
