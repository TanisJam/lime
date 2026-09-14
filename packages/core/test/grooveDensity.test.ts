import { describe, it, expect } from "vitest";
import { PercussionGenerator } from "../src/percussion/PercussionGenerator.js";
import { BassGenerator } from "../src/bass/BassGenerator.js";
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

/**
 * Coverage for the groove-density fixes in GROOVE-CRITERIA.md: electronic's
 * `fourOnFloor()` was the worst gap in the engine (11.8 hits/bar against a
 * real ~30.5), Pop's shared `backbeat()` needed far more density than
 * Rock/Metal without losing its tight backbeat, and Electronic's `sub` bass
 * was nearly silent (0.88 onsets/bar against a real 5.23). These tests pin
 * the structural mechanisms behind each fix, not exact note counts — the
 * musical target itself is judged by `node tools/judge/groove-gap.mjs`, not
 * by a unit test (see GROOVE-CRITERIA.md's "a passing test is not evidence
 * the music changed").
 */

const BAR_TICKS = ticksPerBar(FOUR_FOUR);
const director = new PhraseDirector();
const phrases = new PhrasePlanner({ phraseLengthBars: 4 });

/** A bar context at a fixed energy/density/tempo, with a fresh per-bar RNG stream. */
function makeBarContext(
  bar: number,
  energy: number,
  seed: string,
  tempo = DEFAULT_STATE.tempo,
): BarContext {
  const state = applyPatch(DEFAULT_STATE, { energy, density: 0.65, complexity: 0.5, tempo });
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

/** A `SeededRandom` that counts every draw — see grooveVariation.test.ts for the rationale. */
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

const ENERGY = 0.78;
const BARS = 48;

describe("fourOnFloor: electronic's density fix", () => {
  it("averages well above the old bare-offbeat pattern (~11.8 hits/bar) at a typical energy", () => {
    const gen = new PercussionGenerator({ groove: "four-on-floor", grooveVariation: 0.85 });
    let hits = 0;
    for (let bar = 0; bar < BARS; bar++) {
      hits += gen.generateBar(makeBarContext(bar, ENERGY, "electronic-density", 126)).length;
    }
    const avg = hits / BARS;
    // GROOVE-CRITERIA.md targets ~26-30; a generous floor here just proves the
    // new hat/clap/shaker layers actually fire, not that they hit the exact
    // corpus median (that's groove-gap.mjs's job, not a unit test's).
    expect(avg).toBeGreaterThan(20);
  });

  it("the four-on-the-floor kick still never moves, even with the new density layers", () => {
    const gen = new PercussionGenerator({ groove: "four-on-floor", grooveVariation: 0.85 });
    for (let bar = 0; bar < 12; bar++) {
      const ctx = makeBarContext(bar, ENERGY, "electronic-kick-still-locked", 126);
      const kickSteps = gen
        .generateBar(ctx)
        .filter((e) => e.pitch === PERCUSSION_MIDI.kick)
        .map((e) => sixteenthOf(e, ctx))
        .sort((a, b) => a - b);
      expect(kickSteps).toEqual([0, 4, 8, 12]);
    }
  });

  it("gv=0 still draws RNG only for the per-note velocity jitter (no leaked extra draws)", () => {
    const gen = new PercussionGenerator({ groove: "four-on-floor", grooveVariation: 0 });
    const ctx = makeBarContext(5, ENERGY, "electronic-no-draw", 126);
    const rng = new CountingRandom("electronic-no-draw/5");
    const events = gen.generateBar({ ...ctx, rng });
    expect(rng.calls).toBe(events.length);
  });
});

describe("backbeat: Pop's extra density layer", () => {
  it("grooveVariation > 1 (Pop) produces more hits than an equivalent gv <= 1 (Rock/Metal)", () => {
    const pop = new PercussionGenerator({ groove: "backbeat", grooveVariation: 1.15 });
    const rock = new PercussionGenerator({ groove: "backbeat", grooveVariation: 0.5 });
    let popHits = 0;
    let rockHits = 0;
    for (let bar = 0; bar < BARS; bar++) {
      popHits += pop.generateBar(makeBarContext(bar, ENERGY, "pop-density", 118)).length;
      rockHits += rock.generateBar(makeBarContext(bar, ENERGY, "rock-density", 126)).length;
    }
    expect(popHits / BARS).toBeGreaterThan(rockHits / BARS);
  });

  it("gv=1.15's fractional part (0.15) reproduces the exact legacy ghost-snare positions Pop shipped with before", () => {
    // gv=0.15 is the pre-existing, already-calibrated "quiet ghost snare"
    // behaviour Pop's old grooveVariation: 0.15 relied on. The new encoding
    // (integer part = density opt-in, fractional part = looseness) must
    // reproduce it exactly for Pop's own fractional part, or the tight 0.81
    // backbeat target would drift.
    const reference = new PercussionGenerator({ groove: "backbeat", grooveVariation: 0.15 });
    const withDensityOptIn = new PercussionGenerator({ groove: "backbeat", grooveVariation: 1.15 });
    for (let bar = 0; bar < 12; bar++) {
      // Two independent contexts from the same seed/bar, so each generator's
      // RNG stream starts identically — the density layer's extra draws (for
      // gv=1.15) must not shift the shared ghost-snare draws that follow it.
      const refCtx = makeBarContext(bar, ENERGY, "looseness-parity");
      const optInCtx = makeBarContext(bar, ENERGY, "looseness-parity");
      const refSnares = reference
        .generateBar(refCtx)
        .filter((e) => e.pitch === PERCUSSION_MIDI.snare)
        .map((e) => sixteenthOf(e, refCtx))
        .sort((a, b) => a - b);
      const optInSnares = withDensityOptIn
        .generateBar(optInCtx)
        .filter((e) => e.pitch === PERCUSSION_MIDI.snare)
        .map((e) => sixteenthOf(e, optInCtx))
        .sort((a, b) => a - b);
      expect(optInSnares).toEqual(refSnares);
    }
  });
});

describe("BassGenerator sub bass: tempo-differentiated house riff vs 808 drone", () => {
  it("at a dance tempo (electronic), the riff produces several onsets per bar, not a near-silent drone", () => {
    const gen = new BassGenerator("sub");
    let onsets = 0;
    for (let bar = 0; bar < BARS; bar++) {
      onsets += gen.generateBar(makeBarContext(bar, ENERGY, "electronic-bass-density", 126)).length;
    }
    // Old behaviour measured ~0.88 onsets/bar (GROOVE-CRITERIA.md); the new
    // riff should be unambiguously busier.
    expect(onsets / BARS).toBeGreaterThan(2.5);
  });

  it("at a boom-bap tempo (hip-hop), the sparse sustained-root drone is unchanged", () => {
    const gen = new BassGenerator("sub");
    let onsets = 0;
    for (let bar = 0; bar < BARS; bar++) {
      onsets += gen.generateBar(makeBarContext(bar, ENERGY, "hiphop-bass-sparse", 88)).length;
    }
    // Still sparse — a sustained root plus an occasional push, same shape as
    // before this change (hip-hop must not be dragged along with electronic).
    expect(onsets / BARS).toBeLessThan(2);
  });

  it("the house riff mostly plays between the kick's quarter-note positions, not locked to them", () => {
    const gen = new BassGenerator("sub");
    let onKick = 0;
    let total = 0;
    for (let bar = 0; bar < BARS; bar++) {
      const ctx = makeBarContext(bar, ENERGY, "electronic-bass-lock", 126);
      for (const e of gen.generateBar(ctx)) {
        total++;
        if (sixteenthOf(e, ctx) % 4 === 0) onKick++;
      }
    }
    expect(total).toBeGreaterThan(0);
    // Electronic is the one genre whose bass deliberately does NOT lock hard
    // to the kick — most onsets should fall between the quarters. The
    // corrected reference bassKickLock is 0.50 (the 0.31 this comment used to
    // cite was a contaminated median), but 0.50 is unreachable here: LIME's
    // electronic kick is a pure four-on-the-floor, so bassKickLock and
    // bassOffbeat are complements that sum to 1 by construction — see the
    // kick-set-identity trap in GROOVE-CRITERIA.md and the comment on the
    // "sub" branch in BassGenerator.ts.
    expect(onKick / total).toBeLessThan(0.5);
  });

  it("is deterministic for a fixed seed at both tempos", () => {
    const a = new BassGenerator("sub").generateBar(makeBarContext(7, ENERGY, "sub-det-electronic", 126));
    const b = new BassGenerator("sub").generateBar(makeBarContext(7, ENERGY, "sub-det-electronic", 126));
    expect(a).toEqual(b);
    const c = new BassGenerator("sub").generateBar(makeBarContext(7, ENERGY, "sub-det-hiphop", 88));
    const d = new BassGenerator("sub").generateBar(makeBarContext(7, ENERGY, "sub-det-hiphop", 88));
    expect(c).toEqual(d);
  });
});

describe("BassGenerator sub bass: electronic's 16-step grid (bass16th fix)", () => {
  // An eighth-note-only grid can only ever land on an EVEN 16th step, so
  // bass16th (the share of bass onsets on an ODD step) measured a structural
  // 0.000 no matter how the two eighth probabilities were tuned — the grid
  // could not express the metric at all. The fix moves electronic's riff onto
  // a 16-step grid with a genuine odd-step probability; these tests pin that
  // an odd step is reachable and that the onset density stays in a musically
  // sane band, not the exact rendered pattern (see GROOVE-CRITERIA.md's "a
  // passing test is not evidence the music changed").
  it("reaches an odd 16th step across seeds — the old eighth-only grid never could", () => {
    let sawOddStep = false;
    outer: for (const seed of ["odd-step-a", "odd-step-b", "odd-step-c", "odd-step-d"]) {
      for (let bar = 0; bar < BARS; bar++) {
        const ctx = makeBarContext(bar, ENERGY, seed, 126);
        for (const e of new BassGenerator("sub").generateBar(ctx)) {
          if (sixteenthOf(e, ctx) % 2 === 1) {
            sawOddStep = true;
            break outer;
          }
        }
      }
    }
    expect(sawOddStep).toBe(true);
  });

  it("keeps onsets per bar in a sane band around the reference (~6.2, GROOVE-CRITERIA.md)", () => {
    const gen = new BassGenerator("sub");
    let onsets = 0;
    for (let bar = 0; bar < BARS; bar++) {
      onsets += gen.generateBar(makeBarContext(bar, ENERGY, "electronic-bass-band", 126)).length;
    }
    const perBar = onsets / BARS;
    // A wide band on purpose: it proves the grid produces a musically
    // plausible density, not that it hits the corpus median to the decimal —
    // that comparison belongs to `node tools/judge/groove-gap.mjs`.
    expect(perBar).toBeGreaterThan(4);
    expect(perBar).toBeLessThan(8);
  });

  it("puts a share of onsets on odd 16th steps near the reference (~0.29, GROOVE-CRITERIA.md)", () => {
    const gen = new BassGenerator("sub");
    let onsets = 0;
    let odd = 0;
    for (const seed of ["odd-share-a", "odd-share-b", "odd-share-c", "odd-share-d"]) {
      for (let bar = 0; bar < BARS; bar++) {
        const ctx = makeBarContext(bar, ENERGY, seed, 126);
        for (const e of gen.generateBar(ctx)) {
          onsets++;
          if (sixteenthOf(e, ctx) % 2 === 1) odd++;
        }
      }
    }
    // Reachability alone would stay green if the odd-step probability were
    // cut to almost nothing. A wide band pins the share without pinning the
    // corpus median to the decimal.
    expect(onsets).toBeGreaterThan(0);
    const share = odd / onsets;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.45);
  });

  it("never lets one bass note ring into the next — a sub bass is a single voice", () => {
    const gen = new BassGenerator("sub");
    let pairs = 0;
    for (const seed of ["no-overlap-a", "no-overlap-b"]) {
      for (let bar = 0; bar < BARS; bar++) {
        const notes = gen
          .generateBar(makeBarContext(bar, ENERGY, seed, 126))
          .slice()
          .sort((a, b) => a.time - b.time);
        for (let n = 0; n + 1 < notes.length; n++) {
          pairs++;
          expect(notes[n]!.time + notes[n]!.duration).toBeLessThanOrEqual(notes[n + 1]!.time);
        }
      }
    }
    // Guard against a vacuous pass: the grid must actually have produced
    // adjacent notes for the assertion above to mean anything.
    expect(pairs).toBeGreaterThan(0);
  });

  it("hip-hop's drone (tempo < 110) still never touches an odd 16th step", () => {
    const gen = new BassGenerator("sub");
    let onsets = 0;
    for (let bar = 0; bar < BARS; bar++) {
      const ctx = makeBarContext(bar, ENERGY, "hiphop-bass-odd-check", 88);
      for (const e of gen.generateBar(ctx)) {
        onsets++;
        expect(sixteenthOf(e, ctx) % 2).toBe(0);
      }
    }
    // Without this the loop above passes on a silent bass as readily as on a
    // correct one.
    expect(onsets).toBeGreaterThan(0);
  });
});
