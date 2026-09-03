/**
 * Orchestration intent — which musical forces are active this bar, how present
 * each one is, and which one the ear should follow.
 *
 * This is the orchestration analogue of {@link PhrasePlan}: planned once per bar
 * by the {@link OrchestrationDirector} before any voice generates, and carried
 * on {@link BarContext} so every generator reads the same shared decision
 * instead of each re-deriving its own density from raw state.
 *
 * It is internal machinery — never part of the public engine API. The host still
 * describes intent (energy/tension/…); the OrchestrationDirector turns that into
 * an arrangement. The plan is surfaced read-only in the debug snapshot.
 */

import type { MusicalRole } from "./MusicalRole.js";

/**
 * Perceptual depth — how far forward a role sits in the mix. The core decides
 * the hierarchy; the renderer realizes it (gain, width, filtering, reverb).
 */
export type Depth = "foreground" | "midground" | "background";

/**
 * One bar's orchestration: the active forces and their relative weights.
 *
 * `prominence` and `activity` are separate on purpose — a role can be loud but
 * simple (a foreground pad) or quiet but busy (a background ostinato). Depth and
 * focus give the arrangement its shape; the activity numbers are a shared budget
 * so complexity in one role can pull it back in another.
 */
export interface OrchestrationPlan {
  /** Roles present this bar, in canonical order. */
  readonly activeRoles: readonly MusicalRole[];

  /**
   * Mix weight per active role (0..1) — how present/loud it should sit. Drives
   * the renderer's role-aware gain/width/reverb. Derived from depth + state.
   */
  readonly prominence: Partial<Record<MusicalRole, number>>;

  /**
   * How busy each active role should be (0..1), drawn from a shared ~1.0 budget:
   * a busier lead leaves less for motion and rhythm. Generators read *their*
   * value instead of re-deriving density from raw `state`.
   */
  readonly activity: Partial<Record<MusicalRole, number>>;

  /** Perceptual depth per active role. */
  readonly depth: Partial<Record<MusicalRole, Depth>>;

  /** The single role the listener should follow this bar. Always active. */
  readonly focus: MusicalRole;

  /**
   * Register nudge per role (-1..+1: lower … higher). Optional; a hint the
   * generators/voicing may honor to widen or narrow the ensemble.
   */
  readonly registerBias?: Partial<Record<MusicalRole, number>>;

  /** Named ensemble configuration in effect, once StylePacks define them (Ph.9). */
  readonly ensemble?: string;
}
