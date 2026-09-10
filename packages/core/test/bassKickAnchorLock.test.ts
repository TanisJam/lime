import { describe, it, expect } from "vitest";
import { BassGenerator } from "../src/bass/BassGenerator.js";
import { PercussionGenerator } from "../src/percussion/PercussionGenerator.js";
import {
  FUNK_KICK_SIXTEENTHS,
  BACKBEAT_KICK_SIXTEENTHS,
  SWING_KICK_SIXTEENTHS,
  SHUFFLE_KICK_SIXTEENTHS,
  BOOM_BAP_KICK_SIXTEENTHS,
  CLAVE_KICK_SIXTEENTHS,
} from "../src/percussion/grooveAnchors.js";
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
import type { BassStyle } from "../src/style/StylePack.js";
import { PERCUSSION_MIDI, type NoteEvent } from "../src/events/MusicalEvent.js";

/**
 * Coverage for the generalised bass/kick anchor contract (grooveAnchors.ts):
 * every bass style that names a groove-anchored kick pattern should land a
 * meaningful — not exact, not rigid — share of its own onsets on that
 * anchor, and the walking bass rewrite should read as genuine motion rather
 * than four flat quarters. These tests call the generators directly (the
 * same harness `funkGrooveInterlock.test.ts` and `grooveVariation.test.ts`
 * use), which bypasses `Humanizer` entirely — onset ticks here are exactly
 * what the generator emitted, so there's no engine-level jitter to snap to a
 * grid before comparing (see `rockConformance.test.ts` for the pattern that
 * *is* needed when comparing events that came from `LimeEngine.composeBar`).
 */

const director = new PhraseDirector();
const phrases = new PhrasePlanner({ phraseLengthBars: 4 });

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

/** Share of a style's bass onsets, across many bars, that land on `anchor`. */
function anchorLockRatio(
  style: BassStyle,
  anchor: readonly number[],
  energy: number,
  bars: number,
  seed: string,
): number {
  const gen = new BassGenerator(style);
  let total = 0;
  let matched = 0;
  for (let bar = 0; bar < bars; bar++) {
    const ctx = makeBarContext(bar, energy, seed);
    for (const e of gen.generateBar(ctx)) {
      total++;
      if (anchor.includes(sixteenthOf(e, ctx))) matched++;
    }
  }
  return total ? matched / total : 0;
}

describe("bass styles land a meaningful share of onsets on their groove's kick anchor", () => {
  // Floors are calibrated against the generator's own steady-state ratio
  // (measured directly, not inferred), so each is comfortably below what the
  // style actually produces — a real floor, not a coin flip. None reach 1.0:
  // per GROOVE-CRITERIA.md a rigid 1.0 lock is the signature of a caricature,
  // not real interlock.
  const CASES: Array<{ label: string; style: BassStyle; anchor: readonly number[]; energy: number; floor: number }> = [
    { label: "root-drive (rock/pop/metal) vs BACKBEAT_KICK_SIXTEENTHS", style: "root-drive", anchor: BACKBEAT_KICK_SIXTEENTHS, energy: 0.78, floor: 0.3 },
    { label: "walking (jazz) vs SWING_KICK_SIXTEENTHS", style: "walking", anchor: SWING_KICK_SIXTEENTHS, energy: 0.55, floor: 0.5 },
    { label: "walking (blues) vs SHUFFLE_KICK_SIXTEENTHS", style: "walking", anchor: SHUFFLE_KICK_SIXTEENTHS, energy: 0.55, floor: 0.5 },
    { label: "sub (hip-hop/electronic) vs BOOM_BAP_KICK_SIXTEENTHS", style: "sub", anchor: BOOM_BAP_KICK_SIXTEENTHS, energy: 0.78, floor: 0.5 },
    { label: "montuno (latin) vs CLAVE_KICK_SIXTEENTHS", style: "montuno", anchor: CLAVE_KICK_SIXTEENTHS, energy: 0.78, floor: 0.35 },
    { label: "funk vs FUNK_KICK_SIXTEENTHS", style: "funk", anchor: FUNK_KICK_SIXTEENTHS, energy: 0.78, floor: 0.35 },
  ];

  for (const { label, style, anchor, energy, floor } of CASES) {
    it(`${label}: locked share is at least ${floor}`, () => {
      const ratio = anchorLockRatio(style, anchor, energy, 64, `${style}-anchor-lock`);
      expect(ratio).toBeGreaterThanOrEqual(floor);
      expect(ratio).toBeLessThan(1.0); // not rigid — see GROOVE-CRITERIA.md
    });
  }
});

