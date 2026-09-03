import { it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";
import type { StylePack } from "../src/style/StylePack.js";

const BAR = 1920;
const BEAT = 480;
const rockStyle: StylePack = {
  ...testStyle,
  keyPc: 4, // E — the rock key
  chordStyle: "power",
  bassStyle: "root-drive",
  rhythm: { ...(testStyle.rhythm ?? {}), groove: "backbeat" },
  melody: { ...(testStyle.melody ?? {}), scale: "minor-pentatonic" },
  tempoRange: [110, 140],
};
const ROCK_STATE = {
  energy: 0.78, tension: 0.45, valence: 0.4, density: 0.62,
  complexity: 0.4, instability: 0.3, brightness: 0.5, tempo: 126,
};
const MINOR_PENT = new Set([0, 3, 5, 7, 10]); // rock/blues minor pentatonic

it("rock conformance across seeds", () => {
  const seeds = ["rock-1", "rock-2", "rock-3", "rock-4", "rock-5"];
  let padChords = 0, powerOk = 0;
  let drumBars = 0, backbeatOk = 0;
  let hats = 0, hatsStraight = 0;
  let mel = 0, melPent = 0;
  let bars = 0, drivingBars = 0;
  let bassNotes = 0, bassBars = 0;

  for (const seed of seeds) {
    const eng = new LimeEngine({ seed, style: rockStyle, initialState: ROCK_STATE });
    for (let bar = 0; bar < 64; bar++) {
      const evs = eng.composeBar(bar);
      bars++;
      const pad = evs.filter((e) => e.voice === "pad");
      const perc = evs.filter((e) => e.voice === "percussion");
      const melody = evs.filter((e) => e.voice === "melody");
      const bass = evs.filter((e) => e.voice === "bass");
      if (perc.length + melody.length + pad.length > 6) drivingBars++;
      if (bass.length) { bassBars++; bassNotes += bass.length; }

      // Power chords: each pad onset should have a fifth and no third.
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

      // Backbeat: snare on beats 2 & 4.
      const snares = perc.filter((e) => e.percussion === "snare").map((e) => e.time - bar * BAR);
      if (perc.length > 0) {
        drumBars++;
        if (snares.includes(BEAT) && snares.includes(BEAT * 3)) backbeatOk++;
      }
      // Straight hats: on the 8th grid.
      for (const e of perc.filter((x) => x.percussion === "hat")) {
        hats++;
        if ((e.time - bar * BAR) % (BEAT / 2) === 0) hatsStraight++;
      }
      // Pentatonic melody.
      for (const e of melody) {
        mel++;
        if (MINOR_PENT.has((((e.pitch - rockStyle.keyPc) % 12) + 12) % 12)) melPent++;
      }
    }
  }
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(0) : "–") + "%";
  console.log(
    `\n=== ROCK CONFORMANCE (${bars} bars, ${seeds.length} seeds) ===\n` +
      `tempo:            ${ROCK_STATE.tempo} (target 110–140)\n` +
      `power chords:     ${pct(powerOk, padChords)}  (${powerOk}/${padChords})   [target ≥90%]\n` +
      `backbeat (2&4):   ${pct(backbeatOk, drumBars)}  (${backbeatOk}/${drumBars} drum-bars)   [≥90%]\n` +
      `straight hats:    ${pct(hatsStraight, hats)}   [≥90%]\n` +
      `pentatonic melody:${pct(melPent, mel)}  (${melPent}/${mel})   [≥85%]\n` +
      `driving bars:     ${pct(drivingBars, bars)}   [≥80%]\n` +
      `bass notes/bar:   ${(bassNotes / Math.max(1, bassBars)).toFixed(1)}   [≥5 = 8th drive]\n` +
      `drum-bars:        ${pct(drumBars, bars)}`,
  );

  // Structural conformance to the rock fingerprint (GENRES.md), across seeds.
  expect(ROCK_STATE.tempo).toBeGreaterThanOrEqual(110);
  expect(ROCK_STATE.tempo).toBeLessThanOrEqual(140);
  expect(powerOk / padChords).toBeGreaterThanOrEqual(0.9); // power chords
  expect(backbeatOk / drumBars).toBeGreaterThanOrEqual(0.9); // snare on 2 & 4
  expect(hatsStraight / hats).toBeGreaterThanOrEqual(0.9); // straight 8th hats
  expect(melPent / mel).toBeGreaterThanOrEqual(0.85); // pentatonic melody
  expect(drivingBars / bars).toBeGreaterThanOrEqual(0.8); // driving arrangement
  expect(bassNotes / Math.max(1, bassBars)).toBeGreaterThanOrEqual(5); // bass 8th drive
});
