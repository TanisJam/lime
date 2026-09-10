import { describe, it, expect } from "vitest";
import { PercussionGenerator } from "../src/percussion/PercussionGenerator.js";
import { FUNK_KICK_SIXTEENTHS } from "../src/percussion/grooveAnchors.js";
import { PhraseDirector } from "../src/phrase/PhrasePlan.js";
import type { PhrasePlan } from "../src/phrase/PhrasePlan.js";
import { PhrasePlanner } from "../src/phrase/PhrasePlanner.js";
import { OrchestrationDirector } from "../src/orchestration/OrchestrationDirector.js";
import { FormDirector } from "../src/phrase/FormDirector.js";
import { makeHarmonicEvent } from "../src/harmony/Chord.js";
import { DEFAULT_STATE, applyPatch } from "../src/state/MusicalState.js";
import { SeededRandom } from "../src/random/SeededRandom.js";
import { FOUR_FOUR, ticksPerBar, ticksPerBeat } from "../src/time/MusicalTime.js";
import type { BarContext } from "../src/orchestration/BarContext.js";
import { PERCUSSION_MIDI, type NoteEvent } from "../src/events/MusicalEvent.js";
import type { GrooveStyle } from "../src/style/StylePack.js";

/**
 * Regression coverage for the "one repeated pattern for 96 bars" defect:
 * six of the seven named grooves (`backbeat` was already wired to
 * `grooveVariation`) had zero `rng` calls, so only velocity ever changed
 * bar to bar. See GROOVE-CRITERIA.md and PercussionGenerator.ts's per-groove
 * doc comments for the musical rationale behind each variation.
 */

const BAR_TICKS = ticksPerBar(FOUR_FOUR);
const director = new PhraseDirector();
const phrases = new PhrasePlanner({ phraseLengthBars: 4 });

/**
 * A bar context at a fixed energy/density so a groove's own gate conditions
 * stay open across every bar, with a fresh per-bar RNG stream derived from a
 * shared seed — the same derivation shape `Orchestrator` uses in the real
 * engine (`percRng.derive(String(bar))`), so the RNG sequence a groove sees
 * here is representative of what it sees in a real render.
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
    barStartTick: bar * BAR_TICKS,
    meter: FOUR_FOUR,
    state,
    chord,
    nextChord: undefined,
    phrase,
    phrasePlan: plan,
    orchestration,
    rng: new SeededRandom(seed).derive(String(bar)),
  };
}

/** Sixteenth-note position (0..15) of a note event within its bar. */
function sixteenthOf(e: NoteEvent, ctx: BarContext): number {
  const s = ticksPerBeat(ctx.meter) / 4;
  return Math.round((e.time - ctx.barStartTick) / s);
}

/** Canonical bar signature: sorted (offset-within-bar, drum voice) pairs, velocity stripped. */
function barSignature(events: NoteEvent[], ctx: BarContext): string {
  return events
    .map((e) => `${e.time - ctx.barStartTick}:${e.percussion}`)
    .sort()
    .join("|");
}

/**
 * A `SeededRandom` that counts every draw. Used to prove `grooveVariation: 0`
 * consumes exactly one RNG draw per emitted note (the shared `hit()`
 * helper's own velocity jitter) and nothing more — i.e. every variation
 * branch really does short-circuit before touching `rng`, not just "usually".
 */
class CountingRandom extends SeededRandom {
  calls = 0;
  override next(): number {
    this.calls++;
    return super.next();
  }
  override bool(p?: number): boolean {
    this.calls++;
    return super.bool(p);
  }
  override pick<T>(items: readonly T[]): T {
    this.calls++;
    return super.pick(items);
  }
}

function makeCountingBarContext(bar: number, energy: number, seed: string): BarContext {
  const ctx = makeBarContext(bar, energy, seed);
  return { ...ctx, rng: new CountingRandom(`${seed}/${bar}`) };
}

/** The six grooves this change taught to vary, with the gv values they ship with (genres.ts). */
const GROOVES: Array<{ groove: GrooveStyle; gv: number; label: string }> = [
  { groove: "swing", gv: 0.85, label: "jazz swing" },
  { groove: "shuffle", gv: 0.6, label: "blues shuffle" },
  { groove: "funk", gv: 0.75, label: "funk" },
  { groove: "four-on-floor", gv: 0.85, label: "electronic four-on-floor" },
  { groove: "boom-bap", gv: 0.55, label: "hip-hop boom-bap" },
  { groove: "clave", gv: 0.5, label: "latin clave" },
];

const BARS = 40;
const ENERGY = 0.78;

describe("grooveVariation produces varied rhythms, not one pattern repeated", () => {
  for (const { groove, gv, label } of GROOVES) {
    it(`${label}: distinct rhythms over ${BARS} bars is well above 1`, () => {
      const gen = new PercussionGenerator({ groove, grooveVariation: gv });
      const signatures = new Set<string>();
      for (let bar = 0; bar < BARS; bar++) {
        const ctx = makeBarContext(bar, ENERGY, `${groove}-variety`);
        const events = gen.generateBar(ctx);
        signatures.add(barSignature(events, ctx));
      }
      expect(signatures.size).toBeGreaterThan(1);
      expect(signatures.size).toBeGreaterThanOrEqual(4);
    });
  }
});

