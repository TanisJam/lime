import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";
import type { StylePack, MusicalStatePatch } from "../src/index.js";

const BAR = 1920;
const BEAT = 480;
const MINOR_PENT = new Set([0, 3, 5, 7, 10]);

interface Metrics {
  tempo: number;
  power: number; // % of pad chords that are power chords (fifth, no third)
  backbeat: number; // % of drum-bars with snare on 2 & 4
  hats: number; // % of hats on the straight 8th grid
  pent: number; // % of melody notes in minor pentatonic
  driving: number; // % of bars with a full arrangement
  bassPerBar: number; // avg bass notes per active bass bar
}

function measure(style: StylePack, state: MusicalStatePatch, seeds: string[]): Metrics {
  let padChords = 0, powerOk = 0, drumBars = 0, backbeatOk = 0;
  let hats = 0, hatsStraight = 0, mel = 0, melPent = 0;
  let bars = 0, drivingBars = 0, bassNotes = 0, bassBars = 0;
  for (const seed of seeds) {
    const eng = new LimeEngine({ seed, style, initialState: state });
    for (let bar = 0; bar < 48; bar++) {
      const evs = eng.composeBar(bar);
      bars++;
      const pad = evs.filter((e) => e.voice === "pad");
      const perc = evs.filter((e) => e.voice === "percussion");
      const melody = evs.filter((e) => e.voice === "melody");
      const bass = evs.filter((e) => e.voice === "bass");
      if (perc.length + melody.length + pad.length > 6) drivingBars++;
      if (bass.length) { bassBars++; bassNotes += bass.length; }
      const byTime = new Map<number, number[]>();
      for (const e of pad) (byTime.get(e.time) ?? byTime.set(e.time, []).get(e.time)!).push(e.pitch);
      for (const pitches of byTime.values()) {
        padChords++;
        const pcs = new Set(pitches.map((p) => ((p % 12) + 12) % 12));
        let fifth = false, third = false;
        for (const p of pcs) {
          if (pcs.has((p + 7) % 12)) fifth = true;
          if (pcs.has((p + 3) % 12) || pcs.has((p + 4) % 12)) third = true;
        }
        if (fifth && !third) powerOk++;
      }
      const snares = perc.filter((e) => e.percussion === "snare").map((e) => e.time - bar * BAR);
      if (perc.length) { drumBars++; if (snares.includes(BEAT) && snares.includes(BEAT * 3)) backbeatOk++; }
      for (const e of perc.filter((x) => x.percussion === "hat")) {
        hats++;
        if ((e.time - bar * BAR) % (BEAT / 2) === 0) hatsStraight++;
      }
      for (const e of melody) {
        mel++;
        if (MINOR_PENT.has((((e.pitch - style.keyPc) % 12) + 12) % 12)) melPent++;
      }
    }
  }
  return {
    tempo: state.tempo ?? 0,
    power: powerOk / Math.max(1, padChords),
    backbeat: backbeatOk / Math.max(1, drumBars),
    hats: hatsStraight / Math.max(1, hats),
    pent: melPent / Math.max(1, mel),
    driving: drivingBars / Math.max(1, bars),
    bassPerBar: bassNotes / Math.max(1, bassBars),
  };
}

const seeds = ["g1", "g2", "g3", "g4"];

describe("Metal conformance", () => {
  const metalStyle: StylePack = {
    ...testStyle, keyPc: 4, chordStyle: "power", bassStyle: "root-drive",
    rhythm: { ...(testStyle.rhythm ?? {}), groove: "backbeat" },
    melody: { ...(testStyle.melody ?? {}), scale: "minor-pentatonic" },
    tempoRange: [140, 180],
  };
  const m = measure(metalStyle, { energy: 0.9, tension: 0.62, valence: 0.28, density: 0.72, complexity: 0.5, instability: 0.4, brightness: 0.42, tempo: 160 }, seeds);
  it("power chords, backbeat, pentatonic, fast tempo, driving", () => {
    expect(m.tempo).toBeGreaterThanOrEqual(140);
    expect(m.tempo).toBeLessThanOrEqual(180);
    expect(m.power).toBeGreaterThanOrEqual(0.9);
    expect(m.backbeat).toBeGreaterThanOrEqual(0.9);
    expect(m.pent).toBeGreaterThanOrEqual(0.85);
    expect(m.bassPerBar).toBeGreaterThanOrEqual(5);
    expect(m.driving).toBeGreaterThanOrEqual(0.8);
  });
});

describe("Pop conformance", () => {
  const popStyle: StylePack = {
    ...testStyle, keyPc: 0, defaultMode: "major", chordStyle: "triad", bassStyle: "root-drive",
    rhythm: { ...(testStyle.rhythm ?? {}), groove: "backbeat" },
    tempoRange: [100, 128],
  };
  const m = measure(popStyle, { energy: 0.7, tension: 0.3, valence: 0.72, density: 0.55, complexity: 0.35, instability: 0.25, brightness: 0.6, tempo: 118 }, seeds);
  it("backbeat, mid tempo, triads (not power), driving bass", () => {
    expect(m.tempo).toBeGreaterThanOrEqual(100);
    expect(m.tempo).toBeLessThanOrEqual(128);
    expect(m.backbeat).toBeGreaterThanOrEqual(0.9);
    expect(m.power).toBeLessThan(0.5); // pop uses triads, not power chords
    expect(m.bassPerBar).toBeGreaterThanOrEqual(5);
    expect(m.driving).toBeGreaterThanOrEqual(0.8);
  });
});
