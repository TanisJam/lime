import { describe, it, expect } from "vitest";
import { ROLE_REGISTERS } from "../src/harmony/Registers.js";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";
import type { MusicalStatePatch } from "../src/state/MusicalState.js";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function pitchesByVoice(state: MusicalStatePatch): Record<string, number[]> {
  const engine = new LimeEngine({ seed: "registers", style: testStyle, initialState: state });
  const out: Record<string, number[]> = { bass: [], pad: [], melody: [] };
  for (let b = 0; b < 96; b++) {
    for (const ev of engine.step().events) {
      if (out[ev.voice]) out[ev.voice]!.push(ev.pitch);
    }
  }
  return out;
}

describe("register ownership", () => {
  it("orders the role bands bass < pad < melody", () => {
    expect(ROLE_REGISTERS.bass.lo).toBeLessThan(ROLE_REGISTERS.pad.lo);
    expect(ROLE_REGISTERS.pad.lo).toBeLessThan(ROLE_REGISTERS.melody.lo);
    expect(ROLE_REGISTERS.bass.hi).toBeLessThanOrEqual(ROLE_REGISTERS.melody.hi);
  });

  it("keeps the pad inside its register (below the melody)", () => {
    const p = pitchesByVoice({
      energy: 0.7,
      tension: 0.4,
      brightness: 0.8,
      density: 0.6,
      complexity: 0.4,
      tempo: 84,
    });
    // The pad's register bound is a soft target; allow a semitone of slack.
    expect(Math.max(...p.pad!)).toBeLessThanOrEqual(ROLE_REGISTERS.pad.hi + 1);
  });

  it("seats the melody above the pad and the bass below it", () => {
    const p = pitchesByVoice({
      energy: 0.7,
      tension: 0.4,
      brightness: 0.6,
      density: 0.6,
      complexity: 0.4,
      tempo: 84,
    });
    expect(median(p.bass!)).toBeLessThan(median(p.pad!));
    expect(median(p.pad!)).toBeLessThan(median(p.melody!));
  });
});
