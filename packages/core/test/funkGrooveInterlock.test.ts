import { describe, it, expect } from "vitest";
import { BassGenerator } from "../src/bass/BassGenerator.js";
import { PercussionGenerator } from "../src/percussion/PercussionGenerator.js";
import { FUNK_KICK_SIXTEENTHS } from "../src/percussion/grooveAnchors.js";
import type { BassGrooveStyle } from "../src/style/StylePack.js";
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

/** Sorted sixteenth positions of a bar's bass onsets, as a comparable key. */
function onsets(bass: readonly NoteEvent[], ctx: BarContext): number[] {
  return bass.map((e) => sixteenthOf(e, ctx)).sort((a, b) => a - b);
}

/**
 * The funk line's identity: both shared kick anchors (the bass/kick interlock)
 * plus the two core pushes. These are present in every funk bar; only the bar's
 * finish and its optional ornaments move.
 */
const FUNK_IDENTITY = [...FUNK_KICK_SIXTEENTHS, 3, 10];

/**
 * The shipped `funkPack.bassGroove`. Every genre's real configuration lives in
 * the StylePack and reaches the generator through the Orchestrator's hints.
 * Asserting against an unconfigured generator (as this file used to) tests a
 * configuration no genre actually uses — which is how a single frozen rhythm
 * shipped behind green tests.
 */
const FUNK_PRODUCTION_GROOVE: BassGrooveStyle = { syncopation: 0.3 };

/**
 * Distinct sixteenth-note rhythms the funk bass produces across `bars` seeded
 * draws. Bars where the voice breathes out are skipped: an absent bar is not a
 * rhythm.
 */
function funkRhythms(
  bars: number,
  groove?: BassGrooveStyle,
  energy = 0.78,
): Set<string> {
  const rhythms = new Set<string>();
  for (let i = 0; i < bars; i++) {
    const ctx = makeBarContext(energy, `funk-rhythm-${i}`);
    const bass = new BassGenerator("funk", groove).generateBar(ctx);
    if (!bass.length) continue;
    rhythms.add(onsets(bass, ctx).join(","));
  }
  return rhythms;
}

describe("funk bass/kick interlock", () => {
  it("has the funk bass land on every shared kick anchor", () => {
    for (let i = 0; i < 32; i++) {
      const ctx = makeBarContext(0.78, `funk-interlock-${i}`);
      const bass = new BassGenerator("funk").generateBar(ctx);
      if (!bass.length) continue;
      const bassPositions = bass.map((e) => sixteenthOf(e, ctx));
      for (const anchor of FUNK_KICK_SIXTEENTHS) {
        expect(bassPositions).toContain(anchor);
      }
    }
  });

  it("keeps the kick anchors and the core pushes in every funk bar", () => {
    // Pinning one whole pattern here used to lock the voice to a single rhythm for
    // an entire session. The contract is the identity, not a pattern.
    for (let i = 0; i < 64; i++) {
      const ctx = makeBarContext(0.78, `funk-identity-${i}`);
      const bass = new BassGenerator("funk", FUNK_PRODUCTION_GROOVE).generateBar(ctx);
      if (!bass.length) continue;
      const positions = onsets(bass, ctx);
      for (const p of FUNK_IDENTITY) expect(positions).toContain(p);
    }
  });

  it("draws both ear-accepted finishes instead of freezing one", () => {
    // The two readings a listening pass already accepted: pushed out on the
    // off-quarter 16th, or grounded on the quarters. Before this change the
    // shipped configuration could only ever produce the grounded one.
    const rhythms = funkRhythms(96, FUNK_PRODUCTION_GROOVE);
    const pushed = [...rhythms].some((r) => {
      const p = r.split(",").map(Number);
      return p.includes(13) && !p.includes(8) && !p.includes(12);
    });
    const grounded = [...rhythms].some((r) => {
      const p = r.split(",").map(Number);
      return p.includes(8) && p.includes(12) && !p.includes(13);
    });
    expect(pushed).toBe(true);
    expect(grounded).toBe(true);
  });

  it("keeps the interlock dense enough to read as locked, not diluted", () => {
    // The interlock is measured as a *share* of the line's onsets, so an
    // unbounded number of ornaments would dilute it without the line ever
    // leaving the kick. Cap what a bar may carry alongside the anchors.
    for (let i = 0; i < 64; i++) {
      const ctx = makeBarContext(0.78, `funk-density-${i}`);
      const bass = new BassGenerator("funk", FUNK_PRODUCTION_GROOVE).generateBar(ctx);
      if (!bass.length) continue;
      const positions = bass.map((e) => sixteenthOf(e, ctx));
      for (const anchor of FUNK_KICK_SIXTEENTHS) expect(positions).toContain(anchor);
      expect(new Set(positions).size).toBeLessThanOrEqual(7);
    }
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

describe("funk bass variety", () => {
  it("does not repeat a single rhythm across a long span", () => {
    // The defect this guards: `syncopation` used to be a binary threshold that
    // pinned one of two hardcoded finishes before any random draw, so the shipped
    // funk configuration produced the same bar in every seed from bar 0 — 700
    // identical bars in a five-minute span. No positional metric in the groove
    // tables can see that, which is how it survived: every share stayed on target.
    expect(funkRhythms(96, FUNK_PRODUCTION_GROOVE).size).toBeGreaterThan(1);
  });

  it("varies across seeds, not only across bars", () => {
    const perSeed = new Set<string>();
    for (const seed of ["1", "2", "3", "4"]) {
      const ctx = makeBarContext(0.78, seed);
      const bass = new BassGenerator("funk", FUNK_PRODUCTION_GROOVE).generateBar(ctx);
      if (!bass.length) continue;
      perSeed.add(onsets(bass, ctx).join(","));
    }
    expect(perSeed.size).toBeGreaterThan(1);
  });

  it("stays interlocked and root-on-the-one under the shipped configuration", () => {
    for (let i = 0; i < 64; i++) {
      const ctx = makeBarContext(0.78, `funk-prod-${i}`);
      const bass = new BassGenerator("funk", FUNK_PRODUCTION_GROOVE).generateBar(ctx);
      if (!bass.length) continue;
      const positions = bass.map((e) => sixteenthOf(e, ctx));
      for (const anchor of FUNK_KICK_SIXTEENTHS) expect(positions).toContain(anchor);
      const downbeat = bass.find((e) => sixteenthOf(e, ctx) === 0);
      expect(downbeat).toBeDefined();
      expect(downbeat!.pitch).toBe(chordRoot(ctx.chord, BASS_OCTAVE));
    }
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
    // Below the gate the funky off-16th identity is absent: the calm grammar
    // sustains instead, so the core push at position 3 never appears.
    expect(bassPositions).not.toContain(3);
  });

  it("is deterministic for a fixed seed", () => {
    const a = new BassGenerator("funk").generateBar(makeBarContext(0.78, "funk-determinism"));
    const b = new BassGenerator("funk").generateBar(makeBarContext(0.78, "funk-determinism"));
    expect(a).toEqual(b);
  });

  it("is deterministic for a fixed seed under the shipped configuration", () => {
    const a = new BassGenerator("funk", FUNK_PRODUCTION_GROOVE).generateBar(
      makeBarContext(0.78, "funk-prod-determinism"),
    );
    const b = new BassGenerator("funk", FUNK_PRODUCTION_GROOVE).generateBar(
      makeBarContext(0.78, "funk-prod-determinism"),
    );
    expect(a).toEqual(b);
  });
});
