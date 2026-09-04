import { describe, it, expect } from "vitest";
import type { NoteEvent } from "@lime/core";
import { TICKS_PER_QUARTER } from "@lime/core";
import {
  eventsToStandardMidiFile,
  toMidiVelocity,
  bpmToMicrosecondsPerQuarter,
  DRUM_CHANNEL,
} from "../src/StandardMidiFile.js";
import { encodeVLQ, MAX_VLQ } from "../src/vlq.js";

// --- Tiny SMF parser (test-only) -------------------------------------------

function readUint16BE(b: Uint8Array, pos: number): number {
  return (b[pos]! << 8) | b[pos + 1]!;
}
function readUint32BE(b: Uint8Array, pos: number): number {
  return (
    b[pos]! * 0x1000000 + (b[pos + 1]! << 16) + (b[pos + 2]! << 8) + b[pos + 3]!
  );
}
function chunkId(b: Uint8Array, pos: number): string {
  return String.fromCharCode(b[pos]!, b[pos + 1]!, b[pos + 2]!, b[pos + 3]!);
}

interface ParsedHeader {
  format: number;
  ntrks: number;
  division: number;
}
interface ParsedChunk {
  id: string;
  length: number;
  start: number; // index of first data byte
  end: number; // index one past the chunk data
}

function parseHeader(b: Uint8Array): ParsedHeader {
  expect(chunkId(b, 0)).toBe("MThd");
  expect(readUint32BE(b, 4)).toBe(6);
  return {
    format: readUint16BE(b, 8),
    ntrks: readUint16BE(b, 10),
    division: readUint16BE(b, 12),
  };
}

function parseChunks(b: Uint8Array): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  let pos = 14; // after MThd
  while (pos < b.length) {
    const id = chunkId(b, pos);
    const length = readUint32BE(b, pos + 4);
    const start = pos + 8;
    chunks.push({ id, length, start, end: start + length });
    pos = start + length;
  }
  return chunks;
}

interface TrackEvent {
  tick: number; // absolute
  status: number;
  data: number[];
  metaType?: number;
}

function parseTrack(b: Uint8Array, chunk: ParsedChunk): TrackEvent[] {
  const events: TrackEvent[] = [];
  let pos = chunk.start;
  let tick = 0;
  let runningStatus = 0;

  const readVLQ = (): number => {
    let value = 0;
    let byte: number;
    do {
      byte = b[pos++]!;
      value = value * 128 + (byte & 0x7f);
    } while (byte & 0x80);
    return value;
  };

  while (pos < chunk.end) {
    tick += readVLQ();
    let status = b[pos]!;
    if (status & 0x80) {
      pos++;
    } else {
      status = runningStatus; // running status
    }

    if (status === 0xff) {
      const metaType = b[pos++]!;
      const len = readVLQ();
      const data: number[] = [];
      for (let i = 0; i < len; i++) data.push(b[pos++]!);
      events.push({ tick, status, metaType, data });
      continue;
    }

    runningStatus = status;
    const high = status & 0xf0;
    // Note on/off and most channel messages have 2 data bytes.
    const data = [b[pos++]!, b[pos++]!];
    events.push({ tick, status, data });
    void high;
  }
  return events;
}

// --- Fixtures ---------------------------------------------------------------

function note(
  voice: NoteEvent["voice"],
  time: number,
  duration: number,
  pitch: number,
  velocity: number,
): NoteEvent {
  return { type: "note", voice, time, duration, pitch, velocity };
}

const sample: NoteEvent[] = [
  note("pad", 0, TICKS_PER_QUARTER * 2, 60, 0.5),
  note("pad", 0, TICKS_PER_QUARTER * 2, 64, 0.5),
  note("bass", 0, TICKS_PER_QUARTER, 36, 0.8),
  note("bass", TICKS_PER_QUARTER, TICKS_PER_QUARTER, 38, 0.8),
  note("melody", TICKS_PER_QUARTER / 2, TICKS_PER_QUARTER / 2, 72, 1.0),
  note("percussion", 0, 10, 36, 0.9), // kick
  note("percussion", TICKS_PER_QUARTER, 10, 38, 0.7), // snare
];

