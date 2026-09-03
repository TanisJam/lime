import { describe, it, expect } from "vitest";
import { writeMidi, type MidiEvent } from "midi-file";
import { parseMidiFile } from "../src/midi/parseMidi.js";
import { detectKey } from "../src/analysis/keyDetection.js";
import { chordify } from "../src/analysis/chordify.js";
import { degreeSequence, HarmonyModelBuilder } from "../src/analysis/harmonyStats.js";

const PPQ = 480;
const BAR = PPQ * 4;

/** Build a Standard MIDI File for a sequence of chords (one whole-note per bar). */
function makeMidi(chords: number[][]): Uint8Array {
  const track: MidiEvent[] = [{ deltaTime: 0, type: "setTempo", microsecondsPerBeat: 500000 }];
  for (const chord of chords) {
    chord.forEach((note, i) => {
      track.push({ deltaTime: i === 0 ? 0 : 0, type: "noteOn", channel: 0, noteNumber: note, velocity: 80 });
    });
    chord.forEach((note, i) => {
      track.push({ deltaTime: i === 0 ? BAR : 0, type: "noteOff", channel: 0, noteNumber: note, velocity: 0 });
    });
  }
  track.push({ deltaTime: 0, type: "endOfTrack" });
  const bytes = writeMidi({ header: { format: 1, numTracks: 1, ticksPerBeat: PPQ }, tracks: [track] });
  return Uint8Array.from(bytes);
}

// I – IV – V – I in C major, root-position triads.
const I = [60, 64, 67];
const IV = [65, 69, 72];
const V = [67, 71, 74];
const PROGRESSION = [I, IV, V, I];

describe("corpus pipeline (MIDI → key → chords → model)", () => {
  const meta = { source: "test", license: "test" };
  const score = parseMidiFile(makeMidi(PROGRESSION), { id: "prog", meta });

  it("parses all notes with correct pitches and durations", () => {
    expect(score.notes.length).toBe(12);
    expect(score.ppq).toBe(PPQ);
    expect(score.tempoBpm).toBeCloseTo(120, 1);
    for (const n of score.notes) expect(n.duration).toBe(BAR);
  });

  it("detects C major", () => {
    const key = detectKey(score);
    expect(key.tonicPc).toBe(0);
    expect(key.mode).toBe("major");
    expect(key.confidence).toBeGreaterThan(0.5);
  });

  it("chordifies to the correct degrees", () => {
    const windows = chordify(score, { tonicPc: 0, mode: "major" });
    const degrees = windows.map((w) => w.degree);
    expect(degrees).toEqual([1, 4, 5, 1]);
  });

  it("builds a harmony transition model", () => {
    const windows = chordify(score, { tonicPc: 0, mode: "major" });
    const seq = degreeSequence(windows);
    expect(seq).toEqual([1, 4, 5, 1]);

    const builder = new HarmonyModelBuilder();
    builder.add(seq);
    const model = builder.build();

    expect(model.transitions[1]!.some((t) => t.degree === 4)).toBe(true);
    expect(model.transitions[4]!.some((t) => t.degree === 5)).toBe(true);
    expect(model.transitions[5]!.some((t) => t.degree === 1)).toBe(true);
    expect(model.cadenceResolutionRate).toBe(1);
  });

  it("marks percussion (channel 10) and excludes it from key detection", () => {
    const drums: MidiEvent[] = [
      { deltaTime: 0, type: "noteOn", channel: 9, noteNumber: 36, velocity: 100 },
      { deltaTime: 240, type: "noteOff", channel: 9, noteNumber: 36, velocity: 0 },
    ];
    const bytes = writeMidi({ header: { format: 1, numTracks: 1, ticksPerBeat: PPQ }, tracks: [drums] });
    const drumScore = parseMidiFile(Uint8Array.from(bytes), { id: "drum", meta });
    expect(drumScore.notes[0]!.isPercussion).toBe(true);
  });
});
