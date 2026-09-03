import {
  type MusicalState,
  type MusicalStatePatch,
  applyPatch,
  lerpState,
  normalizeState,
} from "./MusicalState.js";

interface PendingChange {
  target: MusicalState;
  applyAtBar: number;
  durationBars: number;
}

interface ActiveTransition {
  from: MusicalState;
  to: MusicalState;
  startBar: number;
  durationBars: number;
}

/**
 * Holds the composer's `current` state and its `target`, and moves current
 * toward target at bar boundaries.
 *
 * - `setState` (durationBars = 0) → gradual asymptotic easing toward target.
 * - `transitionTo` (durationBars > 0) → precise linear ramp, then easing.
 *
 * Requested changes are queued with an `applyAtBar` so quantization ("nextBar",
 * "nextPhrase", …) is honored: the target does not change until that bar.
 * Because generators sample `currentState` per bar, this is where musical
 * inertia at the parameter level lives.
 */
export class StateManager {
  private current: MusicalState;
  private target: MusicalState;
  private active: ActiveTransition | null = null;
  private readonly pending: PendingChange[] = [];

  /** Fraction of the remaining gap closed each bar when easing (0–1). */
  readonly easingPerBar: number;

  constructor(initial: MusicalState, easingPerBar = 0.25) {
    this.current = normalizeState(initial);
    this.target = this.current;
    this.easingPerBar = easingPerBar;
  }

  get currentState(): MusicalState {
    return this.current;
  }

  get targetState(): MusicalState {
    return this.target;
  }

  /** Base target that later patches accumulate onto (latest queued or target). */
  private latestTarget(): MusicalState {
    const last = this.pending[this.pending.length - 1];
    return last ? last.target : this.target;
  }

  /**
   * Queue a state change to begin at `applyAtBar`. `durationBars = 0` uses
   * easing; a positive value uses a linear ramp of that length.
   */
  request(
    patch: MusicalStatePatch,
    applyAtBar: number,
    durationBars = 0,
  ): void {
    const merged = applyPatch(this.latestTarget(), patch);
    this.pending.push({ target: merged, applyAtBar, durationBars });
    this.pending.sort((a, b) => a.applyAtBar - b.applyAtBar);
  }

  /**
   * Advance the model to an absolute bar. Must be called once per bar in order.
   */
  advanceToBar(bar: number): void {
    // Apply any queued changes now due.
    while (this.pending.length > 0 && this.pending[0]!.applyAtBar <= bar) {
      const due = this.pending.shift()!;
      this.target = due.target;
      this.active =
        due.durationBars > 0
          ? {
              from: this.current,
              to: due.target,
              startBar: bar,
              durationBars: due.durationBars,
            }
          : null;
    }

    if (this.active) {
      const t = (bar - this.active.startBar) / this.active.durationBars;
      if (t >= 1) {
        this.current = this.active.to;
        this.active = null;
      } else {
        this.current = lerpState(this.active.from, this.active.to, Math.max(0, t));
      }
    } else {
      this.current = lerpState(this.current, this.target, this.easingPerBar);
    }
  }
}
