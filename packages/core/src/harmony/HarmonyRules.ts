import type { MusicalState } from "../state/MusicalState.js";
import type { SeededRandom } from "../random/SeededRandom.js";
import { type Mode, triadQuality } from "./Scale.js";
import { functionOfDegree } from "./Chord.js";

/**
 * Weighted harmonic transition system.
 *
 * Harmony is NOT random independent chord selection. Each chord favors a set of
 * successors, and the weights bend with musical state: calm music leans toward
 * tonic-function targets and slow harmonic rhythm; tense music leans toward
 * dominants, predominants, and unresolved movement. The system always has a
 * *direction*; the exact theory stays deliberately simple.
 */

export interface DegreeWeight {
  readonly degree: number;
  readonly weight: number;
}

/** Base diatonic transition tendencies, keyed by from-degree (1–7). */
const BASE_TRANSITIONS: Record<number, DegreeWeight[]> = {
  1: [
    { degree: 4, weight: 3 },
    { degree: 6, weight: 2.5 },
    { degree: 5, weight: 2 },
    { degree: 2, weight: 1.5 },
    { degree: 3, weight: 1 },
  ],
  2: [
    { degree: 5, weight: 3 },
    { degree: 7, weight: 1.5 },
    { degree: 4, weight: 1.5 },
    { degree: 1, weight: 0.5 },
  ],
  3: [
    { degree: 6, weight: 2.5 },
    { degree: 4, weight: 2 },
    { degree: 1, weight: 1 },
  ],
  4: [
    { degree: 5, weight: 3 },
    { degree: 1, weight: 2 },
    { degree: 2, weight: 1.5 },
    { degree: 7, weight: 1 },
  ],
  5: [
    { degree: 1, weight: 3.5 },
    { degree: 6, weight: 1.5 },
    { degree: 3, weight: 0.5 },
  ],
  6: [
    { degree: 4, weight: 2.5 },
    { degree: 2, weight: 2 },
    { degree: 5, weight: 1.5 },
    { degree: 1, weight: 1 },
  ],
  7: [
    { degree: 1, weight: 3 },
    { degree: 3, weight: 1 },
  ],
};

export interface CandidateContext {
  /** Bias toward dominant/predominant approach chords near a cadence. */
  approachingCadence?: boolean;
}

/** A transition table: from-degree (1–7) → weighted successors. */
export type TransitionTable = Record<number, DegreeWeight[]>;

/** The built-in diatonic transition tendencies (used when no style overrides). */
export const DEFAULT_TRANSITIONS: TransitionTable = BASE_TRANSITIONS;

/**
 * Produce state-modulated successor candidates for a from-degree.
 * Never returns an empty list (falls back to tonic).
 *
 * `baseTable` lets a StylePack supply corpus-derived transitions; any degree
 * missing (or empty) in it falls back to the built-in defaults, so a partial
 * corpus never breaks harmony.
 */
export function harmonicCandidates(
  fromDegree: number,
  state: MusicalState,
  mode: Mode,
  ctx: CandidateContext = {},
  baseTable: TransitionTable = BASE_TRANSITIONS,
): DegreeWeight[] {
  const d = ((fromDegree - 1) % 7 + 7) % 7 + 1;
  const fromTable = baseTable[d];
  const base = fromTable && fromTable.length > 0 ? fromTable : (BASE_TRANSITIONS[d] ?? BASE_TRANSITIONS[1]!);
  const t = state.tension;
  const v = state.valence;
  const instability = state.instability;
  const complexity = state.complexity;

  // First pass: functional/valence modulation.
  const scored = base.map(({ degree, weight }) => {
    const fn = functionOfDegree(degree);
    let w = weight;

    if (fn === "dominant") w *= 0.7 + 1.7 * t;
    else if (fn === "predominant") w *= 0.8 + 0.8 * t;
    else w *= 1.35 - 0.95 * t; // tonic: rarer when tense (cadence avoidance)

    // Avoid the specific V→I / IV→I resolution when tension is high.
    if (degree === 1 && functionOfDegree(d) !== "tonic") {
      w *= Math.max(0.12, 1.2 - t);
    }

    // Valence nudges toward matching chord color.
    const quality = triadQuality(degree, mode);
    if (quality === "major") w *= 0.85 + 0.35 * v;
    else if (quality === "minor" || quality === "diminished") {
      w *= 0.85 + 0.35 * (1 - v);
    }

    // Approaching a cadence: strengthen dominant/predominant approach.
    if (ctx.approachingCadence) {
      if (fn === "dominant") w *= 2.2;
      else if (fn === "predominant") w *= 1.5;
      else w *= 0.5;
    }

    return { degree, weight: Math.max(0, w) };
  });

  // Second pass: instability/complexity flatten the distribution toward uniform,
  // making less-expected moves more likely without going fully random.
  const flatten = Math.min(0.85, 0.55 * instability + 0.4 * complexity);
  if (flatten > 0) {
    const mean =
      scored.reduce((s, c) => s + c.weight, 0) / Math.max(1, scored.length);
    for (const c of scored) {
      (c as { weight: number }).weight =
        c.weight * (1 - flatten) + mean * flatten;
    }
  }

  return scored.filter((c) => c.weight > 0);
}

/** Choose the next degree via the weighted candidates. */
export function chooseNextDegree(
  fromDegree: number,
  state: MusicalState,
  mode: Mode,
  rng: SeededRandom,
  ctx: CandidateContext = {},
  baseTable: TransitionTable = BASE_TRANSITIONS,
): number {
  const candidates = harmonicCandidates(fromDegree, state, mode, ctx, baseTable);
  if (candidates.length === 0) return 1;
  return rng.weighted(
    candidates.map((c) => c.degree),
    candidates.map((c) => c.weight),
  );
}

/**
 * Harmonic rhythm: how many bars the next chord lasts. Calm/simple music holds
 * chords longer; energetic/tense/complex music changes them faster. Clamped to
 * `maxBars` so chords never cross a phrase boundary.
 */
export function chooseChordDurationBars(
  state: MusicalState,
  rng: SeededRandom,
  maxBars: number,
): number {
  if (maxBars <= 1) return 1;
  const pShort = Math.min(
    0.95,
    0.2 + 0.45 * state.energy + 0.4 * state.complexity + 0.25 * state.tension,
  );
  return rng.bool(pShort) ? 1 : 2;
}
