/**
 * Deterministic "listening baseline" harness for LIME v0.2.
 *
 * This is the perceptual regression suite: a fixed set of seeds plus a single,
 * fully deterministic state journey (CALM → EXPLORE → UNEASE → DANGER →
 * RESOLUTION → CALM). Nothing here reads the clock, the environment, or a PRNG,
 * so the same inputs always yield the same schedule and the same music.
 *
 * The canonical mood states live HERE (not in the demo). The demo imports these
 * so the app and the regression suite share one source of truth.
 */

import type {
  MusicalStatePatch,
  StateChangeOptions,
} from "../state/MusicalState.js";

/** The 10 fixed reference seeds, zero-padded, in order. */
export const REFERENCE_SEEDS = [
  "lime-reference-01",
  "lime-reference-02",
  "lime-reference-03",
  "lime-reference-04",
  "lime-reference-05",
  "lime-reference-06",
  "lime-reference-07",
  "lime-reference-08",
  "lime-reference-09",
  "lime-reference-10",
] as const satisfies readonly string[];

/** Names of the showcase stages. CALM appears twice: at the start and the end. */
export type ShowcaseStageName =
  | "CALM"
  | "EXPLORE"
  | "UNEASE"
  | "DANGER"
  | "RESOLUTION"
  | "CALM";

// --- Canonical mood states -------------------------------------------------
// Derived from the demo MOODS map (Calm / Explore / Unease / Danger / Resolve),
// which stays the visual reference. RESOLUTION eases tension right down while
// lifting valence — the sequence's emotional "landing" before returning to CALM.

/** Low energy/tension, high-ish valence: the resting state. */
export const CALM_STATE: MusicalStatePatch = {
  energy: 0.15,
  tension: 0.1,
  valence: 0.7,
  density: 0.2,
  complexity: 0.2,
  instability: 0.1,
  brightness: 0.5,
  tempo: 68,
};

/** Mid everything, curiosity: movement without threat. */
export const EXPLORE_STATE: MusicalStatePatch = {
  energy: 0.42,
  tension: 0.32,
  valence: 0.55,
  density: 0.42,
  complexity: 0.42,
  instability: 0.38,
  brightness: 0.55,
  tempo: 78,
};

/** Rising tension, dimming valence: something is wrong. */
export const UNEASE_STATE: MusicalStatePatch = {
  energy: 0.48,
  tension: 0.62,
  valence: 0.32,
  density: 0.42,
  complexity: 0.48,
  instability: 0.55,
  brightness: 0.4,
  tempo: 82,
};

/** High energy/tension, dark valence: the climax. */
export const DANGER_STATE: MusicalStatePatch = {
  energy: 0.88,
  tension: 0.92,
  valence: 0.2,
  density: 0.72,
  complexity: 0.62,
  instability: 0.58,
  brightness: 0.35,
  tempo: 98,
};

/** Tension released toward high valence: the resolution. */
export const RESOLUTION_STATE: MusicalStatePatch = {
  energy: 0.4,
  tension: 0.15,
  valence: 0.78,
  density: 0.34,
  complexity: 0.3,
  instability: 0.2,
  brightness: 0.62,
  tempo: 74,
};

/** One stage of the showcase journey, modeled as data (see {@link expandShowcase}). */
export interface ShowcaseStage {
  /** Stage label. CALM appears twice — as the opening and the closing state. */
  name: ShowcaseStageName;
  /** Canonical target state ramped into during this stage. */
  state: MusicalStatePatch;
  /** Bars spent ramping INTO this stage's state. */
  transitionBars: number;
  /** Bars held at this stage's state before the next transition begins. */
  holdBars: number;
}

/**
 * The canonical showcase journey with FIXED timings.
 *
 * Bar budget (transition + hold), all phrase-aligned (multiples of 4):
 *   CALM        4 + 16 = 20   (gentle fade-in from the initial state)
 *   EXPLORE     8 + 16 = 24
 *   UNEASE      8 + 16 = 24
 *   DANGER      8 + 16 = 24
 *   RESOLUTION  8 + 16 = 24
 *   CALM        8 + 16 = 24
 *   ------------------------
 *   total              140 bars
 *
 * Each 16-bar hold is four 4-bar phrases, long enough to hear motif development
 * settle at every stage. In 4/4 the whole journey runs ~7.3 minutes at the
 * per-stage tempos (see {@link estimateShowcaseDurationSeconds}) — comfortably
 * beyond the ~5-minute goal, and never shorter than ~5.7 min even if every bar
 * ran at the fastest tempo (98 BPM).
 */
