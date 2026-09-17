import type { MusicRenderer } from "../src/engine/MusicRenderer.js";
import type { MusicalEvent, NoteEvent } from "../src/events/MusicalEvent.js";
import type { StylePack } from "../src/style/StylePack.js";
import { MODE_INTERVALS, type Mode } from "../src/harmony/Scale.js";

/**
 * A renderer that records everything and lets tests control the playhead.
 * Implements `cancelFrom` (dropping scheduled events at/after a tick), so it
 * can exercise the `urgent` state-change path. Construct with
 * `{ cancelFrom: false }` to simulate a renderer that doesn't support it, and
 * exercise the fallback path instead.
 */
export class MockRenderer implements MusicRenderer {
  readonly scheduled: MusicalEvent[] = [];
  tempo = 0;
  private ticks = 0;
  running = false;

  /** Drop every scheduled event whose start tick is `>= tick`. Undefined when constructed with `{ cancelFrom: false }`. */
  cancelFrom?: (tick: number) => void;

  constructor(options: { cancelFrom?: boolean } = {}) {
    if (options.cancelFrom !== false) {
      this.cancelFrom = (tick: number) => {
        const kept = this.scheduled.filter((e) => e.time < tick);
        this.scheduled.length = 0;
        this.scheduled.push(...kept);
      };
    }
  }

  async start(): Promise<void> {
    this.running = true;
  }
  /**
   * Mirrors `Tone.Transport.stop()` (and `ToneRenderer.stop()`, which also
   * calls `.cancel()`): the clock resets to 0 and the renderer's own
   * schedule is wiped — exercises the engine's stop/start resume contract.
   */
  stop(): void {
    this.running = false;
    this.ticks = 0;
    this.scheduled.length = 0;
  }
  schedule(events: MusicalEvent[]): void {
    this.scheduled.push(...events);
  }
  setTempo(bpm: number): void {
    this.tempo = bpm;
  }
  now(): number {
    return this.ticks;
  }
  setNow(ticks: number): void {
    this.ticks = ticks;
  }
}

/** Minimal style pack for tests (no renderer instrumentation detail needed). */
export const testStyle: StylePack = {
  id: "test",
  modes: ["major", "naturalMinor", "dorian", "mixolydian"],
  defaultMode: "major",
  keyPc: 0,
  phraseLengthBars: 4,
  tempoRange: [70, 90],
  instrumentation: {
    reverbWet: 0.3,
    reverbDecay: 3,
    delayWet: 0.1,
    percussionGain: 0.6,
    pad: { oscillator: "sine", attack: 1, decay: 1, sustain: 0.7, release: 2, gain: 0.5 },
    bass: { oscillator: "triangle", attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.4, gain: 0.6 },
    melody: { oscillator: "sine", attack: 0.05, decay: 0.3, sustain: 0.5, release: 0.6, gain: 0.5 },
  },
};

/** Serialize a note event for deterministic comparison. */
export function serialize(e: NoteEvent): string {
  return `${e.voice}|${e.time}|${e.duration}|${e.pitch}|${e.velocity.toFixed(4)}`;
}

/** Pitch classes allowed in a key/mode. */
export function allowedPitchClasses(keyPc: number, mode: Mode): Set<number> {
  const set = new Set<number>();
  for (const iv of MODE_INTERVALS[mode]) set.add((keyPc + iv) % 12);
  return set;
}