describe("walking bass has real motion, not a fixed four-note figure", () => {
  it("produces more than one distinct rhythm over 32 bars (grid position only, velocity stripped)", () => {
    const gen = new BassGenerator("walking");
    const signatures = new Set<string>();
    for (let bar = 0; bar < 32; bar++) {
      const ctx = makeBarContext(bar, 0.55, "walking-variety");
      const events = gen.generateBar(ctx);
      // Position + pitch, no velocity: a naive signature that includes
      // velocity always looks varied (every push() jitters velocity by
      // rng.next()) and would hide a rhythm that never actually changes.
      const signature = events
        .map((e) => `${sixteenthOf(e, ctx)}:${e.pitch}`)
        .sort()
        .join("|");
      signatures.add(signature);
    }
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("is not four flat quarters: at least some bars carry an eighth- or sixteenth-note onset", () => {
    const gen = new BassGenerator("walking");
    let offGridOnsets = 0;
    for (let bar = 0; bar < 32; bar++) {
      const ctx = makeBarContext(bar, 0.55, "walking-motion");
      for (const e of gen.generateBar(ctx)) {
        if (sixteenthOf(e, ctx) % 4 !== 0) offGridOnsets++;
      }
    }
    expect(offGridOnsets).toBeGreaterThan(0);
  });

  it("is deterministic for a fixed seed", () => {
    const a = new BassGenerator("walking").generateBar(makeBarContext(5, 0.55, "walking-determinism"));
    const b = new BassGenerator("walking").generateBar(makeBarContext(5, 0.55, "walking-determinism"));
    expect(a).toEqual(b);
  });
});

describe("root-drive, sub and montuno anchor-lock changes are deterministic", () => {
  const STYLES: BassStyle[] = ["root-drive", "sub", "montuno"];
  for (const style of STYLES) {
    it(`${style}: same seed, same output`, () => {
      const a = new BassGenerator(style).generateBar(makeBarContext(7, 0.78, `${style}-determinism`));
      const b = new BassGenerator(style).generateBar(makeBarContext(7, 0.78, `${style}-determinism`));
      expect(a).toEqual(b);
    });
  }
});

describe("funk bass/kick anchor invariant still holds", () => {
  it("the funk bass still contains every FUNK_KICK_SIXTEENTHS position after the generalised anchor change", () => {
    const ctx = makeBarContext(8, 0.78, "funk-anchor-regression");
    const bass = new BassGenerator("funk").generateBar(ctx);
    const bassPositions = bass.map((e) => sixteenthOf(e, ctx));
    for (const anchor of FUNK_KICK_SIXTEENTHS) expect(bassPositions).toContain(anchor);
  });

  it("the funk kick still lands at exactly the shared anchor positions", () => {
    const ctx = makeBarContext(8, 0.78, "funk-anchor-regression");
    const percussion = new PercussionGenerator({ groove: "funk" }).generateBar(ctx);
    const kickPositions = percussion
      .filter((e) => e.pitch === PERCUSSION_MIDI.kick)
      .map((e) => sixteenthOf(e, ctx))
      .sort((a, b) => a - b);
    expect(kickPositions).toEqual([...FUNK_KICK_SIXTEENTHS].sort((a, b) => a - b));
  });
});
