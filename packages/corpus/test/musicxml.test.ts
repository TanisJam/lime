import { describe, it, expect } from "vitest";
import { parseMusicXml } from "../src/musicxml/parseMusicXml.js";
import { detectKey } from "../src/analysis/keyDetection.js";
import { chordify } from "../src/analysis/chordify.js";
import { degreeSequence } from "../src/analysis/harmonyStats.js";

const ATTRS =
  "<attributes><divisions>4</divisions><key><fifths>0</fifths><mode>major</mode></key>" +
  "<time><beats>4</beats><beat-type>4</beat-type></time></attributes>";

/** One measure of a triad held as a whole note (chord notes share the onset). */
function triad(n: number, tones: [string, number][], attrs = false): string {
  const notes = tones
    .map(
      ([step, oct], i) =>
        `<note>${i > 0 ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${oct}</octave></pitch>` +
        `<duration>16</duration><type>whole</type></note>`,
    )
    .join("");
  return `<measure number="${n}">${attrs ? ATTRS : ""}${notes}</measure>`;
}

// I – IV – V – I in C major.
const PROGRESSION_XML =
  `<?xml version="1.0"?><score-partwise version="4.0">` +
  `<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>` +
  `<part id="P1">` +
  triad(1, [["C", 4], ["E", 4], ["G", 4]], true) +
  triad(2, [["F", 4], ["A", 4], ["C", 5]]) +
  triad(3, [["G", 4], ["B", 4], ["D", 5]]) +
  triad(4, [["C", 4], ["E", 4], ["G", 4]]) +
  `</part></score-partwise>`;

describe("MusicXML parser", () => {
  const meta = { source: "test", license: "test" };
  const score = parseMusicXml(PROGRESSION_XML, { id: "prog", meta });

  it("parses chord notes with shared onsets and correct pitches", () => {
    expect(score.notes.length).toBe(12);
    expect(score.ppq).toBe(480);
    // Measure 1: C4/E4/G4 all at tick 0, whole note = 1920 ticks.
    const m1 = score.notes.filter((n) => n.start === 0);
    expect(m1.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([60, 64, 67]);
    expect(m1.every((n) => n.duration === 1920)).toBe(true);
  });

  it("advances time by measure (non-chord notes move the cursor)", () => {
    const starts = [...new Set(score.notes.map((n) => n.start))].sort((a, b) => a - b);
    expect(starts).toEqual([0, 1920, 3840, 5760]);
  });

  it("detects C major and chordifies to I–IV–V–I", () => {
    const key = detectKey(score);
    expect(key.tonicPc).toBe(0);
    expect(key.mode).toBe("major");
    const seq = degreeSequence(chordify(score, { tonicPc: 0, mode: "major" }));
    expect(seq).toEqual([1, 4, 5, 1]);
  });

  it("handles <alter> and <backup> (multi-voice)", () => {
    const xml =
      `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">` +
      `<measure number="1"><attributes><divisions>4</divisions></attributes>` +
      `<note><pitch><step>C</step><alter>1</alter><octave>4</octave></pitch><duration>8</duration></note>` +
      `<backup><duration>8</duration></backup>` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>8</duration></note>` +
      `</measure></part></score-partwise>`;
    const s = parseMusicXml(xml, { id: "voices", meta });
    expect(s.notes.length).toBe(2);
    // C#4 = 61, E3 = 52; backup puts both voices at tick 0.
    expect(s.notes.map((n) => n.pitch).sort((a, b) => a - b)).toEqual([52, 61]);
    expect(s.notes.every((n) => n.start === 0)).toBe(true);
  });

  it("skips grace notes and rests", () => {
    const xml =
      `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">` +
      `<measure number="1"><attributes><divisions>4</divisions></attributes>` +
      `<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration></note>` +
      `<note><rest/><duration>8</duration></note>` +
      `</measure></part></score-partwise>`;
    const s = parseMusicXml(xml, { id: "grace", meta });
    expect(s.notes.length).toBe(1);
    expect(s.notes[0]!.pitch).toBe(60);
  });
});
