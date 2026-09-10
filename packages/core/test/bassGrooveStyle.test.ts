import { describe, it, expect } from "vitest";
import { BassGenerator } from "../src/bass/BassGenerator.js";
import { PhraseDirector } from "../src/phrase/PhrasePlan.js";
import type { PhrasePlan } from "../src/phrase/PhrasePlan.js";
import { PhrasePlanner } from "../src/phrase/PhrasePlanner.js";
import { OrchestrationDirector } from "../src/orchestration/OrchestrationDirector.js";
import { FormDirector } from "../src/phrase/FormDirector.js";
import { makeHarmonicEvent } from "../src/harmony/Chord.js";
import { DEFAULT_STATE, applyPatch } from "../src/state/MusicalState.js";
import { SeededRandom } from "../src/random/SeededRandom.js";
import { FOUR_FOUR, ticksPerBeat } from "../src/time/MusicalTime.js";
import type { BarContext } from "../src/orchestration/BarContext.js";
import type { BassGrooveStyle, BassStyle } from "../src/style/StylePack.js";
import type { NoteEvent } from "../src/events/MusicalEvent.js";

/**
 * Coverage for per-genre bass shaping (`BassGrooveStyle`, StylePack.ts): the
 * fix for jazz and blues — both `bassStyle: "walking"` — landing on the exact
 * same bassKickLock/bassOffbeat numbers despite wanting different ones (see
 * GROOVE-CRITERIA.md and the genre configs in packages/styles/src/genres.ts
 * and genreTuning.ts, whose literal values are mirrored here). These tests
 * call `BassGenerator` directly, bypassing `Humanizer`, so onset ticks are
 * exactly what the generator emitted — no jitter to snap to a grid first.
 */

const director = new PhraseDirector();
const phrases = new PhrasePlanner({ phraseLengthBars: 4 });

// Mirrors the tuned values in packages/styles/src/genres.ts (popPack, jazzPack,
// bluesPack) and genreTuning.ts (ROCK_TUNING). Duplicated rather than imported
// — @lime/core cannot depend on @lime/styles (the dependency runs the other
// way) — the same way bassKickAnchorLock.test.ts hardcodes its own anchors.
const ROCK_GROOVE: BassGrooveStyle = { syncopation: 0.45, kickLock: 0.65 };
const POP_GROOVE: BassGrooveStyle = { syncopation: 0.07, kickLock: 0.165 };
const JAZZ_GROOVE: BassGrooveStyle = { syncopation: 0.34, kickLock: 0.82 };
const BLUES_GROOVE: BassGrooveStyle = { syncopation: 0.1, kickLock: 0.16 };

/**
 * A bar context with a directly controlled arc (phrasePlan.energy) and bar
 * index, so a style's dedicated branch (gated on `arc >= threshold`) fires
 * deterministically and each bar draws from a fresh, bar-derived RNG stream —
 * the same derivation shape `Orchestrator` uses (`bassRng.derive(String(bar))`).
 */
function makeBarContext(bar: number, energy: number, seed: string): BarContext {
  const state = applyPatch(DEFAULT_STATE, { energy, density: 0.7, complexity: 0.5 });
  const phrase = phrases.at(bar);
  const basePlan = director.plan(state, phrase);
  const plan: PhrasePlan = { ...basePlan, energy, melodicActivity: "sparse" };
  const form = new FormDirector().at(bar, 4);
  const orchestration = new OrchestrationDirector().plan(state, plan, form);
  const chord = makeHarmonicEvent({ bar, durationBars: 1, degree: 1, keyPc: 0, mode: "major" });
  return {
    bar,
    barStartTick: bar * 1920,
    meter: FOUR_FOUR,
    state,
    chord,
    nextChord: makeHarmonicEvent({ bar: bar + 1, durationBars: 1, degree: 5, keyPc: 0, mode: "major" }),
    phrase,
    phrasePlan: plan,
    orchestration,
    rng: new SeededRandom(seed).derive(String(bar)),
  };
}

/** Sixteenth-note position (0..15) of a note event within its bar. */
function sixteenthOf(e: NoteEvent, ctx: BarContext): number {
  const s = ticksPerBeat(ctx.meter) / 4;
  return Math.round((e.time - ctx.barStartTick) / s) % 16;
}

/** Share of bass onsets, across many bars, not on a quarter-note position (bassOffbeat). */
function offbeatShare(
  style: BassStyle,
  groove: BassGrooveStyle | undefined,
  energy: number,
  bars: number,
  seed: string,
): number {
  const gen = new BassGenerator(style, groove);
  let total = 0;
  let off = 0;
  for (let bar = 0; bar < bars; bar++) {
    const ctx = makeBarContext(bar, energy, seed);
    for (const e of gen.generateBar(ctx)) {
      total++;
      if (sixteenthOf(e, ctx) % 4 !== 0) off++;
    }
  }
  return total ? off / total : 0;
}

