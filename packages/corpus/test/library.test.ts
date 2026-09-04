import { describe, it, expect } from "vitest";
import type { CorpusScore } from "../src/ir.js";
import { segmentScore } from "../src/analysis/segment.js";
import { genreForPath } from "../src/build/genreMap.js";
import { summarize, type LibraryEntry } from "../src/build/labelLibrary.js";

function scoreOf(bars: number, notesPerBar: number, ppq = 480): CorpusScore {
  const barTicks = ppq * 4;
  const notes = [];
  for (let b = 0; b < bars; b++) {
    for (let i = 0; i < notesPerBar; i++) {
      notes.push({
        start: b * barTicks + Math.round((i * barTicks) / notesPerBar),
        duration: 240,
        pitch: 60 + (i % 8),
        velocity: 0.7,
        track: 0,
      });
    }
  }
  return {
    id: "s",
    ppq,
    tempoBpm: 100,
    timeSignature: { numerator: 4, denominator: 4 },
    notes,
    meta: { source: "t", license: "t" },
  };
}

describe("segmentScore", () => {
  it("splits a 32-bar score into 4 windows of 8 bars", () => {
    const secs = segmentScore(scoreOf(32, 8), { barsPerSection: 8 });
    expect(secs.length).toBe(4);
    expect(secs.map((s) => s.startBar)).toEqual([0, 8, 16, 24]);
  });

  it("rebases each section's notes to tick 0", () => {
    const secs = segmentScore(scoreOf(16, 8), { barsPerSection: 8 });
    for (const sec of secs) {
      expect(Math.min(...sec.score.notes.map((n) => n.start))).toBe(0);
    }
  });

  it("is deterministic", () => {
    const a = segmentScore(scoreOf(24, 6), { barsPerSection: 8 });
    const b = segmentScore(scoreOf(24, 6), { barsPerSection: 8 });
    expect(a.map((s) => s.score.notes.length)).toEqual(b.map((s) => s.score.notes.length));
  });

  it("falls back to one whole-piece section when every window is too sparse", () => {
    const secs = segmentScore(scoreOf(8, 1), { barsPerSection: 8, minNotes: 100 });
    expect(secs.length).toBe(1);
    expect(secs[0]!.score.notes.length).toBe(8);
  });

  it("drops sparse leading windows but keeps dense ones", () => {
    const secs = segmentScore(scoreOf(16, 20), { barsPerSection: 8, minNotes: 12 });
    expect(secs.length).toBe(2);
  });
});

describe("genreForPath", () => {
  const cases: Array<[string, string]> = [
    ["MIDI_FILES/BEETHOVEN/Beethoven_5_Symphony.mid", "classical"],
    ["midi files/Bach - Invention 01.mid", "classical"],
    ["Yamaha 50 Greats For The Piano/01Invention 1.MID", "classical"],
    ["ARABIC & AMR DIAB MIDI COLLECTION/AMR DIAB_ELLILA DI.mid", "arabic"],
    ["other arabic midi songs/x.mid", "arabic"],
    ["MIDI Collection 2.0/GFOTY/Heaven.mid", "hyperpop"],
    ["MIDI_FILES/BEATLES/64.MID", "rock-pop"],
    ["MIDI_FILES/GROUPS/queen.mid", "rock-pop"],
    ["A#/A# I - IV [pop].mid", "pop"],
    ["MIDI_FILES/MIDI/tv_moviemidis_zip/batman.mid", "screen"],
    ["MIDI_FILES/GROUPS2_zip/all_along_the_watchtower.mid", "rock-pop"],
    ["midi/x/Bob Dylan - Hurricane.mid", "rock-pop"],
    ["Black MIDI/6 million notes.mid", "exclude"],
    ["MIDI_FILES/MIDI_00/0.mid", "various"],
    ["MIDI_FILES/MIDI/MIDI_10_zip/K283.MID", "various"],
  ];
  for (const [path, genre] of cases) {
    it(`${path} → ${genre}`, () => {
      expect(genreForPath(path)).toBe(genre);
    });
  }
});

describe("summarize", () => {
  it("counts files by genre and sections by genre × quadrant", () => {
    const entries = [
      { genre: "classical", sections: [{ quadrant: "Q2" }, { quadrant: "Q3" }] },
      { genre: "classical", sections: [{ quadrant: "Q2" }] },
      { genre: "pop", sections: [{ quadrant: "Q1" }] },
    ] as unknown as LibraryEntry[];
    const s = summarize(entries);
    expect(s.fileCount).toBe(3);
    expect(s.sectionCount).toBe(4);
    expect(s.byGenre).toEqual({ classical: 2, pop: 1 });
    expect(s.byQuadrant).toEqual({ Q1: 1, Q2: 2, Q3: 1, Q4: 0 });
    expect(s.genreQuadrant.classical).toEqual({ Q1: 0, Q2: 2, Q3: 1, Q4: 0 });
  });
});
