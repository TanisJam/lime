import { describe, it, expect } from "vitest";
import { BassGenerator } from "../src/bass/BassGenerator.js";
import { PercussionGenerator } from "../src/percussion/PercussionGenerator.js";
import { FUNK_KICK_SIXTEENTHS } from "../src/percussion/grooveAnchors.js";
import { PhraseDirector } from "../src/phrase/PhrasePlan.js";
import type { PhrasePlan } from "../src/phrase/PhrasePlan.js";
import { PhrasePlanner } from "../src/phrase/PhrasePlanner.js";
import { OrchestrationDirector } from "../src/orchestration/OrchestrationDirector.js";
import { FormDirector } from "../src/phrase/FormDirector.js";
import { chordRoot, makeHarmonicEvent } from "../src/harmony/Chord.js";
import { DEFAULT_STATE, applyPatch } from "../src/state/MusicalState.js";
import { SeededRandom } from "../src/random/SeededRandom.js";
import { FOUR_FOUR, ticksPerBeat } from "../src/time/MusicalTime.js";
import type { BarContext } from "../src/orchestration/BarContext.js";
import { PERCUSSION_MIDI, type NoteEvent } from "../src/events/MusicalEvent.js";

const director = new PhraseDirector();
const phrases = new PhrasePlanner({ phraseLengthBars: 4 });
const BASS_OCTAVE = 2;

/**
 * A bar context with a directly controlled arc (phrasePlan.energy), so the
 * funk-specific branches (which gate on `arc >= 0.4`) can be exercised or
 * withheld deterministically, independent of how the phrase director would
 * otherwise shape energy across a phrase.
 */
function makeBarContext(energy: number, seed: string): BarContext {
  const state = applyPatch(DEFAULT_STATE, { energy, density: 0.7, complexity: 0.5 });
  const phrase = phrases.at(8); // a development phrase
  const basePlan = director.plan(state, phrase);
  // Force the exact arc value and a neutral melodic activity so arc === energy
  // (neither the "lead" step-down nor the "tacet" boost applies).
  const plan: PhrasePlan = { ...basePlan, energy, melodicActivity: "sparse" };
  const form = new FormDirector().at(8, 4);
  const orchestration = new OrchestrationDirector().plan(state, plan, form);
  const chord = makeHarmonicEvent({ bar: 0, durationBars: 1, degree: 1, keyPc: 0, mode: "major" });
  return {
    bar: 8,
    barStartTick: 0,
    meter: FOUR_FOUR,
    state,
    chord,
    nextChord: makeHarmonicEvent({ bar: 1, durationBars: 1, degree: 5, keyPc: 0, mode: "major" }),
    phrase,
    phrasePlan: plan,
    orchestration,
    rng: new SeededRandom(seed),
  };
}

/** Sixteenth-note position (0..15) of a note event within its bar. */
function sixteenthOf(e: NoteEvent, ctx: BarContext): number {
  const s = ticksPerBeat(ctx.meter) / 4;
  return Math.round((e.time - ctx.barStartTick) / s);
}

describe("funk bass/kick interlock", () => {
  it("has the funk bass land on every shared kick anchor", () => {
    const ctx = makeBarContext(0.78, "funk-interlock");
    const bass = new BassGenerator("funk").generateBar(ctx);
    const bassPositions = bass.map((e) => sixteenthOf(e, ctx));
    for (const anchor of FUNK_KICK_SIXTEENTHS) {
      expect(bassPositions).toContain(anchor);
    }
  });

  it("interlocks bass onsets with funk kicks at a ratio at least matching real funk", () => {
    const ctx = makeBarContext(0.78, "funk-interlock");
    const bass = new BassGenerator("funk").generateBar(ctx);
    const bassPositions = bass.map((e) => sixteenthOf(e, ctx));
    const kickPositions = new Set<number>(FUNK_KICK_SIXTEENTHS);
    const withinTolerance = (pos: number) =>
      [...kickPositions].some((kick) => Math.abs(kick - pos) <= 1);
    const interlocked = bassPositions.filter(withinTolerance).length;
    const ratio = interlocked / bassPositions.length;
    expect(ratio).toBeGreaterThanOrEqual(0.35);
  });

  it("produces the exact expected sixteenth pattern for the funk bass at a fixed seed", () => {
    const ctx = makeBarContext(0.78, "funk-interlock");
    const bass = new BassGenerator("funk").generateBar(ctx);
    const bassPositions = bass.map((e) => sixteenthOf(e, ctx)).sort((a, b) => a - b);
    expect(bassPositions).toEqual([0, 3, 6, 10, 13]);
  });

  it("places the funk kick at exactly the shared anchor positions", () => {
    const ctx = makeBarContext(0.78, "funk-interlock");
    const percussion = new PercussionGenerator({ groove: "funk" }).generateBar(ctx);
    const kickPositions = percussion
      .filter((e: NoteEvent) => e.pitch === PERCUSSION_MIDI.kick)
      .map((e) => sixteenthOf(e, ctx))
      .sort((a, b) => a - b);
    expect(kickPositions).toEqual([...FUNK_KICK_SIXTEENTHS].sort((a, b) => a - b));
  });
});

describe("funk bass regression guards", () => {
  it("still plays the chord root on the downbeat", () => {
    const ctx = makeBarContext(0.78, "funk-interlock");
    const bass = new BassGenerator("funk").generateBar(ctx);
    const downbeat = bass.find((e) => sixteenthOf(e, ctx) === 0);
    expect(downbeat).toBeDefined();
    expect(downbeat!.pitch).toBe(chordRoot(ctx.chord, BASS_OCTAVE));
  });

  it("still respects the arc gate: below 0.4 the dedicated funk pattern does not fire", () => {
    const ctx = makeBarContext(0.25, "funk-interlock");
    const bass = new BassGenerator("funk").generateBar(ctx);
    const bassPositions = bass.map((e) => sixteenthOf(e, ctx)).sort((a, b) => a - b);
    // The five-onset funk pattern [0, 3, 6, 10, 13] only appears at arc >= 0.4.
    expect(bassPositions).not.toEqual([0, 3, 6, 10, 13]);
  });

  it("is deterministic for a fixed seed", () => {
    const a = new BassGenerator("funk").generateBar(makeBarContext(0.78, "funk-determinism"));
    const b = new BassGenerator("funk").generateBar(makeBarContext(0.78, "funk-determinism"));
    expect(a).toEqual(b);
  });
});