/** Share of bass onsets, across many bars, landing on one of `kickSteps` (bassKickLock). */
function kickLockShare(
  style: BassStyle,
  groove: BassGrooveStyle | undefined,
  kickSteps: readonly number[],
  energy: number,
  bars: number,
  seed: string,
): number {
  const gen = new BassGenerator(style, groove);
  const anchor = new Set(kickSteps);
  let total = 0;
  let locked = 0;
  for (let bar = 0; bar < bars; bar++) {
    const ctx = makeBarContext(bar, energy, seed);
    for (const e of gen.generateBar(ctx)) {
      total++;
      if (anchor.has(sixteenthOf(e, ctx))) locked++;
    }
  }
  return total ? locked / total : 0;
}

describe("per-genre bass shaping breaks the jazz/blues walking-bass tie", () => {
  it("jazz and blues, sharing bassStyle 'walking', produce different offbeat shares", () => {
    const jazz = offbeatShare("walking", JAZZ_GROOVE, 0.55, 64, "jazz-vs-blues");
    const blues = offbeatShare("walking", BLUES_GROOVE, 0.55, 64, "jazz-vs-blues");
    // Jazz is tuned for markedly more off-beat motion than blues (0.38 vs
    // 0.17 target, GROOVE-CRITERIA.md) — a real, not marginal, gap.
    expect(jazz).toBeGreaterThan(blues + 0.1);
  });

  it("rock and pop, sharing bassStyle 'root-drive', produce different offbeat shares", () => {
    const rock = offbeatShare("root-drive", ROCK_GROOVE, 0.78, 64, "rock-vs-pop");
    const pop = offbeatShare("root-drive", POP_GROOVE, 0.78, 64, "rock-vs-pop");
    // Pop's bass sits on the beat far more than it syncopates (0.16 target)
    // against rock's driving, syncopated pulse (0.53 target).
    expect(rock).toBeGreaterThan(pop + 0.2);
  });
});

describe("each configured genre's bass meets a real kick-lock floor", () => {
  const CASES: Array<{
    label: string; style: BassStyle; groove: BassGrooveStyle; kickSteps: number[]; floor: number;
  }> = [
    { label: "rock (root-drive)", style: "root-drive", groove: ROCK_GROOVE, kickSteps: [0, 8, 10], floor: 0.5 },
    { label: "pop (root-drive)", style: "root-drive", groove: POP_GROOVE, kickSteps: [0, 8, 10], floor: 0.5 },
    { label: "jazz (walking)", style: "walking", groove: JAZZ_GROOVE, kickSteps: [0, 4, 8, 10, 12], floor: 0.6 },
    { label: "blues (walking)", style: "walking", groove: BLUES_GROOVE, kickSteps: [0, 4, 8, 10, 12], floor: 0.6 },
  ];

  for (const { label, style, groove, kickSteps, floor } of CASES) {
    it(`${label}: locked share is at least ${floor}`, () => {
      const ratio = kickLockShare(style, groove, kickSteps, 0.78, 64, `${label}-kicklock`);
      expect(ratio).toBeGreaterThanOrEqual(floor);
      expect(ratio).toBeLessThan(1.0); // not rigid — see GROOVE-CRITERIA.md
    });
  }
});

describe("the funk bass branch is unaffected by BassGrooveStyle", () => {
  it("produces identical output with and without a bassGroove config", () => {
    const withoutGroove = new BassGenerator("funk").generateBar(
      makeBarContext(8, 0.78, "funk-groove-immune"),
    );
    const withGroove = new BassGenerator("funk", { syncopation: 0.9, kickLock: 0.9 }).generateBar(
      makeBarContext(8, 0.78, "funk-groove-immune"),
    );
    expect(withGroove).toEqual(withoutGroove);
  });
});

describe("BassGrooveStyle-configured generation is deterministic", () => {
  it("root-drive with a groove config: same seed, same output", () => {
    const a = new BassGenerator("root-drive", ROCK_GROOVE).generateBar(
      makeBarContext(7, 0.78, "root-drive-groove-determinism"),
    );
    const b = new BassGenerator("root-drive", ROCK_GROOVE).generateBar(
      makeBarContext(7, 0.78, "root-drive-groove-determinism"),
    );
    expect(a).toEqual(b);
  });

  it("walking with a groove config: same seed, same output", () => {
    const a = new BassGenerator("walking", JAZZ_GROOVE).generateBar(
      makeBarContext(7, 0.55, "walking-groove-determinism"),
    );
    const b = new BassGenerator("walking", JAZZ_GROOVE).generateBar(
      makeBarContext(7, 0.55, "walking-groove-determinism"),
    );
    expect(a).toEqual(b);
  });
});
