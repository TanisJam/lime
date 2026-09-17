import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { isNoteEvent, type NoteEvent } from "../src/events/MusicalEvent.js";
import { FOUR_FOUR, ticksPerBar } from "../src/time/MusicalTime.js";
import { MockRenderer, testStyle, serialize, allowedPitchClasses } from "./helpers.js";

function headlessEngine(seed: string, initial?: Record<string, number>) {
  return new LimeEngine({ seed, style: testStyle, initialState: initial });
}

/** Compose bars [0, count) headlessly and return the flat event stream. */
function composeStream(engine: LimeEngine, count: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < count; bar++) out.push(...engine.composeBar(bar));
  return out;
}

describe("LimeEngine — determinism", () => {
  it("produces identical output for the same seed and state", () => {
    const a = composeStream(headlessEngine("determinism-1"), 64).map(serialize);
    const b = composeStream(headlessEngine("determinism-1"), 64).map(serialize);
    expect(a).toEqual(b);
  });

  it("produces different output for different seeds", () => {
    const a = composeStream(headlessEngine("seed-alpha"), 64).map(serialize).join("\n");
    const b = composeStream(headlessEngine("seed-beta"), 64).map(serialize).join("\n");
    expect(a).not.toBe(b);
  });

  it("generates a non-trivial amount of music", () => {
    const stream = composeStream(headlessEngine("volume"), 32);
    expect(stream.length).toBeGreaterThan(50);
  });
});

describe("LimeEngine — musical validity", () => {
  it("keeps all pitches within the MIDI range", () => {
    const stream = composeStream(headlessEngine("range"), 64);
    for (const e of stream) {
      expect(e.pitch).toBeGreaterThanOrEqual(0);
      expect(e.pitch).toBeLessThanOrEqual(127);
    }
  });

  it("keeps pitched voices diatonic to the key", () => {
    const allowed = allowedPitchClasses(testStyle.keyPc, testStyle.defaultMode);
    const stream = composeStream(headlessEngine("diatonic"), 64);
    for (const e of stream) {
      if (e.voice === "percussion") continue;
      expect(allowed.has(((e.pitch % 12) + 12) % 12)).toBe(true);
    }
  });

  it("emits non-negative, in-bar times and valid velocities", () => {
    const stream = composeStream(headlessEngine("timing"), 32);
    for (const e of stream) {
      expect(e.time).toBeGreaterThanOrEqual(0);
      expect(e.velocity).toBeGreaterThanOrEqual(0);
      expect(e.velocity).toBeLessThanOrEqual(1);
      expect(isNoteEvent(e)).toBe(true);
    }
  });
});

describe("LimeEngine — silence and dynamics", () => {
  it("falls silent (melody + percussion) at very low energy", () => {
    const engine = headlessEngine("silence", { energy: 0.08, density: 0.1, tension: 0.05 });
    let melodyEmptyBars = 0;
    let percussionEvents = 0;
    for (let bar = 0; bar < 32; bar++) {
      const evts = engine.composeBar(bar);
      if (!evts.some((e) => e.voice === "melody")) melodyEmptyBars++;
      percussionEvents += evts.filter((e) => e.voice === "percussion").length;
    }
    expect(melodyEmptyBars).toBeGreaterThan(0);
    expect(percussionEvents).toBe(0);
  });

  it("produces more percussion at high energy than at low energy", () => {
    const count = (initial: Record<string, number>) => {
      const engine = headlessEngine("perc-energy", initial);
      let n = 0;
      for (let bar = 0; bar < 32; bar++) {
        n += engine.composeBar(bar).filter((e) => e.voice === "percussion").length;
      }
      return n;
    };
    expect(count({ energy: 0.9, density: 0.8 })).toBeGreaterThan(count({ energy: 0.3, density: 0.3 }));
  });
});

describe("LimeEngine — scheduling horizon", () => {
  it("keeps a look-ahead horizon ahead of the playhead", () => {
    const renderer = new MockRenderer();
    const engine = new LimeEngine({ seed: "horizon", style: testStyle, renderer, lookAheadBars: 4 });
    renderer.setNow(0);
    engine.pump();
    expect(engine.debug.snapshot().composedThroughBar).toBeGreaterThan(4);
  });

  it("does not regenerate committed bars as the playhead advances", () => {
    const renderer = new MockRenderer();
    const engine = new LimeEngine({ seed: "commit", style: testStyle, renderer, lookAheadBars: 4 });
    engine.pump();
    const firstBatch = renderer.scheduled.length;
    renderer.setNow(0); // playhead unchanged
    engine.pump();
    expect(renderer.scheduled.length).toBe(firstBatch); // nothing recomposed
  });
});

