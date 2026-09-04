/**
 * Standard MIDI File (SMF) export for LIME.
 *
 * This is a *debugging / audition* tool: it turns LIME's symbolic composition
 * (a stream of {@link NoteEvent}s) into the exact bytes of a Format 1 SMF so the
 * composition can be opened in a DAW and heard note-for-note.
 *
 * Design constraints:
 *  - Pure TypeScript, ZERO runtime dependencies. The SMF bytes are written by
 *    hand — no Tone.js, no npm MIDI libraries.
 *  - No browser/download code lives here. Callers get a {@link Uint8Array} and
 *    decide how to save it (Blob, fs.writeFile, etc.).
 *  - Deterministic: identical input produces byte-identical output.
 *
 * What is preserved: pitch, velocity, timing, duration, tempo (single or a
 * tempo map), and voice/track separation.
 *
 * Channel mapping:
 *  - percussion -> MIDI channel index 9 (channel 10, the GM drum channel).
 *  - every other voice -> the next distinct channel index counting up from 0,
 *    skipping 9 (so pad/bass/melody/texture get 0,1,2,3 as needed).
 *    Channels are assigned in `trackOrder` among the voices actually present.
 */

import { TICKS_PER_QUARTER } from "@lime/core";
import type { NoteEvent, VoiceId } from "@lime/core";
import { encodeVLQ } from "./vlq.js";

/** The GM drum channel index (channel 10, 0-based 9). */
export const DRUM_CHANNEL = 9;

/** Default order in which voice tracks are written. */
export const DEFAULT_TRACK_ORDER: readonly VoiceId[] = [
  "pad",
  "bass",
  "melody",
  "percussion",
  "texture",
] as const;

/** Options controlling SMF export. */
export interface MidiExportOptions {
  /** Pulses (ticks) per quarter note. Default {@link TICKS_PER_QUARTER} (480). */
  ppq?: number;
  /** Single tempo in BPM when no tempo map is supplied. Default 120. */
  tempo?: number;
  /**
   * Optional tempo map. Each entry sets a new tempo at an absolute tick.
   * When present it takes precedence over `tempo` and all changes are emitted.
   */
  tempoChanges?: { tick: number; bpm: number }[];
  /** Track write order. Default {@link DEFAULT_TRACK_ORDER}. */
  trackOrder?: VoiceId[];
  /** Sequence name meta (FF 03) written to the conductor track. */
  name?: string;
  /**
   * Optional per-voice General-MIDI program (0–127). When set for a voice, a
   * Program Change is emitted at tick 0 on that voice's channel, so a bare SMF
   * played by a GM synth (e.g. `fluidsynth`) uses the intended instrument
   * instead of defaulting every channel to piano.
   */
  programs?: Partial<Record<VoiceId, number>>;
}

/**
 * Convert a normalized velocity (0..1) to a MIDI velocity (1..127).
 * Rounds and clamps; the minimum is 1 so a note is never silent-by-zero.
 */
export function toMidiVelocity(v: number): number {
  const scaled = Math.round(v * 127);
  if (scaled < 1) return 1;
  if (scaled > 127) return 127;
  return scaled;
}

/** Microseconds per quarter note for a BPM (the Set-Tempo payload value). */
export function bpmToMicrosecondsPerQuarter(bpm: number): number {
  return Math.round(60000000 / bpm);
}

// --- Low-level byte helpers -------------------------------------------------

/** Push a fixed 4-byte big-endian unsigned int (used for chunk lengths). */
function writeUint32BE(out: number[], value: number): void {
  out.push((value >>> 24) & 0xff);
  out.push((value >>> 16) & 0xff);
  out.push((value >>> 8) & 0xff);
  out.push(value & 0xff);
}

/** Push a fixed 2-byte big-endian unsigned int (header fields). */
function writeUint16BE(out: number[], value: number): void {
  out.push((value >>> 8) & 0xff);
  out.push(value & 0xff);
}

/** ASCII bytes of a string (used for chunk ids and text metas). */
function asciiBytes(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    bytes.push(s.charCodeAt(i) & 0xff);
  }
  return bytes;
}

/** Wrap track-event bytes in an `MTrk` chunk with a 4-byte BE length. */
function makeTrackChunk(eventBytes: number[]): number[] {
  const chunk: number[] = [];
  chunk.push(...asciiBytes("MTrk"));
  writeUint32BE(chunk, eventBytes.length);
  chunk.push(...eventBytes);
  return chunk;
}

// --- Track builders ---------------------------------------------------------

/** One timed message inside a track, pre-delta (absolute tick). */
interface AbsEvent {
  /** Absolute tick. */
  tick: number;
  /**
   * Ordering key at the same tick: note-offs (0) sort before note-ons (1) so a
   * note ending exactly where another begins is not clipped.
   */
  kind: 0 | 1;
  /** Insertion index, for deterministic stable ordering within (tick, kind). */
  seq: number;
  /** The raw MIDI message bytes (status + data), without the delta-time. */
  bytes: number[];
}

/** Convert a list of absolute-tick events into delta-time-encoded bytes. */
function encodeAbsEvents(events: AbsEvent[]): number[] {
  const sorted = events.slice().sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.kind !== b.kind) return a.kind - b.kind;
    return a.seq - b.seq;
  });

  const out: number[] = [];
  let prevTick = 0;
  for (const ev of sorted) {
    const delta = ev.tick - prevTick;
    out.push(...encodeVLQ(delta));
    out.push(...ev.bytes);
    prevTick = ev.tick;
  }
  return out;
}

