import type { Mode } from "../harmony/Scale.js";
import type { TransitionTable } from "../harmony/HarmonyRules.js";

/**
 * A StylePack configures the musical world: which modes are allowed, the key,
 * phrase length, tempo range, and instrumentation. v0.1 ships exactly one
 * ("ambient-minimal"); the shape is deliberately small but leaves room to grow
 * without becoming a plugin ecosystem yet.
 */

export type Waveform = "sine" | "triangle" | "sawtooth" | "square";

/** Plain-data description of a pitched synth voice. Renderer-agnostic. */
export interface SynthVoiceConfig {
  readonly oscillator: Waveform;
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  /** Low-pass cutoff in Hz, if the renderer supports filtering. */
  readonly filterCutoff?: number;
  /** Linear gain 0–1. */
  readonly gain: number;
}

/** Instrumentation hints consumed by a renderer (never by core logic). */
export interface InstrumentationConfig {
  readonly reverbWet: number;
  readonly reverbDecay: number;
  readonly delayWet: number;
  readonly pad: SynthVoiceConfig;
  readonly bass: SynthVoiceConfig;
  readonly melody: SynthVoiceConfig;
  /** Overall percussion gain 0–1. */
  readonly percussionGain: number;
}

/** Optional corpus-derived harmony configuration for a style. */
export interface HarmonyStyle {
  /** Weighted chord transitions extracted from a corpus (falls back to defaults). */
  readonly transitions?: TransitionTable;
}

/** Optional corpus-derived melodic configuration. */
export interface MelodyStyle {
  /** Diatonic step interval → weight, shaping generated motif contours. */
  readonly intervalWeights?: Record<number, number>;
  /** Note-value name → weight, shaping generated motif rhythms. */
  readonly durationWeights?: Record<string, number>;
}

/** Optional corpus-derived rhythmic configuration. */
export interface RhythmStyle {
  /** Onset likelihood at each of 16 sixteenth positions per bar (0–1). */
  readonly onsetProfile?: number[];
}

export interface StylePack {
  readonly id: string;
  /** Modes this style may use. */
  readonly modes: readonly Mode[];
  readonly defaultMode: Mode;
  /** Tonic pitch class 0–11. */
  readonly keyPc: number;
  readonly phraseLengthBars: 4 | 8;
  readonly tempoRange: readonly [number, number];
  readonly instrumentation: InstrumentationConfig;
  /** Optional corpus-derived harmony overrides. */
  readonly harmony?: HarmonyStyle;
  /** Optional corpus-derived melody overrides. */
  readonly melody?: MelodyStyle;
  /** Optional corpus-derived rhythm overrides. */
  readonly rhythm?: RhythmStyle;
}
