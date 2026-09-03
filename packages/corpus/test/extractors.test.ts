import { describe, it, expect } from "vitest";
import { LimeEngine } from "@lime/core";
import type { CorpusNote, CorpusScore } from "../src/ir.js";
import { MelodyModelBuilder, extractMelodyLine } from "../src/analysis/melodyStats.js";
import { RhythmModelBuilder, type RhythmModel } from "../src/analysis/rhythmStats.js";
import { HarmonyModelBuilder } from "../src/analysis/harmonyStats.js";
import { compileStylePack } from "../src/style/compileStylePack.js";

function note(start: number, pitch: number, duration = 480, isPercussion = false): CorpusNote {
  return { start, duration, pitch, velocity: 0.7, track: 0, isPercussion };
}
function score(notes: CorpusNote[]): CorpusScore {
  return {
    id: "t",
    ppq: 480,
    tempoBpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    notes,
    meta: { source: "t", license: "t" },
  };
}

describe("MelodyModelBuilder", () => {
  it("extracts stepwise diatonic intervals and durations", () => {
    // Ascending C-D-E-F-G in C major, one per beat.
    const s = score([
      note(0, 60), note(480, 62), note(960, 64), note(1440, 65), note(1920, 67),
    ]);
    const b = new MelodyModelBuilder();
    b.add(s, { tonicPc: 0, mode: "major" });
    const m = b.build();
    expect(m.intervalWeights[1]).toBe(4); // four +1 diatonic steps
    expect(Object.keys(m.intervalWeights)).toEqual(["1"]);
    expect(m.durationWeights.quarter).toBe(5);
  });

  it("picks the monophonic upper voice over chordal bass (track heuristic)", () => {
    const notes: CorpusNote[] = [];
    // Track 0: low chordal accompaniment (C3–E3–G3 on each beat).
    for (let b = 0; b < 4; b++) {
      for (const p of [48, 52, 55]) notes.push({ start: b * 480, duration: 480, pitch: p, velocity: 0.6, track: 0 });
    }
    // Track 1: high monophonic melody C5–D5–E5–F5.
    const mel = [72, 74, 76, 77];
    for (let b = 0; b < 4; b++) notes.push({ start: b * 480, duration: 480, pitch: mel[b]!, velocity: 0.8, track: 1 });

    const line = extractMelodyLine(score(notes));
    expect(line.map((n) => n.pitch)).toEqual([72, 74, 76, 77]);
  });

  it("takes the skyline (highest voice) from polyphony", () => {
    // Low drone under a moving top line; only the top should form intervals.
    const s = score([
      note(0, 48), note(0, 72), note(480, 48), note(480, 74),
    ]);
    const b = new MelodyModelBuilder();
    b.add(s, { tonicPc: 0, mode: "major" });
    const m = b.build();
    expect(m.intervalWeights[1]).toBe(1); // 72→74 is one diatonic step
  });
});

describe("RhythmModelBuilder", () => {
  it("builds an on-beat groove with zero syncopation", () => {
    const s = score([note(0, 60), note(480, 60), note(960, 60), note(1440, 60)]);
    const m = new RhythmModelBuilder();
    m.add(s);
    const r = m.build();
    expect(r.onsetProfile[0]).toBe(1);
    expect(r.onsetProfile[4]).toBe(1);
    expect(r.onsetProfile[2]).toBe(0);
    expect(r.syncopation).toBe(0);
    expect(r.avgOnsetsPerBar).toBe(4);
  });

  it("detects syncopation on off-beat onsets", () => {
    const b = new RhythmModelBuilder();
    b.add(score([note(240, 60), note(720, 60)])); // 16th positions 2 and 6 (off-beat)
    expect(b.build().syncopation).toBe(1);
  });
});

describe("rhythm style drives the generated groove", () => {
  const harmony = (() => {
    const b = new HarmonyModelBuilder();
    b.add([1, 4, 5, 1]);
    b.add([1, 6, 4, 5, 1]);
    return b.build();
  })();

  const beatsOnly: RhythmModel = {
    onsetProfile: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    avgOnsetsPerBar: 4,
    syncopation: 0,
    sampleCount: 100,
  };

  function offbeatHats(rhythmModel?: RhythmModel): number {
    const { style } = compileStylePack(harmony, { id: "groove-test", keyPc: 0, mode: "major", rhythmModel });
    const engine = new LimeEngine({
      seed: "groove",
      style,
      initialState: { energy: 0.9, density: 0.9, complexity: 0.7, tension: 0.2 },
    });
    let off = 0;
    for (let bar = 0; bar < 48; bar++) {
      for (const e of engine.composeBar(bar)) {
        if (e.percussion === "hat" && (e.time - bar * 1920) % 480 !== 0) off++;
      }
    }
    return off;
  }

  it("a beats-only onset profile yields fewer off-beat hats than none", () => {
    expect(offbeatHats(beatsOnly)).toBeLessThan(offbeatHats(undefined));
  });
});
