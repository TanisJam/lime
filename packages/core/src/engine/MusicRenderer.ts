import type { MusicalEvent } from "../events/MusicalEvent.js";

/**
 * Renderer abstraction. Core knows nothing about how sound is made.
 *
 * Events are expressed in absolute ticks at {@link TICKS_PER_QUARTER}; a renderer
 * must honor that resolution when converting to real time. Implementations:
 * a Tone.js renderer, a SoundFont renderer, Web MIDI, a MIDI-file writer, etc.
 */
export interface MusicRenderer {
  /** Begin audio/transport. Resolves once running. */
  start(): Promise<void>;

  /** Stop and silence. */
  stop(): void;

  /**
   * Schedule already-composed events. Called repeatedly as the composition
   * horizon advances; events are immutable once handed over.
   */
  schedule(events: MusicalEvent[]): void;

  /** Set tempo in BPM. Renderers may ramp to avoid discontinuities. */
  setTempo(bpm: number): void;

  /** Current transport position, in ticks. Drives the composition horizon. */
  now(): number;

  /**
   * Drop every scheduled event whose start time (in ticks) is `>= tick`.
   * Optional — only needed to support `urgent` state changes (see
   * {@link StateChangeOptions.urgent}), which use it to un-schedule
   * composed-but-unplayed bars before recomposing them under the new state.
   * A renderer that omits this simply never takes the `urgent` fast path: the
   * engine falls back to a normal (non-urgent) change instead, so there is
   * never a risk of a discarded bar's notes staying scheduled alongside its
   * recomposed replacement.
   */
  cancelFrom?(tick: number): void;

  /** Release resources. */
  dispose?(): void;
}
