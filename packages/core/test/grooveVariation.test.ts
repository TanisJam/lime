import { describe, it, expect } from "vitest";
import { PercussionGenerator } from "../src/percussion/PercussionGenerator.js";
import type { NoteEvent } from "../src/events/MusicalEvent.js";
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

/**
 * The funk hat layer and its ghosts — the two things that make the genre both
 * bright and, when they are wrong, pulse-less.
 *
 * Measured on LIME's own output for `genre-funk`: the hats were a full sixteenth
 * grid at a near-flat ~0.23 velocity. That is 75 % of the percussion by count, the
 * loudest voice in the mix, and the brightest single element — dropping the hats
 * alone takes a funk render's spectral centroid from 2262 Hz to 1980 Hz, and
 * dropping all percussion takes it to 1460 Hz.
 *
 * The sixteenth grid itself is *correct* for the genre: `drum16th` measures 0.28
 * against a 0.28 reference. Flattening the hats to eighths was tried and reverted,
 * because it fixed `drumOffbeat` (0.67 -> 0.47 against a 0.48 reference) while
 * collapsing `drum16th` from 0.39 to 0.07 against that same reference. Trading one
 * off-target metric for another is not a fix. What was missing was the *pulse*.
 */

/** Bars/energy for the funk hat and ghost checks (kept distinct from the shared
 * BARS/ENERGY constants above, which the other grooves' blocks use). */
const HAT_BARS = 32;
const HAT_ENERGY = 0.72;

/** Every hat the funk groove plays across HAT_BARS bars, at bar-relative ticks. */
function funkHats(grooveVariation?: number): NoteEvent[] {
  const gen = new PercussionGenerator({ groove: "funk", grooveVariation });
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < HAT_BARS; bar++) {
    const ctx = makeBarContext(bar, HAT_ENERGY, `funk-hats-${bar}`);
    for (const e of gen.generateBar(ctx) as NoteEvent[]) {
      if (e.percussion === "hat") out.push({ ...e, time: e.time - ctx.barStartTick });
    }
  }
  return out;
}

describe("funk hat layer", () => {
  it("plays eighths, and leaves the sixteenth subdivision to the snare", () => {
    // A sixteenth hat grid measured `drumOffbeat` 0.65 against a 0.48 reference,
    // because a 16th grid scores 0.75 on that metric by construction. Eighths
    // measure 0.42. The subdivision does not disappear — it moves to the ghost
    // snares, which is where GROOVE-CRITERIA.md says funk's sixteenths live.
    const hats = funkHats(0.75);
    const perBar = hats.length / HAT_BARS;
    expect(perBar).toBeGreaterThanOrEqual(7);
    expect(perBar).toBeLessThan(11);
  });

  it("accents the beat instead of playing a flat wall", () => {
    const hats = funkHats(0.75);
    const onBeat = (t: number) => Math.round(t / 240) % 2 === 0;
    const on = hats.filter((e) => onBeat(e.time)).map((e) => e.velocity);
    const off = hats.filter((e) => !onBeat(e.time)).map((e) => e.velocity);
    expect(on.length).toBeGreaterThan(0);
    expect(off.length).toBeGreaterThan(0);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // The beat must read as an accent. A grid whose velocities are all ~0.23 has no
    // pulse in it — the ear hears a wall, not a beat.
    expect(mean(on) - mean(off)).toBeGreaterThan(0.1);
    expect(mean(off)).toBeLessThan(0.28);
  });

  it("hands the sixteenth subdivision to the ghost snares, not to nothing", () => {
    // The point of moving the hats is that the subdivision still exists. If both
    // the hats and the ghosts were on eighths, `drum16th` would collapse to zero
    // and the groove would lose its 16th-note motion entirely.
    const gen = new PercussionGenerator({ groove: "funk", grooveVariation: 0.75 });
    let oddSteps = 0;
    for (let bar = 0; bar < HAT_BARS; bar++) {
      const ctx = makeBarContext(bar, HAT_ENERGY, `funk-subdiv-${bar}`);
      const hits = gen.generateBar(ctx) as NoteEvent[];
      for (const e of hits) {
        if (!e.percussion) continue;
        const step = Math.round((e.time - ctx.barStartTick) / 120) % 16;
        if (step % 2 === 1) oddSteps++;
      }
    }
    // Several per bar, from the snare: the subdivision has to be carried.
    expect(oddSteps / HAT_BARS).toBeGreaterThan(1);
  });
});

