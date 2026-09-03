import { describe, it, expect } from "vitest";
import type { CorpusNote, CorpusScore } from "../src/ir.js";
import {
  gmFamily,
  gmInstrument,
  instrumentationProfile,
} from "../src/analysis/instrumentation.js";
import { drumVoiceOf, drumGroove } from "../src/analysis/drumGroove.js";

function score(notes: Partial<CorpusNote>[], ppq = 480): CorpusScore {
  return {
    id: "s",
    ppq,
    tempoBpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    notes: notes.map((n) => ({
      start: n.start ?? 0,
      duration: n.duration ?? 120,
      pitch: n.pitch ?? 60,
      velocity: n.velocity ?? 0.7,
      track: n.track ?? 0,
      program: n.program,
      isPercussion: n.isPercussion,
    })),
    meta: { source: "t", license: "t" },
  };
}

describe("GM family / instrument mapping", () => {
  it("maps programs to families", () => {
    expect(gmFamily(0)).toBe("piano");
    expect(gmFamily(30)).toBe("guitar");
    expect(gmFamily(33)).toBe("bass");
    expect(gmFamily(40)).toBe("strings");
    expect(gmFamily(48)).toBe("ensemble");
    expect(gmFamily(56)).toBe("brass");
    expect(gmFamily(65)).toBe("reed");
  });

  it("maps programs to genre-relevant instruments", () => {
    expect(gmInstrument(0)).toBe("acoustic-piano");
    expect(gmInstrument(4)).toBe("electric-piano");
    expect(gmInstrument(25)).toBe("acoustic-guitar");
    expect(gmInstrument(27)).toBe("clean-guitar");
    expect(gmInstrument(30)).toBe("distorted-guitar"); // overdriven
    expect(gmInstrument(31)).toBe("distorted-guitar"); // distortion
    expect(gmInstrument(33)).toBe("electric-bass");
    expect(gmInstrument(36)).toBe("slap-bass");
    expect(gmInstrument(38)).toBe("synth-bass");
    expect(gmInstrument(48)).toBe("ensemble");
  });
});

describe("instrumentationProfile", () => {
  it("computes family/instrument shares and drum share", () => {
    const p = instrumentationProfile(
      score([
        { program: 30, pitch: 40 }, // distorted guitar
        { program: 30, pitch: 47 },
        { program: 33, pitch: 28 }, // electric bass
        { pitch: 36, isPercussion: true }, // kick
      ]),
    );
    expect(p.pitchedNotes).toBe(3);
    expect(p.hasDrums).toBe(true);
    expect(p.drumShare).toBeCloseTo(1 / 4, 5);
    expect(p.familyShare.guitar).toBeCloseTo(2 / 3, 5);
    expect(p.instrumentShare["distorted-guitar"]).toBeCloseTo(2 / 3, 5);
    expect(p.dominant[0]).toBe("guitar");
  });

  it("reads a classical arrangement as strings/winds, no drums", () => {
    const p = instrumentationProfile(
      score([{ program: 40 }, { program: 42 }, { program: 68 }, { program: 71 }]),
    );
    expect(p.hasDrums).toBe(false);
    expect(p.drumShare).toBe(0);
    expect((p.familyShare.strings ?? 0) + (p.familyShare.reed ?? 0)).toBeCloseTo(1, 5);
  });
});

describe("drumVoiceOf", () => {
  it("maps GM drum notes to voices", () => {
    expect(drumVoiceOf(36)).toBe("kick");
    expect(drumVoiceOf(38)).toBe("snare");
    expect(drumVoiceOf(42)).toBe("hat");
    expect(drumVoiceOf(45)).toBe("tom");
    expect(drumVoiceOf(49)).toBe("cymbal");
  });
});

describe("drumGroove", () => {
  // A one-bar rock backbeat: kick on 1 & 3, snare on 2 & 4, hats on every 8th.
  function backbeatBar(): CorpusScore {
    const notes: Partial<CorpusNote>[] = [];
    const beat = 480;
    notes.push({ start: 0, pitch: 36, isPercussion: true }); // kick beat 1
    notes.push({ start: 2 * beat, pitch: 36, isPercussion: true }); // kick beat 3
    notes.push({ start: 1 * beat, pitch: 38, isPercussion: true }); // snare beat 2
    notes.push({ start: 3 * beat, pitch: 38, isPercussion: true }); // snare beat 4
    for (let i = 0; i < 8; i++) notes.push({ start: i * (beat / 2), pitch: 42, isPercussion: true });
    return score(notes);
  }

  it("detects a full backbeat (snare on 2 & 4)", () => {
    const g = drumGroove(backbeatBar());
    expect(g.hasDrums).toBe(true);
    expect(g.backbeat).toBe(1); // every snare on beat 2 or 4
    expect(g.voices.kick![0]).toBeGreaterThan(0); // kick at beat 1
    expect(g.voices.kick![8]).toBeGreaterThan(0); // kick at beat 3
    expect(g.voices.snare![4]).toBeGreaterThan(0); // snare at beat 2
  });

  it("reads straight 8ths as low swing", () => {
    expect(drumGroove(backbeatBar()).swing).toBeLessThan(0.3);
  });

  it("reads triplet-pushed offbeats as higher swing", () => {
    // Hats with the 'and' pushed to the triplet (2/3 of the beat).
    const beat = 480;
    const notes: Partial<CorpusNote>[] = [];
    for (let b = 0; b < 4; b++) {
      notes.push({ start: b * beat, pitch: 42, isPercussion: true });
      notes.push({ start: Math.round(b * beat + beat * (2 / 3)), pitch: 42, isPercussion: true });
    }
    expect(drumGroove(score(notes)).swing).toBeGreaterThan(0.7);
  });
});
