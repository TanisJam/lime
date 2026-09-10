import { describe, it, expect } from "vitest";
import { humanizeBar, type HumanizeContext } from "../src/humanize/Humanizer.js";
import type { NoteEvent } from "../src/events/MusicalEvent.js";
import type { FeelStyle } from "../src/style/StylePack.js";
import { SeededRandom } from "../src/random/SeededRandom.js";
import { FOUR_FOUR, TICKS_PER_QUARTER } from "../src/time/MusicalTime.js";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";

const TEMPO = 120;

function makeCtx(seedSuffix: string, overrides: Partial<HumanizeContext> = {}): HumanizeContext {
  return {
    barStartTick: 0,
    meter: FOUR_FOUR,
    tempo: TEMPO,
    rng: new SeededRandom(`humanize-test/${seedSuffix}`),
    ...overrides,
  };
}

function noteAt(time: number, voice: NoteEvent["voice"] = "melody"): NoteEvent {
  return { type: "note", time, duration: TICKS_PER_QUARTER, pitch: 60, velocity: 0.6, voice };
}

/** Ticks → ms at the fixed test tempo (inverse of the humanizer's own conversion). */
function ticksToMs(ticks: number): number {
  return (ticks / TICKS_PER_QUARTER) * (60000 / TEMPO);
}

const ZERO_FEEL: FeelStyle = {
  voices: {
    melody: { jitterMs: 0, offsetMs: 0 },
    bass: { jitterMs: 0, offsetMs: 0 },
    pad: { jitterMs: 0, offsetMs: 0 },
    motion: { jitterMs: 0, offsetMs: 0 },
    percussion: { jitterMs: 0, offsetMs: 0 },
  },
  accentDepth: 0,
};

/** A deliberately loose feel, near the top of the literature-supported band. */
const LOOSE_FEEL: FeelStyle = {
  voices: {
    melody: { jitterMs: 7, offsetMs: 0 },
    bass: { jitterMs: 7, offsetMs: 0 },
    pad: { jitterMs: 7, offsetMs: 0 },
    motion: { jitterMs: 7, offsetMs: 0 },
    percussion: { jitterMs: 7, offsetMs: 0 },
  },
  accentDepth: 0.6,
};

/** Isolates the systematic offset: a laid-back bass, no jitter noise. */
const LAID_BACK_BASS_FEEL: FeelStyle = {
  voices: { bass: { jitterMs: 3, offsetMs: 12 } },
  accentDepth: 0,
};

/** Isolates the metrical accent: full depth, no timing jitter at all. */
const ACCENT_ONLY_FEEL: FeelStyle = { voices: {}, accentDepth: 1 };

/** A voice with an extreme pushed bias, to exercise the bar-start clamp. */
const EXTREME_PUSH_FEEL: FeelStyle = {
  voices: { melody: { jitterMs: 5, offsetMs: -1000 } },
  accentDepth: 0,
};

describe("humanizeBar — determinism", () => {
  it("produces identical output for the same seed", () => {
    const events = [noteAt(0), noteAt(TICKS_PER_QUARTER), noteAt(TICKS_PER_QUARTER * 2)];
    const a = humanizeBar(events, LOOSE_FEEL, makeCtx("same"));
    const b = humanizeBar(events, LOOSE_FEEL, makeCtx("same"));
    expect(a).toEqual(b);
  });
});

describe("humanizeBar — zero feel (Electronic's case)", () => {
  it("leaves onsets exactly on the grid", () => {
    const events = [noteAt(0), noteAt(TICKS_PER_QUARTER * 3), noteAt(TICKS_PER_QUARTER * 3 + 60)];
    const out = humanizeBar(events, ZERO_FEEL, makeCtx("zero"));
    expect(out.map((e) => e.time)).toEqual(events.map((e) => e.time));
  });
});

describe("humanizeBar — random jitter magnitude", () => {
  it("produces a timing SD in the evidence-supported ballpark (2-12ms), not the raw corpus magnitude", () => {
    const deviations: number[] = [];
    for (let i = 0; i < 500; i++) {
      const base = TICKS_PER_QUARTER * 4;
      const [out] = humanizeBar([noteAt(base)], LOOSE_FEEL, makeCtx(`jitter-${i}`));
      deviations.push(ticksToMs(out!.time - base));
    }
    const mean = deviations.reduce((s, d) => s + d, 0) / deviations.length;
    const variance = deviations.reduce((s, d) => s + (d - mean) ** 2, 0) / deviations.length;
    const sd = Math.sqrt(variance);
    // Never assert an exact value here — GROOVE-CRITERIA.md is explicit that
    // jitter magnitude can only be confirmed by ear, not by the number moving.
    expect(sd).toBeGreaterThan(2);
    expect(sd).toBeLessThan(12);
  });
});

