import type { Meter } from "../time/MusicalTime.js";
import type { MusicalState } from "../state/MusicalState.js";
import type { HarmonicEvent } from "../harmony/Chord.js";
import type { PhraseInfo } from "../phrase/PhrasePlanner.js";
import type { PhrasePlan } from "../phrase/PhrasePlan.js";
import type { OrchestrationPlan } from "./OrchestrationPlan.js";
import type { SeededRandom } from "../random/SeededRandom.js";

/**
 * Everything a voice generator needs to compose exactly one bar.
 *
 * Generators are pure: given the same context they emit the same events. The
 * `rng` is a bar-scoped stream (derived per voice + bar), so regenerating a bar
 * is idempotent and cross-bar continuity is carried by explicit fields
 * (`previousTopPitch`, `nextChord`), not by RNG state.
 */
export interface BarContext {
  /** Absolute bar index being composed. */
  readonly bar: number;
  /** Absolute start tick of the bar. */
  readonly barStartTick: number;
  readonly meter: Meter;
  /** The composer's current musical state, sampled at this bar boundary. */
  readonly state: MusicalState;
  /** Chord active during this bar. */
  readonly chord: HarmonicEvent;
  /** Chord active in the next bar, if known (for anticipation / voice leading). */
  readonly nextChord: HarmonicEvent | undefined;
  readonly phrase: PhraseInfo;
  /**
   * The single phrase-level gesture every voice interprets this bar. Planned by
   * the PhraseDirector before any generator runs, so pad/bass/melody/percussion
   * shape the same arc instead of each re-deriving from raw `state`.
   */
  readonly phrasePlan: PhrasePlan;
  /**
   * The bar's orchestration: which roles are active, their depth/focus, and a
   * shared activity budget. Planned by the OrchestrationDirector before any
   * voice generates. Generators may read their own role's activity/depth
   * instead of re-deriving density from raw `state` (wired in per voice from
   * Phase 3 on).
   */
  readonly orchestration: OrchestrationPlan;
  /** Bar-scoped deterministic RNG for the emitting voice. */
  readonly rng: SeededRandom;
}
