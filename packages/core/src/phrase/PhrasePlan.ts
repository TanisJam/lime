/**
 * Phrase-level intent — the layer that turns four independent voices into one
 * shaped musical gesture.
 *
 * A phrase is 4 or 8 bars with a role (statement / variation / development /
 * cadence). Left alone, each voice re-derives its decisions from the raw
 * `MusicalState` every bar, so the texture has no shared direction: the melody
 * might climb while the bass relaxes and the drums build, all in the same bar.
 *
 * The `PhraseDirector` fixes that by planning ONE gesture per bar, BEFORE any
 * voice generates. Every generator then reads the same `PhrasePlan`, so the
 * phrase breathes as a unit — energy and tension trace an arc, register and
 * density point the same way, and cadences ease together.
 *
 * This is internal machinery. `PhrasePlan` is never part of the public engine
 * API; it flows on `BarContext` to the generators and is surfaced read-only in
 * the debug snapshot for the perceptual harness.
 */

import type { MusicalState } from "../state/MusicalState.js";
import type { PhraseInfo, PhraseRole } from "./PhrasePlanner.js";

/** Direction a phrase-level quantity travels across the phrase. */
export type PhraseDirection = "rising" | "falling" | "steady";

/**
 * How present the melody should be across this phrase. Carried here so the
 * melody-restraint step (and the bass/melody coordination step) read a single
 * shared decision instead of each re-deriving activity from raw state.
 */
export type MelodicActivity = "lead" | "sparse" | "tacet";

/** Where the phrase sits relative to a cadence. */
export type CadenceIntent = "none" | "approaching" | "resolving";

/**
 * One coherent gesture for a single bar, planned before any voice generates.
 *
 * `energyStart`/`energyEnd` (and the tension pair) describe the arc across the
 * whole phrase; `energy`/`tension` are those arcs sampled at THIS bar's
 * position, which is the value a generator should shape its intensity by.
 */
export interface PhrasePlan {
  readonly role: PhraseRole;
  readonly barInPhrase: number;
  readonly lengthBars: number;
  /** 0 at the phrase's first bar, 1 at its last (0 for a 1-bar phrase). */
  readonly position: number;

  /** Energy arc endpoints for the whole phrase (0..1). */
  readonly energyStart: number;
  readonly energyEnd: number;
  /** Tension arc endpoints for the whole phrase (0..1). */
  readonly tensionStart: number;
  readonly tensionEnd: number;
  /** Energy/tension interpolated at this bar's position — the arc value to use. */
  readonly energy: number;
  readonly tension: number;

  /** "falling" points toward the tonic / release, "rising" away from it. */
  readonly harmonicDirection: PhraseDirection;
  readonly melodicActivity: MelodicActivity;
  readonly melodicRegisterDirection: PhraseDirection;
  readonly rhythmicDensityDirection: PhraseDirection;
  readonly cadenceIntent: CadenceIntent;
}

/** Per-role shape of the energy/tension arc and register drift over a phrase. */
interface RoleShape {
  readonly energyDelta: number;
  readonly tensionDelta: number;
  readonly register: PhraseDirection;
}

/**
 * How each role bends the ambient state across its bars. Statements open
 * gently, variations relax, developments build, cadences release. These are
 * small nudges layered on top of the slower state drift — the phrase shapes
 * the gesture, the state machine sets the baseline.
 */
const ROLE_SHAPES: Record<PhraseRole, RoleShape> = {
  statement: { energyDelta: 0.06, tensionDelta: 0.03, register: "rising" },
  variation: { energyDelta: 0.02, tensionDelta: -0.02, register: "steady" },
  development: { energyDelta: 0.15, tensionDelta: 0.12, register: "rising" },
  cadence: { energyDelta: -0.1, tensionDelta: -0.16, register: "falling" },
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function directionOf(delta: number, epsilon = 0.02): PhraseDirection {
  if (delta > epsilon) return "rising";
  if (delta < -epsilon) return "falling";
  return "steady";
}

/**
 * Plans the phrase-level gesture one bar at a time.
 *
 * Pure and deterministic: the same `(state, phrase)` always yields the same
 * plan, with no RNG. Determinism matters because the whole point of the
 * harness is a repeatable perceptual regression suite.
 */
export class PhraseDirector {
  plan(state: MusicalState, phrase: PhraseInfo): PhrasePlan {
    const shape = ROLE_SHAPES[phrase.role];
    const span = phrase.lengthBars > 1 ? phrase.lengthBars - 1 : 1;
    const position = phrase.barInPhrase / span;

    const energyStart = clamp01(state.energy);
    const energyEnd = clamp01(state.energy + shape.energyDelta);
    const tensionStart = clamp01(state.tension);
    const tensionEnd = clamp01(state.tension + shape.tensionDelta);

    const cadenceIntent = this.cadenceIntent(phrase);
    // A resolving/approaching cadence always heads home; otherwise the harmony
    // follows where tension is going across the phrase.
    const harmonicDirection: PhraseDirection =
      cadenceIntent === "none"
        ? directionOf(tensionEnd - tensionStart)
        : "falling";

    return {
      role: phrase.role,
      barInPhrase: phrase.barInPhrase,
      lengthBars: phrase.lengthBars,
      position,
      energyStart,
      energyEnd,
      tensionStart,
      tensionEnd,
      energy: lerp(energyStart, energyEnd, position),
      tension: lerp(tensionStart, tensionEnd, position),
      harmonicDirection,
      melodicActivity: this.melodicActivity(state, phrase),
      melodicRegisterDirection: shape.register,
      rhythmicDensityDirection: directionOf(energyEnd - energyStart),
      cadenceIntent,
    };
  }

  private cadenceIntent(phrase: PhraseInfo): CadenceIntent {
    if (!phrase.isCadencePhrase) return "none";
    if (phrase.isLastBar) return "resolving";
    // The last bar before the final one is the approach into the cadence.
    const barsLeft = phrase.lengthBars - 1 - phrase.barInPhrase;
    return barsLeft <= 1 ? "approaching" : "none";
  }

  private melodicActivity(state: MusicalState, phrase: PhraseInfo): MelodicActivity {
    // Quiet phrases breathe; cadences and variations lean sparse to leave room;
    // strong statements and developments carry the lead line. Consumed later by
    // melody restraint — here it is planned once so every voice agrees.
    if (state.energy < 0.22) return "tacet";
    if (state.energy < 0.4) return "sparse";
    if (phrase.role === "cadence" || phrase.role === "variation") return "sparse";
    return "lead";
  }
}
