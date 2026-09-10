import { describe, it, expect } from "vitest";
import { ROLE_REGISTERS } from "../src/harmony/Registers.js";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";
import type { MusicalStatePatch } from "../src/state/MusicalState.js";
import type { ChordStyle, StylePack } from "../src/style/StylePack.js";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function pitchesByVoice(
  state: MusicalStatePatch,
  overrides?: { chordStyle?: ChordStyle; keyPc?: number; melody?: StylePack["melody"] },
  seed = "registers",
): Record<string, number[]> {
  const style = overrides ? { ...testStyle, ...overrides } : testStyle;
  const engine = new LimeEngine({ seed, style, initialState: state });
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

  it("holds the pad inside its register", () => {
    const p = pitchesByVoice({
      energy: 0.7,
      tension: 0.4,
      brightness: 0.8,
      density: 0.6,
      complexity: 0.4,
      tempo: 84,
    });
    // Voice leading picks only in-band voicings, so the pad never climbs into
    // the melody's range even under adventurous harmony. A small margin covers
    // the rare chord with no fully in-band voicing.
    expect(Math.max(...p.pad!)).toBeLessThanOrEqual(ROLE_REGISTERS.pad.hi + 4);
  });

  // The test above pins two things without saying so: it leaves chordStyle unset,
  // so it only ever walks the triad path through voiceLeadChord, and testStyle
  // sits in C (keyPc 0). Each chordStyle reaches the pad through a different
  // voicing function and they do not share the register logic, and the register
  // is absolute while the key is not — a pack in A (rock's keyPc is 9) starts
  // nine semitones higher with nothing folding it back. The invariant has to
  // hold in every key, or it is an invariant about C.
  const KEYS = [0, 3, 6, 9];
  it.each(
    (["triad", "power", "seventh"] as ChordStyle[]).flatMap((chordStyle) =>
      KEYS.map((keyPc) => [chordStyle, keyPc] as const),
    ),
  )("holds the pad inside its register with %s chords in key %i", (chordStyle, keyPc) => {
    const p = pitchesByVoice(
      { energy: 0.8, tension: 0.6, brightness: 0.38, density: 0.6, complexity: 0.55, tempo: 126 },
      { chordStyle, keyPc },
    );
    expect(Math.max(...p.pad!)).toBeLessThanOrEqual(ROLE_REGISTERS.pad.hi + 4);
  });

  it("folds melody events into the declared register without changing pitch class", () => {
    const unbounded = { ...testStyle, melody: { register: undefined } } satisfies StylePack;
    const bounded = {
      ...testStyle,
      melody: { register: { lo: 55, hi: 76 } },
    } satisfies StylePack;
    const state = {
      energy: 0.8, tension: 0.6, brightness: 0.38, density: 0.6,
      complexity: 0.55, tempo: 126,
    };
    for (const keyPc of [0, 4, 9]) {
      for (const seed of ["register-c", "register-e", "register-a"]) {
        const raw = pitchesByVoice(state, { ...unbounded, keyPc }, seed).melody!;
        const folded = pitchesByVoice(state, { ...bounded, keyPc }, seed).melody!;
        expect(folded.length).toBeGreaterThan(0);
        expect(Math.min(...folded)).toBeGreaterThanOrEqual(55);
        expect(Math.max(...folded)).toBeLessThanOrEqual(76);
        expect(folded.map((p) => p % 12)).toEqual(raw.map((p) => p % 12));
      }
    }
  });

  it("rejects contradictory melody register bounds", () => {
    expect(() =>
      pitchesByVoice(
        { energy: 0.8, tension: 0.6, brightness: 0.38, density: 0.6, complexity: 0.55, tempo: 126 },
        { melody: { register: { lo: 80, hi: 60 } } },
      ),
    ).toThrow("lower bound must not exceed");
  });

  it("rejects a narrow register when the pitch class cannot fit", () => {
    expect(() =>
      pitchesByVoice(
        { energy: 0.8, tension: 0.6, brightness: 0.38, density: 0.6, complexity: 0.55, tempo: 126 },
        { melody: { register: { lo: 60, hi: 60 } } },
      ),
    ).toThrow("pitch class cannot fit");
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
