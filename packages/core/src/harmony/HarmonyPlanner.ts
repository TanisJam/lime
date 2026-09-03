import type { MusicalState } from "../state/MusicalState.js";
import type { SeededRandom } from "../random/SeededRandom.js";
import { PhrasePlanner } from "../phrase/PhrasePlanner.js";
import type { Mode } from "./Scale.js";
import { type HarmonicEvent, makeHarmonicEvent } from "./Chord.js";
import {
  type TransitionTable,
  DEFAULT_TRANSITIONS,
  chooseChordDurationBars,
  chooseNextDegree,
} from "./HarmonyRules.js";

export interface HarmonyPlannerOptions {
  rng: SeededRandom;
  phrasePlanner: PhrasePlanner;
  keyPc?: number;
  mode?: Mode;
  /** Optional corpus-derived transition table; defaults to the built-in rules. */
  transitions?: TransitionTable;
}

/**
 * Plans an infinite deterministic chord stream, always at least one phrase ahead
 * of the playhead.
 *
 * Because chords are planned ahead and then frozen, a later state change only
 * affects *unplanned* future bars — the already-committed resolution still
 * plays. That is the "musical inertia" the handoff asks for. Cadence phrases
 * always resolve toward tonic (deceptive to vi when tension is high).
 */
export class HarmonyPlanner {
  private readonly rng: SeededRandom;
  private readonly phrases: PhrasePlanner;
  private readonly planned: HarmonicEvent[] = [];
  private readonly transitions: TransitionTable;
  /** Next bar that has not yet been planned (always phrase-aligned). */
  private plannedThroughBar = 0;
  private currentDegree = 1;

  readonly keyPc: number;
  readonly mode: Mode;

  constructor(options: HarmonyPlannerOptions) {
    this.rng = options.rng;
    this.phrases = options.phrasePlanner;
    this.keyPc = options.keyPc ?? 0;
    this.mode = options.mode ?? "major";
    this.transitions = options.transitions ?? DEFAULT_TRANSITIONS;
  }

  /** Ensure chords are planned through (and including) `bar`. Idempotent. */
  ensurePlannedThrough(bar: number, state: MusicalState): void {
    while (this.plannedThroughBar <= bar) {
      this.planNextPhrase(state);
    }
  }

  /** The chord covering an absolute bar. Returns undefined if not yet planned. */
  chordAt(bar: number): HarmonicEvent | undefined {
    // Binary search over contiguous, sorted, non-overlapping chords.
    let lo = 0;
    let hi = this.planned.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = this.planned[mid]!;
      if (bar < c.bar) hi = mid - 1;
      else if (bar >= c.bar + c.durationBars) lo = mid + 1;
      else return c;
    }
    return undefined;
  }

  /**
   * The next `count` distinct chords starting at or after `fromBar`.
   * Plans ahead as needed using `state`.
   */
  upcoming(fromBar: number, count: number, state: MusicalState): HarmonicEvent[] {
    const out: HarmonicEvent[] = [];
    let bar = fromBar;
    while (out.length < count) {
      this.ensurePlannedThrough(bar, state);
      const chord = this.chordAt(bar);
      if (!chord) break;
      out.push(chord);
      bar = chord.bar + chord.durationBars;
    }
    return out;
  }

  /** How many bars have been planned so far (for horizon assertions/tests). */
  get plannedBars(): number {
    return this.plannedThroughBar;
  }

  private push(bar: number, durationBars: number, degree: number): void {
    this.planned.push(
      makeHarmonicEvent({
        bar,
        durationBars,
        degree,
        keyPc: this.keyPc,
        mode: this.mode,
      }),
    );
    this.currentDegree = degree;
  }

  private planNextPhrase(state: MusicalState): void {
    const start = this.plannedThroughBar;
    const phrase = this.phrases.at(start);
    const len = phrase.lengthBars;
    const isCadence = phrase.isCadencePhrase;

    let bar = start;
    let remaining = len;

    // Very first chord ever: anchor on the tonic so the piece begins home.
    if (this.planned.length === 0) {
      const dur = chooseChordDurationBars(state, this.rng, remaining);
      this.push(bar, dur, 1);
      bar += dur;
      remaining -= dur;
    }

    while (remaining > 0) {
      if (isCadence && remaining === 1) {
        // Final bar of a cadence phrase: resolve. Deceptive (vi) when tense.
        const deg = state.tension > 0.75 && this.rng.bool(0.4) ? 6 : 1;
        this.push(bar, 1, deg);
        bar += 1;
        remaining -= 1;
        continue;
      }

      const approachingCadence = isCadence && remaining <= 2;
      const deg = chooseNextDegree(
        this.currentDegree,
        state,
        this.mode,
        this.rng,
        { approachingCadence },
        this.transitions,
      );
      // Reserve the final bar for resolution in cadence phrases.
      const maxDur = isCadence ? remaining - 1 : remaining;
      const dur = chooseChordDurationBars(state, this.rng, Math.max(1, maxDur));
      const clamped = Math.min(dur, Math.max(1, maxDur));
      this.push(bar, clamped, deg);
      bar += clamped;
      remaining -= clamped;
    }

    this.plannedThroughBar = start + len;
  }
}
