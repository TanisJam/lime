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
  /**
   * Stereo pan -1 (hard left) .. 1 (hard right). Optional; a renderer supplies a
   * sensible per-voice default when omitted. Plain data — renderer-agnostic.
   */
  readonly pan?: number;
  /**
   * Reverb send 0..1 for this voice, scaled by the global {@link InstrumentationConfig.reverbWet}.
   * Optional; the renderer applies a tasteful per-voice default when omitted.
   */
  readonly reverbSend?: number;
  /**
   * Delay send 0..1 for this voice, scaled by the global {@link InstrumentationConfig.delayWet}.
   * Optional; defaults to 0 for most voices (the renderer favours melody).
   */
  readonly delaySend?: number;
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
  /**
   * Global stereo-width scale 0..1 applied to per-voice panning (1 = full width,
   * 0 = mono). Optional; defaults to 1 so existing packs are unaffected.
   */
  readonly stereoWidth?: number;
  /**
   * Master output gain 0..1 applied before the final limiter. Optional; a
   * renderer supplies a safe default (≈0.9) when omitted.
   */
  readonly masterGain?: number;
  /**
   * Reverb send 0..1 for the percussion bus, scaled by {@link reverbWet}.
   * Optional; the renderer keeps percussion mostly dry by default.
   */
  readonly percussionReverbSend?: number;
}

/** Optional corpus-derived harmony configuration for a style. */
export interface HarmonyStyle {
  /** Weighted chord transitions extracted from a corpus (falls back to defaults). */
  readonly transitions?: TransitionTable;
}

/** Scale the melody snaps to. `diatonic` is the default 7-note behaviour. */
export type MelodyScale = "diatonic" | "minor-pentatonic" | "major-pentatonic";

/** Optional corpus-derived melodic configuration. */
export interface MelodyStyle {
  /** Diatonic step interval → weight, shaping generated motif contours. */
  readonly intervalWeights?: Record<number, number>;
  /** Note-value name → weight, shaping generated motif rhythms. */
  readonly durationWeights?: Record<string, number>;
  /**
   * Probability (0..1) that a wide melodic leap is followed by a stepwise move
   * in the opposite direction — classic leap resolution. Default 0.7. Lower it
   * for a more angular, disjunct melodic character.
   */
  readonly leapResolution?: number;
  /**
   * Scale the realized melody snaps to. `minor-pentatonic` is the rock/blues
   * riff sound (no 2nd/6th tension notes). Default `diatonic` (unchanged).
   */
  readonly scale?: MelodyScale;
}

/** A named groove feel the percussion generator can lock to. */
export type GrooveStyle = "backbeat";

/** Optional corpus-derived rhythmic configuration. */
export interface RhythmStyle {
  /** Onset likelihood at each of 16 sixteenth positions per bar (0–1). */
  readonly onsetProfile?: number[];
  /**
   * A named groove the percussion locks to instead of the ambient grammar.
   * `"backbeat"` = steady kick on 1 & 3, snare on 2 & 4, straight 8th hats
   * (rock/pop). Omit for the default energy-driven grammar.
   */
  readonly groove?: GrooveStyle;
}

/** How chords are realized into pitches. */
export type ChordStyle = "triad" | "power";

/** How the bass moves. `root-drive` = doubled chord root in straight 8ths (rock). */
export type BassStyle = "default" | "root-drive";

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
  /**
   * How the harmonic bed realizes chords. `"power"` voices root+fifth(+octave)
   * power chords (rock/metal) instead of triads. Default `"triad"`.
   */
  readonly chordStyle?: ChordStyle;
  /**
   * How the bass moves. `"root-drive"` locks a driving straight-8th chord-root
   * pulse (rock, with the kick). Default `"default"` (the musical bass grammar).
   */
  readonly bassStyle?: BassStyle;
}
