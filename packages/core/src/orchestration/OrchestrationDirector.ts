/**
 * OrchestrationDirector — decides which musical forces are active this bar, how
 * present each sits, and which one leads the ear.
 *
 * It sits between the PhraseDirector and the voice generators: given the bar's
 * effective state, its phrase plan, and the large-scale form, it produces an
 * {@link OrchestrationPlan}. This is the layer that replaces v0.2's
 * energy-only {@link Arrangement} boolean gate with per-role activity, depth,
 * and focus.
 *
 * Migration note (Phases 1–2): the director *absorbs* the Arrangement — it holds
 * one and drives its hysteresis exactly as before, so the set of active voices
 * is byte-identical to v0.2 for the same energy sequence. The extra fields
 * (activity budget, depth, focus, prominence) are computed and carried on
 * BarContext but not yet consumed by the generators; Phase 3 wires them in one
 * voice at a time. Pure and deterministic (no RNG), mirroring the PhraseDirector.
 */

import type { MusicalState } from "../state/MusicalState.js";
import type { PhrasePlan } from "../phrase/PhrasePlan.js";
import type { FormState } from "../phrase/FormDirector.js";
import { Arrangement, type ArrangementVoice } from "./Arrangement.js";
import {
  MUSICAL_ROLES,
  ROLE_FOR_VOICE,
  type MusicalRole,
} from "./MusicalRole.js";
import type { Depth, OrchestrationPlan } from "./OrchestrationPlan.js";

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** How present each depth sits in the mix (renderer gain/width baseline). */
const DEPTH_PROMINENCE: Record<Depth, number> = {
  foreground: 1.0,
  midground: 0.62,
  background: 0.4,
};

export class OrchestrationDirector {
  /**
   * The energy-gated voice arrangement with hysteresis, exactly as v0.2. Owned
   * here now instead of by the Orchestrator so a single layer decides presence.
   */
  private readonly arrangement = new Arrangement();

  /**
   * Plan the bar's orchestration. Mutates the internal arrangement hysteresis,
   * so call exactly once per bar in increasing bar order (as composeBar does).
   */
  plan(state: MusicalState, phrasePlan: PhrasePlan, _form: FormState): OrchestrationPlan {
    const voices = this.arrangement.update(state.energy);
    const activeRoles = this.rolesFor(voices);

    const focus = this.pickFocus(activeRoles, phrasePlan);
    const depth = this.assignDepth(activeRoles, focus);
    const activity = this.allocateActivity(activeRoles, state, phrasePlan);
    const prominence = this.deriveProminence(activeRoles, depth, phrasePlan);
    const registerBias = this.deriveRegisterBias(activeRoles, state);

    return { activeRoles, prominence, activity, depth, focus, registerBias };
  }

  /** Active voices in the arrangement (read-only), for debug back-compat. */
  get activeVoices(): ReadonlySet<ArrangementVoice> {
    return this.arrangement.current;
  }

  // --- internals -----------------------------------------------------------

  /** Map the active voice set to roles, in canonical role order. */
  private rolesFor(voices: ReadonlySet<ArrangementVoice>): MusicalRole[] {
    const roles = new Set<MusicalRole>();
    for (const v of voices) roles.add(ROLE_FOR_VOICE[v]);
    return MUSICAL_ROLES.filter((r) => roles.has(r));
  }

  /**
   * The role the ear should follow. The melody leads when it is carrying the
   * line; when it rests (or is absent) the harmonic bed carries the phrase. The
   * bed is always present, so this always names an active role.
   */
  private pickFocus(active: readonly MusicalRole[], plan: PhrasePlan): MusicalRole {
    const melodyActive = active.includes("primary-melody");
    if (melodyActive && plan.melodicActivity !== "tacet") return "primary-melody";
    return active.includes("harmonic-bed") ? "harmonic-bed" : (active[0] ?? "harmonic-bed");
  }

  /**
   * Perceptual depth per role. Foundation and bed sit back; percussion in the
   * midground; the focus role is pulled to the foreground and any other natural
   * foreground is demoted, so exactly one thing leads.
   */
  private assignDepth(
    active: readonly MusicalRole[],
    focus: MusicalRole,
  ): Partial<Record<MusicalRole, Depth>> {
    const base: Partial<Record<MusicalRole, Depth>> = {
      foundation: "background",
      "harmonic-bed": "background",
      "primary-melody": "foreground",
      "mid-rhythm": "midground",
    };
    const depth: Partial<Record<MusicalRole, Depth>> = {};
    for (const role of active) {
      let d = base[role] ?? "midground";
      if (role !== focus && d === "foreground") d = "midground";
      depth[role] = d;
    }
    depth[focus] = "foreground";
    return depth;
  }

  /**
   * Split a shared ~1.0 activity budget across the active roles from each role's
   * demand, so a busier lead leaves less room for motion and rhythm. Normalized
   * to sum to 1 over the active roles.
   */
  private allocateActivity(
    active: readonly MusicalRole[],
    state: MusicalState,
    plan: PhrasePlan,
  ): Partial<Record<MusicalRole, number>> {
    const melodyDemand =
      plan.melodicActivity === "lead"
        ? 0.5
        : plan.melodicActivity === "sparse"
          ? 0.28
          : 0.05;
    const demand: Partial<Record<MusicalRole, number>> = {
      foundation: 0.15 + 0.1 * state.energy,
      "harmonic-bed": 0.18,
      "primary-melody": melodyDemand * (0.6 + 0.4 * clamp01(plan.energy)),
      "mid-rhythm": 0.1 + 0.4 * state.energy + 0.2 * state.density,
    };

    let total = 0;
    for (const role of active) total += demand[role] ?? 0.1;
    const activity: Partial<Record<MusicalRole, number>> = {};
    if (total <= 0) {
      const even = active.length > 0 ? 1 / active.length : 0;
      for (const role of active) activity[role] = even;
      return activity;
    }
    for (const role of active) activity[role] = (demand[role] ?? 0.1) / total;
    return activity;
  }

  /** Mix weight per role from its depth, lifted a touch for the loud phrases. */
  private deriveProminence(
    active: readonly MusicalRole[],
    depth: Partial<Record<MusicalRole, Depth>>,
    plan: PhrasePlan,
  ): Partial<Record<MusicalRole, number>> {
    const prominence: Partial<Record<MusicalRole, number>> = {};
    for (const role of active) {
      const d = depth[role] ?? "midground";
      const lift = d === "foreground" ? 0.15 * clamp01(plan.dynamics) : 0;
      prominence[role] = clamp01(DEPTH_PROMINENCE[d] + lift);
    }
    return prominence;
  }

  /**
   * A gentle register hint from brightness (centered at 0): brighter states nudge
   * the melody and bed up, darker ones down. Optional and small — a hint the
   * voicing may honor later, not a constraint.
   */
  private deriveRegisterBias(
    active: readonly MusicalRole[],
    state: MusicalState,
  ): Partial<Record<MusicalRole, number>> {
    const b = (state.brightness - 0.5) * 0.6; // -0.3..+0.3
    const bias: Partial<Record<MusicalRole, number>> = {};
    if (active.includes("primary-melody")) bias["primary-melody"] = b;
    if (active.includes("harmonic-bed")) bias["harmonic-bed"] = b * 0.5;
    return bias;
  }
}
