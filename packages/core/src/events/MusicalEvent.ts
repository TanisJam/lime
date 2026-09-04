import type { Ticks, MusicalDuration } from "../time/MusicalTime.js";

/**
 * Symbolic musical events.
 *
 * These are the composer's output and the renderer's input. They contain NO
 * renderer-specific data (no Tone.js instruments, no audio nodes), so the same
 * stream can drive a Tone renderer, a SoundFont renderer, Web MIDI, or a MIDI
 * file export later.
 */

/**
 * The musical roles LIME composes for. `motion` is an arpeggio/ostinato/stab
 * layer (added in the multi-genre work); `texture` is optional/extra.
 */
export type VoiceId = "pad" | "bass" | "melody" | "motion" | "percussion" | "texture";

export const VOICES: readonly VoiceId[] = [
  "pad",
  "bass",
  "melody",
  "motion",
  "percussion",
  "texture",
] as const;

/**
 * Abstract percussion sounds. Mapped to concrete synths by the renderer.
 * Pitches follow a General-MIDI-like convention for easy MIDI export.
 */
export type PercussionSound = "kick" | "snare" | "hat" | "tom" | "shaker";

/** GM-ish MIDI note numbers for percussion sounds (drum channel convention). */
export const PERCUSSION_MIDI: Record<PercussionSound, number> = {
  kick: 36,
  snare: 38,
  hat: 42,
  tom: 45,
  shaker: 70,
};

/** A single note (or drum hit) placed on the timeline. */
export interface NoteEvent {
  readonly type: "note";
  /** Absolute start time, in ticks. */
  readonly time: Ticks;
  /** Duration, in ticks. */
  readonly duration: MusicalDuration;
  /** MIDI pitch (0–127). For percussion, the GM-ish drum number. */
  readonly pitch: number;
  /** Normalized velocity 0–1. Renderers scale to their own range. */
  readonly velocity: number;
  /** Which musical role emitted this event. */
  readonly voice: VoiceId;
  /** Present on percussion events; the abstract sound name. */
  readonly percussion?: PercussionSound;
}

/**
 * Umbrella event type. Only notes exist in v0.1, but the discriminated `type`
 * leaves room for control/automation events without breaking consumers.
 */
export type MusicalEvent = NoteEvent;

/** Type guard for note events. */
export function isNoteEvent(e: MusicalEvent): e is NoteEvent {
  return e.type === "note";
}

/** End time (exclusive) of an event. */
export function eventEnd(e: NoteEvent): Ticks {
  return e.time + e.duration;
}

/** Stable time-ordering comparator (ties broken by voice then pitch). */
export function compareEvents(a: NoteEvent, b: NoteEvent): number {
  if (a.time !== b.time) return a.time - b.time;
  if (a.voice !== b.voice) return a.voice < b.voice ? -1 : 1;
  return a.pitch - b.pitch;
}