// --- Tests ------------------------------------------------------------------

describe("VLQ encoding", () => {
  it("encodes boundary values correctly", () => {
    expect(encodeVLQ(0)).toEqual([0x00]);
    expect(encodeVLQ(127)).toEqual([0x7f]);
    expect(encodeVLQ(128)).toEqual([0x81, 0x00]);
    expect(encodeVLQ(16383)).toEqual([0xff, 0x7f]);
    expect(encodeVLQ(16384)).toEqual([0x81, 0x80, 0x00]);
    expect(encodeVLQ(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
    expect(MAX_VLQ).toBe(0x0fffffff);
  });

  it("rejects out-of-range values", () => {
    expect(() => encodeVLQ(-1)).toThrow();
    expect(() => encodeVLQ(0x10000000)).toThrow();
    expect(() => encodeVLQ(1.5)).toThrow();
  });
});

describe("toMidiVelocity", () => {
  it("clamps to 1..127 and never returns 0", () => {
    expect(toMidiVelocity(0)).toBe(1);
    expect(toMidiVelocity(-1)).toBe(1);
    expect(toMidiVelocity(1)).toBe(127);
    expect(toMidiVelocity(2)).toBe(127);
    expect(toMidiVelocity(0.5)).toBe(64); // round(63.5) = 64
  });
});

describe("MThd header", () => {
  it("is format 1, division 480, ntrks = 1 + voices present", () => {
    const bytes = eventsToStandardMidiFile(sample);
    const h = parseHeader(bytes);
    expect(h.format).toBe(1);
    expect(h.division).toBe(TICKS_PER_QUARTER);
    // pad, bass, melody, percussion present -> 4 voice tracks + conductor.
    expect(h.ntrks).toBe(5);
  });

  it("honors a custom ppq", () => {
    const bytes = eventsToStandardMidiFile(sample, { ppq: 960 });
    expect(parseHeader(bytes).division).toBe(960);
  });
});

describe("MTrk chunks", () => {
  it("emits the right count, each id MTrk with a matching length", () => {
    const bytes = eventsToStandardMidiFile(sample);
    const chunks = parseChunks(bytes);
    expect(chunks.length).toBe(5);
    for (const c of chunks) {
      expect(c.id).toBe("MTrk");
      // length field must equal actual data span
      expect(c.end - c.start).toBe(c.length);
    }
    // total bytes consumed exactly
    expect(chunks[chunks.length - 1]!.end).toBe(bytes.length);
  });

  it("only emits tracks for voices that have events", () => {
    const twoVoices: NoteEvent[] = [
      note("pad", 0, 480, 60, 0.5),
      note("melody", 0, 240, 72, 0.5),
    ];
    const bytes = eventsToStandardMidiFile(twoVoices);
    expect(parseHeader(bytes).ntrks).toBe(3); // conductor + 2
    expect(parseChunks(bytes).length).toBe(3);
  });
});

describe("note round-trip", () => {
  it("every note-on has a matching note-off at the right tick, pitch/velocity preserved", () => {
    const bytes = eventsToStandardMidiFile(sample);
    const chunks = parseChunks(bytes);

    // Collect note events from all voice tracks (skip conductor = chunk 0).
    for (let i = 1; i < chunks.length; i++) {
      const evts = parseTrack(bytes, chunks[i]!);
      const ons = evts.filter((e) => (e.status & 0xf0) === 0x90 && e.data[1]! > 0);
      const offs = evts.filter(
        (e) =>
          (e.status & 0xf0) === 0x80 ||
          ((e.status & 0xf0) === 0x90 && e.data[1] === 0),
      );
      expect(ons.length).toBe(offs.length);
    }

    // Check the pad voice explicitly: two notes starting at 0 for 2 quarters.
    const padChunk = chunks[1]!; // pad is first in default trackOrder
    const padEvents = parseTrack(bytes, padChunk);
    const padOns = padEvents.filter(
      (e) => (e.status & 0xf0) === 0x90 && e.data[1]! > 0,
    );
    expect(padOns.map((e) => e.data[0]).sort((a, b) => a! - b!)).toEqual([60, 64]);
    for (const on of padOns) {
      expect(on.tick).toBe(0);
      expect(on.data[1]).toBe(toMidiVelocity(0.5)); // velocity preserved
      // matching off at tick 960
      const off = padEvents.find(
        (e) =>
          e.tick === TICKS_PER_QUARTER * 2 &&
          (e.status & 0xf0) === 0x80 &&
          e.data[0] === on.data[0],
      );
      expect(off).toBeDefined();
    }
  });

  it("uses percussion pitch (GM drum number) directly", () => {
    const bytes = eventsToStandardMidiFile(sample);
    const chunks = parseChunks(bytes);
    const perc = parseTrack(bytes, chunks[4]!); // percussion is 4th voice track
    const ons = perc.filter((e) => (e.status & 0xf0) === 0x90 && e.data[1]! > 0);
    expect(ons.map((e) => e.data[0]).sort((a, b) => a! - b!)).toEqual([36, 38]);
  });
});

describe("channel assignment", () => {
  it("percussion uses channel 9; pad/bass/melody use non-9 channels", () => {
    const bytes = eventsToStandardMidiFile(sample);
    const chunks = parseChunks(bytes);

    const channelOfTrack = (idx: number): number => {
      const evts = parseTrack(bytes, chunks[idx]!);
      const chMsg = evts.find((e) => (e.status & 0xf0) === 0x90);
      return chMsg!.status & 0x0f;
    };

    expect(channelOfTrack(1)).toBe(0); // pad
    expect(channelOfTrack(2)).toBe(1); // bass
    expect(channelOfTrack(3)).toBe(2); // melody
    expect(channelOfTrack(4)).toBe(DRUM_CHANNEL); // percussion -> 9
    expect(channelOfTrack(4)).toBe(9);
    for (const idx of [1, 2, 3]) expect(channelOfTrack(idx)).not.toBe(9);
  });
});

describe("tempo", () => {
  it("emits a single Set-Tempo with correct microseconds-per-quarter", () => {
    const bytes = eventsToStandardMidiFile(sample, { tempo: 120 });
    const chunks = parseChunks(bytes);
    const conductor = parseTrack(bytes, chunks[0]!);
    const tempoEvts = conductor.filter(
      (e) => e.status === 0xff && e.metaType === 0x51,
    );
    expect(tempoEvts.length).toBe(1);
    const uspq =
      (tempoEvts[0]!.data[0]! << 16) |
      (tempoEvts[0]!.data[1]! << 8) |
      tempoEvts[0]!.data[2]!;
    expect(uspq).toBe(bpmToMicrosecondsPerQuarter(120));
    expect(uspq).toBe(500000); // 60000000 / 120
  });

  it("emits a tempo map when tempoChanges is given", () => {
    const bytes = eventsToStandardMidiFile(sample, {
      tempoChanges: [
        { tick: 0, bpm: 100 },
        { tick: 1920, bpm: 140 },
      ],
    });
    const chunks = parseChunks(bytes);
    const conductor = parseTrack(bytes, chunks[0]!);
    const tempoEvts = conductor.filter(
      (e) => e.status === 0xff && e.metaType === 0x51,
    );
    expect(tempoEvts.length).toBe(2);
    expect(tempoEvts[0]!.tick).toBe(0);
    expect(tempoEvts[1]!.tick).toBe(1920);
    const read = (e: TrackEvent) =>
      (e.data[0]! << 16) | (e.data[1]! << 8) | e.data[2]!;
    expect(read(tempoEvts[0]!)).toBe(bpmToMicrosecondsPerQuarter(100));
    expect(read(tempoEvts[1]!)).toBe(bpmToMicrosecondsPerQuarter(140));
  });

  it("writes a sequence name meta when name is provided", () => {
    const bytes = eventsToStandardMidiFile(sample, { name: "LIME" });
    const chunks = parseChunks(bytes);
    const conductor = parseTrack(bytes, chunks[0]!);
    const nameMeta = conductor.find(
      (e) => e.status === 0xff && e.metaType === 0x03,
    );
    expect(nameMeta).toBeDefined();
    expect(String.fromCharCode(...nameMeta!.data)).toBe("LIME");
  });
});

describe("track name meta", () => {
  it("each voice track starts with its voice name", () => {
    const bytes = eventsToStandardMidiFile(sample);
    const chunks = parseChunks(bytes);
    const names = ["pad", "bass", "melody", "percussion"];
    for (let i = 0; i < names.length; i++) {
      const evts = parseTrack(bytes, chunks[i + 1]!);
      const nameMeta = evts.find((e) => e.status === 0xff && e.metaType === 0x03);
      expect(nameMeta).toBeDefined();
      expect(String.fromCharCode(...nameMeta!.data)).toBe(names[i]);
    }
  });
});

describe("end of track", () => {
  it("every chunk ends with FF 2F 00", () => {
    const bytes = eventsToStandardMidiFile(sample);
    const chunks = parseChunks(bytes);
    for (const c of chunks) {
      expect(bytes[c.end - 3]).toBe(0xff);
      expect(bytes[c.end - 2]).toBe(0x2f);
      expect(bytes[c.end - 1]).toBe(0x00);
    }
  });
});

describe("determinism", () => {
  it("produces byte-identical output for identical input", () => {
    const a = eventsToStandardMidiFile(sample, { name: "LIME", tempo: 128 });
    const b = eventsToStandardMidiFile(sample, { name: "LIME", tempo: 128 });
    expect(a).toEqual(b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("orders note-offs before note-ons at the same tick", () => {
    // bass note-off at tick 480 and second bass note-on at tick 480.
    const bytes = eventsToStandardMidiFile(sample);
    const chunks = parseChunks(bytes);
    const bass = parseTrack(bytes, chunks[2]!);
    const at480 = bass.filter((e) => e.tick === TICKS_PER_QUARTER);
    const offIdx = at480.findIndex((e) => (e.status & 0xf0) === 0x80);
    const onIdx = at480.findIndex((e) => (e.status & 0xf0) === 0x90);
    expect(offIdx).toBeGreaterThanOrEqual(0);
    expect(onIdx).toBeGreaterThanOrEqual(0);
    expect(offIdx).toBeLessThan(onIdx);
  });
});

describe("program changes", () => {
  // Find the byte offset of a 2-byte subsequence [status, data] in the file.
  function hasSubsequence(b: Uint8Array, seq: number[]): boolean {
    outer: for (let i = 0; i + seq.length <= b.length; i++) {
      for (let j = 0; j < seq.length; j++) if (b[i + j] !== seq[j]) continue outer;
      return true;
    }
    return false;
  }

  it("emits a Program Change at tick 0 on each voice's channel", () => {
    const bytes = eventsToStandardMidiFile(sample, { programs: { pad: 40, melody: 29 } });
    // Channels: pad -> 0, bass -> 1, melody -> 2 (percussion -> 9).
    expect(hasSubsequence(bytes, [0xc0, 40])).toBe(true); // pad, ch 0
    expect(hasSubsequence(bytes, [0xc2, 29])).toBe(true); // melody, ch 2
  });

  it("omits Program Change for voices without a program", () => {
    const bytes = eventsToStandardMidiFile(sample, { programs: { pad: 40 } });
    // No program-change status byte for bass (0xC1) or melody (0xC2).
    expect(hasSubsequence(bytes, [0xc1])).toBe(false);
    expect(hasSubsequence(bytes, [0xc2])).toBe(false);
  });

  it("adds no program bytes when programs is absent", () => {
    const bytes = eventsToStandardMidiFile(sample);
    for (const status of [0xc0, 0xc1, 0xc2, 0xc9]) {
      expect(hasSubsequence(bytes, [status])).toBe(false);
    }
  });
});