describe("LimeEngine — stop/start resume", () => {
  const BAR_TICKS = ticksPerBar(FOUR_FOUR);

  it("keeps scheduling notes for the bar actually playing after a stop() then start()", async () => {
    const renderer = new MockRenderer();
    const engine = new LimeEngine({
      seed: "restart-resume",
      style: testStyle,
      renderer,
      lookAheadBars: 4,
      // Keep the internal pump timer from ever firing during this test.
      pumpIntervalMs: 1_000_000,
    });

    await engine.start(); // composes the initial look-ahead horizon
    // Play for several bars, as the pump timer would tick-by-tick in real use.
    for (let bar = 1; bar <= 6; bar++) {
      renderer.setNow(bar * BAR_TICKS);
      engine.pump();
    }
    expect(engine.debug.snapshot().composedThroughBar).toBeGreaterThan(6);

    engine.stop();
    // MockRenderer.stop() mirrors Tone.Transport.stop(): clock back to 0,
    // schedule wiped — exactly what a real restart looks like to the engine.
    expect(renderer.now()).toBe(0);
    expect(renderer.scheduled.length).toBe(0);

    await engine.start();
    // One bar of real playback since the restart — the renderer's own clock
    // is back near 0, just like a fresh session.
    renderer.setNow(BAR_TICKS);
    engine.pump();

    // The bug: without resuming the composition onto the renderer's reset
    // clock, `composedThroughBar` stays far ahead of the (reset) playhead,
    // so `pump()` composes nothing and nothing is scheduled for what's
    // actually playing right now — long silence. Assert purely in
    // renderer-observable terms (what a listener would hear), not via
    // internal composition-bar bookkeeping.
    const rendererBar = Math.floor(renderer.now() / BAR_TICKS);
    const playingNow = renderer.scheduled.filter(
      (e) => e.time >= rendererBar * BAR_TICKS && e.time < (rendererBar + 1) * BAR_TICKS,
    );
    expect(playingNow.length).toBeGreaterThan(0);

    engine.stop();
  });

  it("resumes the same piece (composedThroughBar keeps advancing, not resetting to 0)", async () => {
    const renderer = new MockRenderer();
    const engine = new LimeEngine({
      seed: "restart-continuity",
      style: testStyle,
      renderer,
      lookAheadBars: 4,
      pumpIntervalMs: 1_000_000,
    });

    await engine.start();
    for (let bar = 1; bar <= 6; bar++) {
      renderer.setNow(bar * BAR_TICKS);
      engine.pump();
    }
    const composedBeforeStop = engine.debug.snapshot().composedThroughBar;

    engine.stop();
    await engine.start();

    // A restart must not rewind the composition frontier back toward 0 —
    // the piece (key, form, motif memory) keeps moving forward from where
    // it was, not restarting from scratch.
    expect(engine.debug.snapshot().composedThroughBar).toBeGreaterThanOrEqual(composedBeforeStop);

    engine.stop();
  });

  it("does not resend notes already heard before a mid-bar stop()", async () => {
    const renderer = new MockRenderer();
    const engine = new LimeEngine({
      seed: "restart-mid-bar",
      style: testStyle,
      renderer,
      lookAheadBars: 4,
      pumpIntervalMs: 1_000_000,
    });

    await engine.start();
    for (let bar = 1; bar <= 3; bar++) {
      renderer.setNow(bar * BAR_TICKS);
      engine.pump();
    }
    renderer.setNow(3 * BAR_TICKS + BAR_TICKS / 2);
    engine.stop();
    await engine.start();

    expect(renderer.scheduled.length).toBeGreaterThan(0);
    for (const e of renderer.scheduled) expect(e.time).toBeGreaterThanOrEqual(0);

    engine.stop();
  });

  it("stays stopped when stop() runs while the renderer is still starting", async () => {
    let release!: () => void;
    const renderer = new MockRenderer();
    renderer.start = () =>
      new Promise<void>((resolve) => {
        release = () => {
          renderer.running = true;
          resolve();
        };
      });
    const engine = new LimeEngine({
      seed: "restart-race",
      style: testStyle,
      renderer,
      lookAheadBars: 4,
      pumpIntervalMs: 1_000_000,
    });

    const starting = engine.start();
    engine.stop();
    release();
    await starting;

    expect(engine.isRunning).toBe(false);
    expect(renderer.scheduled.length).toBe(0);
  });
});

describe("LimeEngine — state management", () => {
  it("keeps state within bounds across a transition", () => {
    const engine = headlessEngine("bounds", { energy: 0.1, tension: 0.1 });
    engine.transitionTo(
      { energy: 1, tension: 1, valence: 0, tempo: 130 },
      { duration: { bars: 8 } },
    );
    for (let bar = 0; bar < 40; bar++) {
      engine.composeBar(bar);
      const s = engine.debug.snapshot().currentState;
      for (const key of ["energy", "tension", "valence", "density", "brightness", "complexity", "instability"] as const) {
        expect(s[key]).toBeGreaterThanOrEqual(0);
        expect(s[key]).toBeLessThanOrEqual(1);
      }
      expect(s.tempo).toBeGreaterThanOrEqual(60);
      expect(s.tempo).toBeLessThanOrEqual(130);
    }
  });

  it("converges current state toward the target", () => {
    const engine = headlessEngine("converge", { energy: 0.1 });
    engine.setState({ energy: 0.9 }, { quantize: "immediate" });
    for (let bar = 0; bar < 24; bar++) engine.composeBar(bar);
    const s = engine.debug.snapshot().currentState;
    expect(s.energy).toBeGreaterThan(0.7);
  });

  it("exposes upcoming harmony in the debug snapshot", () => {
    const engine = headlessEngine("snapshot");
    engine.composeThrough(8);
    const snap = engine.debug.snapshot();
    expect(snap.upcomingHarmony.length).toBeGreaterThan(0);
    expect(snap.keyName).toBe("C");
    expect(snap.upcomingHarmony[0]!.roman).toBeTruthy();
  });
});