/** A text meta event (e.g. FF 03 for track name) with a VLQ length. */
function metaTextEvent(metaType: number, text: string): number[] {
  const data = asciiBytes(text);
  return [0xff, metaType, ...encodeVLQ(data.length), ...data];
}

/** End-of-track meta (FF 2F 00). */
const END_OF_TRACK: number[] = [0xff, 0x2f, 0x00];

/** Build the conductor (tempo) track: track 0. */
function buildConductorTrack(opts: Required<
  Pick<MidiExportOptions, "tempo">
> & Pick<MidiExportOptions, "tempoChanges" | "name">): number[] {
  const events: AbsEvent[] = [];
  let seq = 0;

  if (opts.name !== undefined) {
    events.push({ tick: 0, kind: 1, seq: seq++, bytes: metaTextEvent(0x03, opts.name) });
  }

  const tempoMeta = (uspq: number): number[] => [
    0xff,
    0x51,
    0x03,
    (uspq >>> 16) & 0xff,
    (uspq >>> 8) & 0xff,
    uspq & 0xff,
  ];

  if (opts.tempoChanges && opts.tempoChanges.length > 0) {
    for (const change of opts.tempoChanges) {
      events.push({
        tick: change.tick,
        kind: 1,
        seq: seq++,
        bytes: tempoMeta(bpmToMicrosecondsPerQuarter(change.bpm)),
      });
    }
  } else {
    events.push({
      tick: 0,
      kind: 1,
      seq: seq++,
      bytes: tempoMeta(bpmToMicrosecondsPerQuarter(opts.tempo)),
    });
  }

  const bytes = encodeAbsEvents(events);
  bytes.push(...encodeVLQ(0), ...END_OF_TRACK);
  return makeTrackChunk(bytes);
}

/** Build a single voice track. */
function buildVoiceTrack(
  voice: VoiceId,
  channel: number,
  notes: readonly NoteEvent[],
  program?: number,
): number[] {
  const events: AbsEvent[] = [];
  let seq = 0;

  // Track name meta at the start.
  events.push({ tick: 0, kind: 1, seq: seq++, bytes: metaTextEvent(0x03, voice) });

  // Optional GM program change at tick 0 (before any note-on).
  if (program !== undefined) {
    events.push({ tick: 0, kind: 1, seq: seq++, bytes: [0xc0 | channel, program & 0x7f] });
  }

  const noteOn = 0x90 | channel;
  const noteOff = 0x80 | channel;

  for (const note of notes) {
    const pitch = note.pitch & 0x7f;
    const velocity = toMidiVelocity(note.velocity);
    events.push({
      tick: note.time,
      kind: 1,
      seq: seq++,
      bytes: [noteOn, pitch, velocity],
    });
    events.push({
      tick: note.time + note.duration,
      kind: 0,
      seq: seq++,
      bytes: [noteOff, pitch, 0],
    });
  }

  const bytes = encodeAbsEvents(events);
  bytes.push(...encodeVLQ(0), ...END_OF_TRACK);
  return makeTrackChunk(bytes);
}

// --- Main export ------------------------------------------------------------

/**
 * Serialize LIME note events to a Format 1 Standard MIDI File.
 *
 * The result is a self-contained {@link Uint8Array}: an `MThd` header, a
 * conductor track carrying tempo, and one `MTrk` per voice that has events
 * (in `trackOrder`).
 */
export function eventsToStandardMidiFile(
  events: readonly NoteEvent[],
  opts: MidiExportOptions = {},
): Uint8Array {
  const ppq = opts.ppq ?? TICKS_PER_QUARTER;
  const tempo = opts.tempo ?? 120;
  const trackOrder = opts.trackOrder ?? DEFAULT_TRACK_ORDER;

  // Group events by voice, preserving input order within each voice.
  const byVoice = new Map<VoiceId, NoteEvent[]>();
  for (const e of events) {
    const list = byVoice.get(e.voice);
    if (list) list.push(e);
    else byVoice.set(e.voice, [e]);
  }

  // Voices to emit, in trackOrder, only those actually present.
  const presentVoices = trackOrder.filter((v) => byVoice.has(v));

  // Assign channels: percussion -> 9; others -> next index skipping 9.
  const channelOf = new Map<VoiceId, number>();
  let nextChannel = 0;
  for (const voice of presentVoices) {
    if (voice === "percussion") {
      channelOf.set(voice, DRUM_CHANNEL);
    } else {
      if (nextChannel === DRUM_CHANNEL) nextChannel++;
      channelOf.set(voice, nextChannel);
      nextChannel++;
    }
  }

  const conductor = buildConductorTrack({
    tempo,
    ...(opts.tempoChanges !== undefined ? { tempoChanges: opts.tempoChanges } : {}),
    ...(opts.name !== undefined ? { name: opts.name } : {}),
  });

  const voiceTracks = presentVoices.map((voice) =>
    buildVoiceTrack(voice, channelOf.get(voice)!, byVoice.get(voice)!, opts.programs?.[voice]),
  );

  const ntrks = 1 + voiceTracks.length;

  // MThd header chunk.
  const header: number[] = [];
  header.push(...asciiBytes("MThd"));
  writeUint32BE(header, 6); // header data length is always 6
  writeUint16BE(header, 1); // format 1
  writeUint16BE(header, ntrks);
  writeUint16BE(header, ppq); // division (ticks per quarter)

  const all: number[] = [...header, ...conductor];
  for (const t of voiceTracks) all.push(...t);

  return Uint8Array.from(all);
}