describe("funk's subdivision and backbeat budget", () => {
  /**
   * The tension that governs this groove, and the reason `drum16th` and `backbeat`
   * cannot both be bought with ghosts.
   *
   * `backbeat` is a share over the SNARE ALONE — 2 / (2 + ghosts) — so every ghost
   * spent on sixteenth subdivision lowers the backbeat reading while the backbeat
   * itself never moves. `drum16th` counts the whole kit, so the subdivision has to
   * come from somewhere the backbeat does not pay for. Three of funk's four
   * displaced kick spots (3, 9, 11) are odd 16th steps, which is exactly that.
   *
   * Measured on LIME's output, the two ends of this trade: leaning on ghosts took
   * `drum16th` to 0.11 with `backbeat` at 0.63; leaning on the kick takes
   * `drum16th` to 0.17 with `backbeat` at 0.54. Both metrics pass, and which one is
   * spent where is now an explicit choice rather than an accident.
   */
  const ENERGY = 0.72;
  const BARS = 48;

  function kit(grooveVariation = 0.75) {
    const gen = new PercussionGenerator({ groove: "funk", grooveVariation });
    const out: NoteEvent[] = [];
    let sounding = 0;
    for (let bar = 0; bar < BARS; bar++) {
      const ctx = makeBarContext(bar, ENERGY, `funk-budget-${bar}`);
      const hits = gen.generateBar(ctx) as NoteEvent[];
      if (!hits.length) continue;
      sounding++;
      out.push(...hits.map((e) => ({ ...e, time: e.time - ctx.barStartTick })));
    }
    return { out, sounding };
  }

  it("keeps the backbeat share within tolerance while the kit subdivides", () => {
    const { out } = kit();
    const step = (t: number) => Math.round(t / 120) % 16;
    const snares = out.filter((e) => e.percussion === "snare");
    const share =
      snares.filter((e) => step(e.time) === 4 || step(e.time) === 12).length / snares.length;
    // Reference 0.63, tolerance 0.12.
    expect(share).toBeGreaterThanOrEqual(0.51);
    expect(share).toBeLessThanOrEqual(1.0);
  });

  it("plays the backbeat itself at full strength, not as one more hit in a crowd", () => {
    // The absolute contract behind the share: whatever the ghost density, the two
    // backbeat snares must be there and must be the loudest thing in the snare
    // voice. A share can drift for reasons that have nothing to do with the
    // backbeat, which is what makes this worth asserting separately.
    const { out, sounding } = kit();
    const step = (t: number) => Math.round(t / 120) % 16;
    const snares = out.filter((e) => e.percussion === "snare");
    const onBeat = snares.filter((e) => step(e.time) === 4 || step(e.time) === 12);
    const ghosts = snares.filter((e) => step(e.time) !== 4 && step(e.time) !== 12);
    expect(onBeat.length / sounding).toBeGreaterThanOrEqual(1.9);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    expect(mean(onBeat.map((e) => e.velocity))).toBeGreaterThan(
      mean(ghosts.map((e) => e.velocity)) + 0.25,
    );
  });

  it("never stacks two displaced kicks on the same 16th step", () => {
    // Each displaced draw picks a spot independently, so two of the three could
    // land on the same step — measured at 3.3 % of kicks before this was fixed,
    // which doubles that hit's velocity and reads as an accent the groove never
    // asked for. One spot is consumed per hit.
    // `kit()` returns bar-relative times, so each bar must be counted separately:
    // keying on the step alone would stack all BARS onto each step and report every
    // downbeat as a duplicate.
    const gen = new PercussionGenerator({ groove: "funk", grooveVariation: 0.75 });
    let stacked = 0;
    for (let bar = 0; bar < BARS; bar++) {
      const ctx = makeBarContext(bar, ENERGY, `funk-stack-${bar}`);
      const kicks = (gen.generateBar(ctx) as NoteEvent[]).filter(
        (e) => e.percussion === "kick",
      );
      const perStep = new Map<number, number>();
      for (const e of kicks) {
        const step = Math.round((e.time - ctx.barStartTick) / 120) % 16;
        perStep.set(step, (perStep.get(step) ?? 0) + 1);
      }
      stacked += [...perStep.values()].filter((n) => n > 1).length;
    }
    expect(stacked).toBe(0);
  });

  it("buys its sixteenth subdivision from the kick, not from extra ghosts", () => {
    // The displaced kicks are the free subdivision: the kick is not part of the
    // `backbeat` share, so odd-step kicks raise `drum16th` at no cost to it.
    const { out } = kit();
    const step = (t: number) => Math.round(t / 120) % 16;
    const oddKicks = out.filter((e) => e.percussion === "kick" && step(e.time) % 2 === 1);
    expect(oddKicks.length).toBeGreaterThan(0);
  });
});

describe("funk ghost snares", () => {
  it("plays audible ghosts, not counted-but-inaudible ones", () => {
    // Funk's defining texture per GROOVE-CRITERIA.md. The reference corpus cannot
    // set this target — it measures ~0.00 ghosts for every label including funk,
    // because the Lakh transcriptions flattened them. The literature does.
    const gen = new PercussionGenerator({ groove: "funk", grooveVariation: 0.75 });
    const ghosts: NoteEvent[] = [];
    const backbeats: NoteEvent[] = [];
    for (let bar = 0; bar < HAT_BARS; bar++) {
      const ctx = makeBarContext(bar, HAT_ENERGY, `funk-ghost-${bar}`);
      const snares = (gen.generateBar(ctx) as NoteEvent[]).filter(
        (e) => e.percussion === "snare",
      );
      for (const e of snares) {
        const step = Math.round((e.time - ctx.barStartTick) / 120) % 16;
        if (step === 4 || step === 12) backbeats.push(e);
        else ghosts.push(e);
      }
    }
    expect(ghosts.length).toBeGreaterThan(0);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const ghostVel = mean(ghosts.map((e) => e.velocity));
    const backbeatVel = mean(backbeats.map((e) => e.velocity));
    // Audible while still clearly a ghost rather than a second backbeat.
    expect(ghostVel).toBeGreaterThan(0.15);
    expect(ghostVel).toBeLessThan(0.35);
    expect(backbeatVel).toBeGreaterThan(ghostVel + 0.25);
  });
});

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
