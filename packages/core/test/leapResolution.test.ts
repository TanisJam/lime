import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle, allowedPitchClasses } from "./helpers.js";
import type { StylePack } from "../src/style/StylePack.js";
import type { MusicalStatePatch } from "../src/state/MusicalState.js";
import type { NoteEvent } from "../src/events/MusicalEvent.js";

// An active, low-complexity passage: plenty of melody, and resolution barely
// eased, so the effect of `leapResolution` is clear.
const ACTIVE: MusicalStatePatch = {
  energy: 0.9,
  tension: 0.4,
  valence: 0.5,
  density: 0.7,
  complexity: 0.3,
  instability: 0.3,
  tempo: 88,
};

function styleWith(leapResolution: number): StylePack {
  return { ...testStyle, melody: { leapResolution } };
}

function melodyLine(leapResolution: number): NoteEvent[] {
  const engine = new LimeEngine({
    seed: "leap-int",
    style: styleWith(leapResolution),
    initialState: ACTIVE,
  });
  const notes: NoteEvent[] = [];
  for (let b = 0; b < 96; b++) {
    for (const ev of engine.step().events) if (ev.voice === "melody") notes.push(ev);
  }
  notes.sort((a, b) => a.time - b.time);
  return notes;
}

/** Fraction of wide leaps (>= a 4th) immediately answered by a stepwise reversal. */
function resolutionRate(notes: NoteEvent[]): { leaps: number; rate: number } {
  let leaps = 0;
  let resolved = 0;
  for (let i = 1; i < notes.length - 1; i++) {
    const leap = notes[i]!.pitch - notes[i - 1]!.pitch;
    if (Math.abs(leap) < 5) continue;
    leaps++;
    const next = notes[i + 1]!.pitch - notes[i]!.pitch;
    if (Math.sign(next) === -Math.sign(leap) && Math.abs(next) <= 2) resolved++;
  }
  return { leaps, rate: leaps > 0 ? resolved / leaps : 0 };
}

describe("melody leap resolution", () => {
  it("answers far more leaps stepwise when the style asks for it", () => {
    const off = resolutionRate(melodyLine(0));
    const on = resolutionRate(melodyLine(1));
    expect(on.leaps).toBeGreaterThan(5); // the passage really does leap
    expect(on.rate).toBeGreaterThan(off.rate + 0.2);
  });

  it("keeps every resolved note in scale", () => {
    const allowed = allowedPitchClasses(testStyle.keyPc, testStyle.defaultMode);
    for (const n of melodyLine(1)) {
      expect(allowed.has(((n.pitch % 12) + 12) % 12)).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(resolutionRate(melodyLine(1))).toEqual(resolutionRate(melodyLine(1)));
  });
});