export const SHOWCASE_SEQUENCE: readonly ShowcaseStage[] = [
  { name: "CALM", state: CALM_STATE, transitionBars: 4, holdBars: 16 },
  { name: "EXPLORE", state: EXPLORE_STATE, transitionBars: 8, holdBars: 16 },
  { name: "UNEASE", state: UNEASE_STATE, transitionBars: 8, holdBars: 16 },
  { name: "DANGER", state: DANGER_STATE, transitionBars: 8, holdBars: 16 },
  { name: "RESOLUTION", state: RESOLUTION_STATE, transitionBars: 8, holdBars: 16 },
  { name: "CALM", state: CALM_STATE, transitionBars: 8, holdBars: 16 },
] as const;

/** A single scheduled state change produced by {@link expandShowcase}. */
export interface ScheduledChange {
  /** Absolute bar at which this change begins (its transition ramp starts). */
  atBar: number;
  /** Target state to ramp toward. */
  patch: MusicalStatePatch;
  /** Length of the ramp into the target, in bars. */
  transitionBars: number;
}

/** The expanded showcase schedule. */
export interface ShowcaseSchedule {
  changes: ScheduledChange[];
  totalBars: number;
}

/**
 * Expand a stage sequence into absolute-bar scheduled changes.
 *
 * Change N fires at the cumulative bar reached after the previous stage's
 * (transition + hold). Pure, deterministic, and stable: same input → identical
 * output, every call.
 */
export function expandShowcase(
  seq: readonly ShowcaseStage[] = SHOWCASE_SEQUENCE,
): ShowcaseSchedule {
  const changes: ScheduledChange[] = [];
  let cursor = 0;
  for (const stage of seq) {
    changes.push({
      atBar: cursor,
      patch: stage.state,
      transitionBars: stage.transitionBars,
    });
    cursor += stage.transitionBars + stage.holdBars;
  }
  return { changes, totalBars: cursor };
}

/**
 * Rough wall-clock duration of a sequence, in seconds, at its per-stage tempos.
 *
 * Each stage spans (transition + hold) bars; a bar is `beatsPerBar` beats, and a
 * beat lasts 60/tempo seconds. Tempo ramps within a transition are ignored — this
 * is a sanity estimate, not a sample-accurate figure.
 */
export function estimateShowcaseDurationSeconds(
  seq: readonly ShowcaseStage[] = SHOWCASE_SEQUENCE,
  beatsPerBar = 4,
): number {
  let seconds = 0;
  for (const stage of seq) {
    const bars = stage.transitionBars + stage.holdBars;
    const tempo = stage.state.tempo ?? 76;
    seconds += (bars * beatsPerBar * 60) / tempo;
  }
  return seconds;
}

/**
 * Minimal structural view of a LimeEngine the showcase driver needs. Kept
 * structural so the schedule data stays testable without constructing an engine.
 */
export interface ShowcaseDrivable {
  transitionTo(patch: MusicalStatePatch, options: StateChangeOptions): void;
  composeThrough(bar: number): void;
}

/**
 * Drive a showcase deterministically through a headless engine.
 *
 * For each scheduled change it composes forward to that bar, then issues the
 * transition quantized `immediate` so the ramp begins exactly at `atBar`
 * (headless quantization resolves against the composition frontier). Finally it
 * composes through `totalBars - 1` so the whole journey is rendered.
 *
 * A LIVE host (the demo) instead drives by wall clock: fire
 * `music.transitionTo(change.patch, { duration: { bars: change.transitionBars },
 * quantize: "nextBar" })` when the engine's current bar reaches `change.atBar`.
 */
export function driveShowcase(
  engine: ShowcaseDrivable,
  seq: readonly ShowcaseStage[] = SHOWCASE_SEQUENCE,
): ShowcaseSchedule {
  const schedule = expandShowcase(seq);
  for (const change of schedule.changes) {
    if (change.atBar > 0) engine.composeThrough(change.atBar - 1);
    engine.transitionTo(change.patch, {
      quantize: "immediate",
      duration: { bars: change.transitionBars },
    });
  }
  if (schedule.totalBars > 0) engine.composeThrough(schedule.totalBars - 1);
  return schedule;
}