describe("humanizeBar — systematic offset", () => {
  it("biases the mean timing of a laid-back voice, not just the spread", () => {
    const base = TICKS_PER_QUARTER * 4;
    const deviations: number[] = [];
    for (let i = 0; i < 300; i++) {
      const [out] = humanizeBar([noteAt(base, "bass")], LAID_BACK_BASS_FEEL, makeCtx(`offset-${i}`));
      deviations.push(ticksToMs(out!.time - base));
    }
    const mean = deviations.reduce((s, d) => s + d, 0) / deviations.length;
    // The configured offset is +12ms; the mean should sit clearly positive
    // (laid-back/late), not just scattered around zero like pure jitter would.
    expect(mean).toBeGreaterThan(5);
  });
});

describe("humanizeBar — metrical velocity accent", () => {
  it("makes downbeat notes louder on average than offbeat notes", () => {
    const beat = TICKS_PER_QUARTER;
    const downbeatVelocities: number[] = [];
    const offbeatVelocities: number[] = [];
    for (let i = 0; i < 50; i++) {
      const [down] = humanizeBar([noteAt(0)], ACCENT_ONLY_FEEL, makeCtx(`down-${i}`));
      // A sixteenth after beat 1 — not on any beat boundary, so it reads as
      // an offbeat subdivision under the humanizer's metrical accent.
      const [off] = humanizeBar([noteAt(beat + beat / 4)], ACCENT_ONLY_FEEL, makeCtx(`off-${i}`));
      downbeatVelocities.push(down!.velocity);
      offbeatVelocities.push(off!.velocity);
    }
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(avg(downbeatVelocities)).toBeGreaterThan(avg(offbeatVelocities));
  });
});

describe("humanizeBar — bar-start clamp", () => {
  it("never moves an onset before the bar start, even with an extreme pushed offset", () => {
    const barStartTick = TICKS_PER_QUARTER * 8;
    for (let i = 0; i < 50; i++) {
      const [out] = humanizeBar(
        [{ ...noteAt(barStartTick), time: barStartTick }],
        EXTREME_PUSH_FEEL,
        makeCtx(`clamp-${i}`, { barStartTick }),
      );
      expect(out!.time).toBe(barStartTick);
    }
  });
});

describe("humanizeBar — RNG isolation", () => {
  it("does not perturb the generators' own RNG streams: same pitches and note count with humanization on or off", () => {
    const zeroFeelStyle = { ...testStyle, feel: ZERO_FEEL };
    const looseFeelStyle = { ...testStyle, feel: LOOSE_FEEL };

    const engineA = new LimeEngine({ seed: "isolation-seed", style: zeroFeelStyle });
    const engineB = new LimeEngine({ seed: "isolation-seed", style: looseFeelStyle });

    for (let bar = 0; bar < 6; bar++) {
      const eventsA = engineA.composeBar(bar);
      const eventsB = engineB.composeBar(bar);
      expect(eventsA.length).toBe(eventsB.length);
      expect(eventsA.map((e) => e.pitch)).toEqual(eventsB.map((e) => e.pitch));
    }
  });

  it("gives each voice its own stream, so one voice's note count cannot move another's timing", () => {
    // Events arrive sorted by time. Drawing every voice's jitter from one
    // shared stream would mean that adding a melody note shifts how much of
    // the stream is consumed before a given percussion hit, silently moving
    // that hit — so editing the melody would perturb the drums, and an A/B of
    // one voice would show phantom noise in all the others.
    const percussion = [0, 480, 960, 1440].map((t) => noteAt(t, "percussion"));
    const melody = [240, 720].map((t) => noteAt(t, "melody"));
    const moreMelody = [360, 600, 1080].map((t) => noteAt(t, "melody"));

    const percussionTimes = (events: NoteEvent[]) =>
      humanizeBar(
        [...events].sort((a, b) => a.time - b.time),
        LOOSE_FEEL,
        makeCtx("voice-independence"),
      )
        .filter((e) => e.voice === "percussion")
        .map((e) => e.time);

    expect(percussionTimes([...percussion, ...melody, ...moreMelody])).toEqual(
      percussionTimes([...percussion, ...melody]),
    );
  });
});