describe("grooveVariation: 0 short-circuits before any RNG draw", () => {
  for (const { groove, label } of GROOVES) {
    it(`${label}: gv=0 draws RNG only for the per-note velocity jitter every hit already used`, () => {
      const gen = new PercussionGenerator({ groove, grooveVariation: 0 });
      const ctx = makeCountingBarContext(5, ENERGY, `${groove}-no-draw`);
      const events = gen.generateBar(ctx);
      const rng = ctx.rng as CountingRandom;
      // Every emitted note draws exactly one rng.next() in the shared hit()
      // helper (velocity jitter) — that's pre-existing, unrelated to
      // grooveVariation. If gv=0 truly short-circuits every variation branch,
      // the draw count can be no more than that: one per note, nothing extra.
      expect(rng.calls).toBe(events.length);
    });

    it(`${label}: gv=0 is deterministic — a fixed seed reproduces the identical bar`, () => {
      const genA = new PercussionGenerator({ groove, grooveVariation: 0 });
      const genB = new PercussionGenerator({ groove, grooveVariation: 0 });
      const a = genA.generateBar(makeBarContext(3, ENERGY, `${groove}-determinism`));
      const b = genB.generateBar(makeBarContext(3, ENERGY, `${groove}-determinism`));
      expect(a).toEqual(b);
    });
  }
});

describe("grooveVariation > 0 is still fully deterministic for a fixed seed", () => {
  for (const { groove, gv, label } of GROOVES) {
    it(`${label}: same seed, same bar, same output`, () => {
      const genA = new PercussionGenerator({ groove, grooveVariation: gv });
      const genB = new PercussionGenerator({ groove, grooveVariation: gv });
      const a = genA.generateBar(makeBarContext(11, ENERGY, `${groove}-determinism-gv`));
      const b = genB.generateBar(makeBarContext(11, ENERGY, `${groove}-determinism-gv`));
      expect(a).toEqual(b);
    });
  }
});

describe("Electronic's four-on-the-floor kick never moves", () => {
  const expectedKickSteps = [0, 4, 8, 12]; // beats 1..4 on the 16-step grid

  it("kick lands on every beat regardless of grooveVariation", () => {
    for (const gv of [0, 0.3, 0.7, 1]) {
      const gen = new PercussionGenerator({ groove: "four-on-floor", grooveVariation: gv });
      for (let bar = 0; bar < 12; bar++) {
        const ctx = makeBarContext(bar, ENERGY, `electronic-kick-lock-${gv}`);
        const events = gen.generateBar(ctx);
        const kickSteps = events
          .filter((e) => e.pitch === PERCUSSION_MIDI.kick)
          .map((e) => sixteenthOf(e, ctx))
          .sort((x, y) => x - y);
        expect(kickSteps).toEqual(expectedKickSteps);
      }
    }
  });
});

describe("Funk's kick always includes the FUNK_KICK_SIXTEENTHS anchors", () => {
  it("the shared bass/kick anchor positions survive at every grooveVariation", () => {
    for (const gv of [0, 0.3, 0.75, 1]) {
      const gen = new PercussionGenerator({ groove: "funk", grooveVariation: gv });
      for (let bar = 0; bar < 12; bar++) {
        const ctx = makeBarContext(bar, ENERGY, `funk-kick-anchor-${gv}`);
        const events = gen.generateBar(ctx);
        const kickSteps = new Set(
          events.filter((e) => e.pitch === PERCUSSION_MIDI.kick).map((e) => sixteenthOf(e, ctx)),
        );
        for (const anchor of FUNK_KICK_SIXTEENTHS) expect(kickSteps.has(anchor)).toBe(true);
      }
    }
  });
});

/**
 * `backbeat()` (Rock/Pop/Metal) was already the reference implementation for
 * `grooveVariation` before this change, so it isn't in `GROOVES` above — but
 * its ghost-snare density was strengthened in a follow-up pass (the original
 * two-candidate version was too weak to move Rock's measured backbeat share
 * from ~0.89 toward its 0.46 target). This covers that new ghost-snare code
 * specifically, at Rock's real app-layer grooveVariation (0.5).
 */
describe("backbeat()'s ghost-snare density (Rock/Pop/Metal shared groove)", () => {
  const ROCK_GV = 0.5;

  it("distinct rhythms over 40 bars at gv=0.5 is well above 1", () => {
    const gen = new PercussionGenerator({ groove: "backbeat", grooveVariation: ROCK_GV });
    const signatures = new Set<string>();
    for (let bar = 0; bar < BARS; bar++) {
      const ctx = makeBarContext(bar, ENERGY, "backbeat-variety");
      signatures.add(barSignature(gen.generateBar(ctx), ctx));
    }
    expect(signatures.size).toBeGreaterThanOrEqual(4);
  });

  it("gv=0 keeps exactly the two canonical backbeat snares and no ghosts", () => {
    const gen = new PercussionGenerator({ groove: "backbeat", grooveVariation: 0 });
    for (let bar = 0; bar < 12; bar++) {
      const ctx = makeBarContext(bar, ENERGY, "backbeat-no-ghosts");
      const events = gen.generateBar(ctx);
      const snareSteps = events
        .filter((e) => e.pitch === PERCUSSION_MIDI.snare)
        .map((e) => sixteenthOf(e, ctx))
        .sort((x, y) => x - y);
      expect(snareSteps).toEqual([4, 12]);
    }
  });

  it("gv=0.5 is deterministic — a fixed seed reproduces the identical bar", () => {
    const genA = new PercussionGenerator({ groove: "backbeat", grooveVariation: ROCK_GV });
    const genB = new PercussionGenerator({ groove: "backbeat", grooveVariation: ROCK_GV });
    const a = genA.generateBar(makeBarContext(11, ENERGY, "backbeat-determinism"));
    const b = genB.generateBar(makeBarContext(11, ENERGY, "backbeat-determinism"));
    expect(a).toEqual(b);
  });
});
