import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { FOUR_FOUR, ticksPerBar, ticksPerBeat } from "../src/time/MusicalTime.js";
import type { NoteEvent } from "../src/events/MusicalEvent.js";
import { MockRenderer, testStyle, serialize } from "./helpers.js";

const BAR_TICKS = ticksPerBar(FOUR_FOUR);
const BEAT_TICKS = ticksPerBeat(FOUR_FOUR);
const PATCH = { energy: 0.9, tension: 0.8, valence: 0.1 };

function headlessEngine(seed: string) {
  return new LimeEngine({ seed, style: testStyle });
}

/** Compose bars [0, count) headlessly and return the flat event stream. */
function composeStream(engine: LimeEngine, count: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < count; bar++) out.push(...engine.composeBar(bar));
  return out;
}

describe("LimeEngine — urgent state changes", () => {
  it("rolls back and recomposes to match the same change applied normally at the same bar", () => {
    const seed = "urgent-rollback";
    const lookAheadBars = 4;

    // Engine A: composes the full look-ahead (bars 0..4), then applies the
    // change urgently while the playhead is still on bar 0 — it should roll
    // back to bar 1 (playhead + 1), discard bars 1..4, and recompose them.
    const rendererA = new MockRenderer();
    const engineA = new LimeEngine({ seed, style: testStyle, renderer: rendererA, lookAheadBars });
    rendererA.setNow(0);
    engineA.pump();
    engineA.setState(PATCH, { urgent: true });

    // Engine B: composes only bar 0 (bar k - 1, k = 1), then applies the same
    // change non-urgently. With the playhead still on bar 0, quantize
    // "nextBar" (the default) resolves to bar 1 too — the same target.
    const rendererB = new MockRenderer();
    const engineB = new LimeEngine({ seed, style: testStyle, renderer: rendererB, lookAheadBars });
    rendererB.setNow(0);
    engineB.composeThrough(0);
    engineB.setState(PATCH);
    engineB.composeThrough(lookAheadBars);

    // Bar 0 (before the change) must be untouched by the rollback.
    const before = (r: MockRenderer) => r.scheduled.filter((e) => e.time < BAR_TICKS).map(serialize).sort();
    expect(before(rendererA)).toEqual(before(rendererB));

    // Bars 1..4 (recomposed under the new state) must match bar-for-bar —
    // this is what proves the checkpoint restored every stateful component.
    const from = (r: MockRenderer) => r.scheduled.filter((e) => e.time >= BAR_TICKS).map(serialize).sort();
    expect(from(rendererA)).toEqual(from(rendererB));
    expect(from(rendererA).length).toBeGreaterThan(0);
  });

  it("does not leave the discarded bars' notes scheduled alongside their replacement", () => {
    const rendererA = new MockRenderer();
    const engineA = new LimeEngine({
      seed: "urgent-no-doubles",
      style: testStyle,
      renderer: rendererA,
      lookAheadBars: 4,
    });
    rendererA.setNow(0);
    engineA.pump();
    const staleEvents = rendererA.scheduled.filter((e) => e.time >= BAR_TICKS);
    expect(staleEvents.length).toBeGreaterThan(0); // sanity: something was there to discard

    engineA.setState(PATCH, { urgent: true });

    // None of the pre-rollback event objects for the discarded bars survive:
    // cancelFrom must have dropped every one of them, not merely appended
    // fresh ones alongside (each recomposed event is a brand-new object, so
    // reference identity is enough to tell old from new).
    const survivors = new Set(rendererA.scheduled);
    for (const stale of staleEvents) expect(survivors.has(stale)).toBe(false);
  });

  it("targets playhead + 1 when there is enough lead before its downbeat", () => {
    const seed = "urgent-lead-early";
    const lookAheadBars = 4;
    const renderer = new MockRenderer();
    const engine = new LimeEngine({ seed, style: testStyle, renderer, lookAheadBars });
    renderer.setNow(0);
    engine.pump(); // composedThroughBar = 5

    // Early in bar 0 — comfortably more than a beat of lead before bar 1's downbeat.
    renderer.setNow(BEAT_TICKS);
    const bar1Original = renderer.scheduled.filter((e) => e.time >= BAR_TICKS && e.time < 2 * BAR_TICKS);
    expect(bar1Original.length).toBeGreaterThan(0);

    engine.setState(PATCH, { urgent: true });

    // Bar 1 was rolled back: none of its original event objects survive.
    const survivors = new Set(renderer.scheduled);
    for (const e of bar1Original) expect(survivors.has(e)).toBe(false);
  });

  it("targets playhead + 2 when the call lands too close to playhead + 1's downbeat", () => {
    const seed = "urgent-lead-late";
    const lookAheadBars = 4;
    const renderer = new MockRenderer();
    const engine = new LimeEngine({ seed, style: testStyle, renderer, lookAheadBars });
    renderer.setNow(0);
    engine.pump(); // composedThroughBar = 5

    // Late in bar 0 — less than a beat of lead before bar 1's downbeat (this
    // is a mid-bar playhead: renderer.now() is not itself on a bar start).
    renderer.setNow(BAR_TICKS - Math.floor(BEAT_TICKS / 2));
    const bar1Original = renderer.scheduled.filter((e) => e.time >= BAR_TICKS && e.time < 2 * BAR_TICKS);
    const bar2Original = renderer.scheduled.filter((e) => e.time >= 2 * BAR_TICKS && e.time < 3 * BAR_TICKS);
    expect(bar1Original.length).toBeGreaterThan(0);
    expect(bar2Original.length).toBeGreaterThan(0);

    engine.setState(PATCH, { urgent: true });

    // Bar 1 keeps its original events — not enough lead to safely retarget
    // it, so the rollback moved on to bar 2 instead.
    const survivors = new Set(renderer.scheduled);
    for (const e of bar1Original) expect(survivors.has(e)).toBe(true);
    // Bar 2 onward was discarded and recomposed under the new state.
    for (const e of bar2Original) expect(survivors.has(e)).toBe(false);
  });

  it("falls back to a normal change when the renderer has no cancelFrom", () => {
    const seed = "urgent-no-cancelfrom";
    const lookAheadBars = 4;

    const rendererUrgent = new MockRenderer({ cancelFrom: false });
    const engineUrgent = new LimeEngine({
      seed,
      style: testStyle,
      renderer: rendererUrgent,
      lookAheadBars,
    });
    rendererUrgent.setNow(0);
    engineUrgent.pump();
    const beforeLen = rendererUrgent.scheduled.length;
    engineUrgent.setState(PATCH, { urgent: true });
    // The guard short-circuits before any mutation: nothing was cancelled or
    // rescheduled synchronously.
    expect(rendererUrgent.scheduled.length).toBe(beforeLen);

    const rendererNormal = new MockRenderer({ cancelFrom: false });
    const engineNormal = new LimeEngine({
      seed,
      style: testStyle,
      renderer: rendererNormal,
      lookAheadBars,
    });
    rendererNormal.setNow(0);
    engineNormal.pump();
    engineNormal.setState(PATCH); // no urgent flag at all

    // Both should have queued the identical change at the identical bar
    // (musical inertia clamps it behind the already-composed horizon either
    // way), so composing one more bar produces identical output.
    engineUrgent.composeBar(lookAheadBars + 1);
    engineNormal.composeBar(lookAheadBars + 1);
    const a = rendererUrgent.scheduled
      .filter((e) => e.time >= (lookAheadBars + 1) * BAR_TICKS)
      .map(serialize)
      .sort();
    const b = rendererNormal.scheduled
      .filter((e) => e.time >= (lookAheadBars + 1) * BAR_TICKS)
      .map(serialize)
      .sort();
    expect(a).toEqual(b);
  });

  it("headless usage falls back to a normal change (nothing is ahead of the frontier)", () => {
    const seed = "urgent-headless";
    const withUrgent = headlessEngine(seed);
    const withoutUrgent = headlessEngine(seed);
    withUrgent.setState(PATCH, { urgent: true });
    withoutUrgent.setState(PATCH);

    const a = composeStream(withUrgent, 16).map(serialize);
    const b = composeStream(withoutUrgent, 16).map(serialize);
    expect(a).toEqual(b);
  });

  it("carries a still-pending non-urgent request's non-conflicting key to its own bar, not target", () => {
    const seed = "urgent-carry-over";
    const lookAheadBars = 4;
    const renderer = new MockRenderer();
    const engine = new LimeEngine({ seed, style: testStyle, renderer, lookAheadBars });
    renderer.setNow(0);
    engine.pump(); // composes bars [0, lookAheadBars]; composedThroughBar = 5

    // Queued for bar 5 (past the composed horizon) — it hasn't taken effect
    // yet when the urgent click below fires. This mirrors a slider drag
    // queued a moment before an urgent mood click.
    engine.transitionTo({ density: 0.9 }, { duration: { bars: 2 } });
    // The playhead is still bar 0, so this rolls back to bar 1 and discards
    // (then recomposes) bars 1..4 — the density change above was requested
    // *after* bar 1's checkpoint was taken, so it only survives if the
    // engine carries it over instead of silently dropping it on restore.
    engine.transitionTo({ energy: 0.85 }, { duration: { bars: 2 }, urgent: true });

    // Lands at its own bar (5, its converged ramp end at 5 + 2 = 7), not at
    // target — a single pump() jump composes every intervening bar.
    renderer.setNow(7 * BAR_TICKS);
    engine.pump();
    const state = engine.debug.snapshot().currentState;
    expect(state.density).toBeCloseTo(0.9, 5);
    expect(state.energy).toBeCloseTo(0.85, 5);
  });

  it("replays a request that was already applied inside the rolled-back window", () => {
    const seed = "urgent-replay-applied";
    const lookAheadBars = 4;
    const renderer = new MockRenderer();
    const engine = new LimeEngine({ seed, style: testStyle, renderer, lookAheadBars });
    renderer.setNow(0);
    engine.pump(); // composes bars [0, lookAheadBars]; composedThroughBar = 5

    // Queued for exactly the composed horizon at that moment (bar 5) — the
    // same shape as a slider drag landing right at the edge of the
    // look-ahead window.
    engine.transitionTo({ density: 0.7 }, { duration: { bars: 1 }, quantize: "immediate" });

    // Compose further, past bar 5 — this *applies* the density request via
    // advanceToBar(5), shifting it out of `pending` well before the urgent
    // click below. (composeThrough, not pump: the playhead/renderer.now()
    // never moves in this test, and pump's horizon is relative to it.)
    engine.composeThrough(6); // composedThroughBar = 7, density already converged

    // The playhead is still bar 0, so this rolls back to bar 1 — *inside*
    // the window where the density request was already applied and
    // discarded. It must still take effect: it is neither in the restored
    // checkpoint's `pending` (captured before it was even requested) nor in
    // the live `pending` at the moment of this call (already consumed by
    // advanceToBar(5) above) — only the request log has it. It replays at
    // its own original bar (5), not at `target`, since density doesn't
    // conflict with the urgent energy key.
    engine.transitionTo({ energy: 0.85 }, { duration: { bars: 2 }, urgent: true });
    renderer.setNow(7 * BAR_TICKS);
    engine.pump();
    const state = engine.debug.snapshot().currentState;
    expect(state.energy).toBeCloseTo(0.85, 5);
    expect(state.density).toBeCloseTo(0.7, 5);
  });

  it("a non-conflicting later-quantized request lands at its own bar and doesn't revert the urgent key", () => {
    const seed = "urgent-later-request-timing";
    const lookAheadBars = 4;
    const renderer = new MockRenderer();
    const engine = new LimeEngine({ seed, style: testStyle, renderer, lookAheadBars });
    renderer.setNow(0);
    engine.pump(); // composedThroughBar = 5

    // Queued for bar 5 (nextPhrase's own boundary, 4, is clamped up to the
    // already-composed horizon) — past the urgent rollback's target (1).
    engine.transitionTo({ complexity: 0.8 }, { duration: { bars: 2 }, quantize: "nextPhrase" });
    // A different key: no conflict with the request above.
    engine.transitionTo({ energy: 0.9 }, { duration: { bars: 2 }, urgent: true });

    // Right after the urgent rollback (which only recomposed bars 1..4), the
    // later request must not have fired yet — not dragged onto target.
    expect(engine.debug.snapshot().targetState.complexity).toBeLessThan(0.5);
    expect(engine.debug.snapshot().currentState.energy).toBeCloseTo(0.9, 5);

    // Compose through bar 5 (its own bar) and past its ramp (5 + 2 = 7).
    renderer.setNow(8 * BAR_TICKS);
    engine.pump();
    const state = engine.debug.snapshot().currentState;
    expect(state.complexity).toBeCloseTo(0.8, 5);
    // The urgent energy value must still hold — the later, non-conflicting
    // request never carried a (stripped) energy key back with it.
    expect(state.energy).toBeCloseTo(0.9, 5);
  });

  it("an urgent change permanently wins over an older pending change to the same key", () => {
    const seed = "urgent-override";
    const lookAheadBars = 4;
    const renderer = new MockRenderer();
    const engine = new LimeEngine({ seed, style: testStyle, renderer, lookAheadBars });
    renderer.setNow(0);
    engine.pump(); // composedThroughBar = 5

    // Older intent, queued for a bar further out than the urgent rollback's
    // target (quantize "nextPhrase" resolves past bar 5 here).
    engine.setState({ energy: 0.2 }, { quantize: "nextPhrase" });
    // The user's latest word, for the same key.
    engine.transitionTo({ energy: 0.95 }, { duration: { bars: 3 }, urgent: true });

    // The ramp completes by bar 1 + 3 = 4, already within the horizon the
    // urgent call itself recomposed.
    expect(engine.debug.snapshot().currentState.energy).toBeCloseTo(0.95, 5);

    // Keep composing well past the older request's original target bar — it
    // must not resurface and override the urgent value later.
    for (let bar = 5; bar <= 15; bar++) {
      renderer.setNow(bar * BAR_TICKS);
      engine.pump();
    }
    expect(engine.debug.snapshot().currentState.energy).toBeCloseTo(0.95, 5);
  });

  it("checkpointing does not perturb output when urgent is never used", () => {
    // A renderer-driven engine takes a checkpoint before every bar; if that
    // bookkeeping consumed RNG or mutated state, this would diverge from a
    // headless engine composing the identical bar sequence.
    const seed = "urgent-checkpoint-noop";
    const renderer = new MockRenderer();
    const engineWithChurn = new LimeEngine({ seed, style: testStyle, renderer, lookAheadBars: 4 });
    renderer.setNow(0);
    for (let bar = 0; bar <= 20; bar++) {
      renderer.setNow(bar * BAR_TICKS);
      engineWithChurn.pump(); // checkpoints every newly composed bar
    }

    const headless = headlessEngine(seed);
    const headlessEvents = composeStream(headless, 21).map(serialize);
    const rendererEvents = renderer.scheduled
      .filter((e) => e.time < 21 * BAR_TICKS)
      .map(serialize)
      .sort();
    expect(rendererEvents).toEqual([...headlessEvents].sort());
  });
});
