/**
 * Musical state: the application's musical *intent*, not notes.
 *
 * Seven normalized parameters (0–1) plus tempo. The application sets a target
 * state; the composer maintains its own current state and converges toward the
 * target at musically meaningful boundaries (see StateManager). See the handoff
 * for the meaning of each parameter.
 */
export interface MusicalState {
  /** Rhythmic density, activity, layer count, average velocity. */
  energy: number;
  /** Harmonic instability, dominant tendency, cadence avoidance. */
  tension: number;
  /** Emotional axis: 0 = darker, 1 = brighter/positive. One influence, not a rule. */
  valence: number;
  /** Amount of musical information, independent of energy. */
  density: number;
  /** Register / timbre brightness. Primarily a renderer/orchestration hint. */
  brightness: number;
  /** Rhythmic variation, motif transformation, syncopation, chord change rate. */
  complexity: number;
  /** Willingness to depart from established patterns (low = repetition). */
  instability: number;
  /** Tempo in BPM. NOT normalized. */
  tempo: number;
}

/** Bounds for tempo, per the v0.1 scope. */
export const TEMPO_MIN = 60;
export const TEMPO_MAX = 130;

/** The normalized (0–1) keys of {@link MusicalState}. */
export const NORMALIZED_KEYS = [
  "energy",
  "tension",
  "valence",
  "density",
  "brightness",
  "complexity",
  "instability",
] as const satisfies readonly (keyof MusicalState)[];

export type NormalizedKey = (typeof NORMALIZED_KEYS)[number];

/** A partial state update, as passed to `setState`/`transitionTo`. */
export type MusicalStatePatch = Partial<MusicalState>;

/** When a requested state change begins taking effect. */
export type Quantization = "immediate" | "nextBeat" | "nextBar" | "nextPhrase";

/** Options for `setState` / `transitionTo`. */
export interface StateChangeOptions {
  /** When the change begins. Default `nextBar`. */
  quantize?: Quantization;
  /** Explicit linear-ramp length. Omit for gradual asymptotic easing. */
  duration?: { bars: number };
}

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clampTempo(v: number): number {
  if (Number.isNaN(v)) return TEMPO_MIN;
  return v < TEMPO_MIN ? TEMPO_MIN : v > TEMPO_MAX ? TEMPO_MAX : v;
}

/** Return a copy with every parameter clamped to its valid range. */
export function normalizeState(state: MusicalState): MusicalState {
  return {
    energy: clamp01(state.energy),
    tension: clamp01(state.tension),
    valence: clamp01(state.valence),
    density: clamp01(state.density),
    brightness: clamp01(state.brightness),
    complexity: clamp01(state.complexity),
    instability: clamp01(state.instability),
    tempo: clampTempo(state.tempo),
  };
}

/** Merge a patch onto a base state and clamp the result. */
export function applyPatch(
  base: MusicalState,
  patch: MusicalStatePatch,
): MusicalState {
  return normalizeState({ ...base, ...patch });
}

/** Linear interpolation between two states. `t` is clamped to [0,1]. */
export function lerpState(
  a: MusicalState,
  b: MusicalState,
  t: number,
): MusicalState {
  const k = clamp01(t);
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    energy: mix(a.energy, b.energy),
    tension: mix(a.tension, b.tension),
    valence: mix(a.valence, b.valence),
    density: mix(a.density, b.density),
    brightness: mix(a.brightness, b.brightness),
    complexity: mix(a.complexity, b.complexity),
    instability: mix(a.instability, b.instability),
    tempo: mix(a.tempo, b.tempo),
  };
}

/** A neutral, calm default. */
export const DEFAULT_STATE: MusicalState = {
  energy: 0.3,
  tension: 0.2,
  valence: 0.6,
  density: 0.3,
  brightness: 0.5,
  complexity: 0.2,
  instability: 0.15,
  tempo: 76,
};

/** Largest absolute per-parameter difference between two states. */
export function stateDistance(a: MusicalState, b: MusicalState): number {
  let max = 0;
  for (const k of NORMALIZED_KEYS) {
    max = Math.max(max, Math.abs(a[k] - b[k]));
  }
  // Normalize tempo difference against its range for comparability.
  max = Math.max(max, Math.abs(a.tempo - b.tempo) / (TEMPO_MAX - TEMPO_MIN));
  return max;
}
