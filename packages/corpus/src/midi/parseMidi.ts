import { parseMidi as parseSmf } from "midi-file";
import type { CorpusMeta, CorpusNote, CorpusScore } from "../ir.js";

export interface ParseMidiOptions {
  readonly id: string;
  readonly meta: Omit<CorpusMeta, "key">;
  /** Ticks to keep a dangling (never-closed) note sounding. Default 1 beat. */
  readonly danglingDurationTicks?: number;
}

/**
 * Parse a Standard MIDI File buffer into corpus IR.
 *
 * Pairs note-on/note-off (a note-on with velocity 0 is a note-off), tracks the
 * program per channel, and marks MIDI channel 10 (index 9) as percussion. Tempo
 * and time signature come from the first such events; times stay in source ticks.
 */
export function parseMidiFile(data: Uint8Array, options: ParseMidiOptions): CorpusScore {
  const smf = parseSmf(data);
  const ppq = smf.header.ticksPerBeat && smf.header.ticksPerBeat > 0 ? smf.header.ticksPerBeat : 480;
  const dangling = options.danglingDurationTicks ?? ppq;

  let tempoBpm = 120;
  let tsNum = 4;
  let tsDen = 4;
  let tempoSet = false;
  let tsSet = false;

  const notes: CorpusNote[] = [];

  smf.tracks.forEach((events, trackIndex) => {
    let time = 0;
    const programByChannel = new Map<number, number>();
    // Active notes: key `${channel}:${note}` → { start, velocity }.
    const active = new Map<string, { start: number; velocity: number }>();

    for (const ev of events) {
      time += ev.deltaTime;
      switch (ev.type) {
        case "setTempo":
          if (!tempoSet && ev.microsecondsPerBeat && ev.microsecondsPerBeat > 0) {
            tempoBpm = 60_000_000 / ev.microsecondsPerBeat;
            tempoSet = true;
          }
          break;
        case "timeSignature":
          if (!tsSet && ev.numerator && ev.denominator) {
            tsNum = ev.numerator;
            tsDen = ev.denominator;
            tsSet = true;
          }
          break;
        case "programChange":
          if (ev.channel !== undefined && ev.programNumber !== undefined) {
            programByChannel.set(ev.channel, ev.programNumber);
          }
          break;
        case "noteOn":
          if (ev.velocity && ev.velocity > 0) {
            active.set(`${ev.channel}:${ev.noteNumber}`, { start: time, velocity: ev.velocity });
            break;
          }
          // velocity 0 → treat as noteOff (fall through).
          closeNote(ev, time);
          break;
        case "noteOff":
          closeNote(ev, time);
          break;
        default:
          break;
      }
    }

    // Close any dangling notes at their track's end.
    for (const [key, info] of active) {
      const [ch, note] = key.split(":").map(Number) as [number, number];
      emit(ch, note, info.start, dangling, info.velocity);
    }

    function closeNote(ev: { channel?: number; noteNumber?: number }, endTime: number): void {
      const key = `${ev.channel}:${ev.noteNumber}`;
      const info = active.get(key);
      if (!info) return;
      active.delete(key);
      emit(ev.channel ?? 0, ev.noteNumber ?? 0, info.start, Math.max(1, endTime - info.start), info.velocity);
    }

    function emit(channel: number, note: number, start: number, duration: number, velocity: number): void {
      notes.push({
        start,
        duration,
        pitch: note,
        velocity: Math.max(0, Math.min(1, velocity / 127)),
        track: trackIndex,
        program: programByChannel.get(channel),
        isPercussion: channel === 9,
      });
    }
  });

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  return {
    id: options.id,
    ppq,
    tempoBpm,
    timeSignature: { numerator: tsNum, denominator: tsDen },
    notes,
    meta: options.meta,
  };
}
