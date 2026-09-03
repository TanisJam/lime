import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { isNoteEvent, type NoteEvent } from "../src/events/MusicalEvent.js";
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
