import {
  type MusicalState,
  type MusicalStatePatch,
  applyPatch,
  lerpState,
  normalizeState,
} from "./MusicalState.js";

interface PendingChange {
  /** The raw patch as requested, kept (alongside `target`) so an `urgent`
   * rollback can replay not-yet-applied requests in original order onto a
   * new bar instead of only inheriting their already-merged `target`. */
  patch: MusicalStatePatch;
  target: MusicalState;
  applyAtBar: number;
  durationBars: number;
  /** Monotonic request order, for replaying changes across a checkpoint
   * restore in the order the caller actually issued them (see
   * `StateManager.seq` / `LimeEngine`'s `urgent` rollback). */
  seq: number;
}

/**
 * One `request()` call, recorded so an `urgent` rollback can replay it even
 * if it has *already* been applied (shifted out of `pending` by
 * `advanceToBar`) by the time the rollback happens — a checkpoint's own
 * `pending` only holds requests still waiting, not ones a bar inside the
 * rolled-back window already consumed. See {@link StateManager.requestsSince}.
 */
export interface RequestLogEntry {
  readonly patch: MusicalStatePatch;
  /** The bar originally requested (before any `urgent` re-anchoring). */
  readonly applyAtBar: number;
  readonly durationBars: number;
  readonly seq: number;
}

interface ActiveTransition {
  from: MusicalState;
  to: MusicalState;
  startBar: number;
  durationBars: number;
}

/**
 * A point-in-time capture of {@link StateManager}'s mutable state, restorable
 * via {@link StateManager.restore}. Used by the engine's composition
 * checkpoints (see `LimeEngine`'s `urgent` state-change rollback). `MusicalState`
 * values are treated as immutable (always replaced, never mutated in place), so
 * only the containers (`pending`, `active`) need copying. `seq` is the request
 * counter's value at capture time, so a caller can tell which requests (see
 * {@link StateManager.requestsSince}) were issued after this checkpoint was
 * taken — whether or not they have since been applied.
 */
export interface StateManagerSnapshot {
  readonly current: MusicalState;
  readonly target: MusicalState;
  readonly active: ActiveTransition | null;
  readonly pending: readonly PendingChange[];
  readonly seq: number;
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
  /**
   * Monotonic counter stamped onto every `request()` call, in call order.
   * Deliberately never rewound by `restore()` — it has to stay globally
   * increasing across any number of rollbacks so a `seq` value recorded in a
   * checkpoint (or the log below) always means the same point in history.
   */
  private seq = 0;
  /**
   * Every `request()` call ever made, oldest first, independent of
   * `pending`/`current` — so a request already applied by the time an
   * `urgent` rollback happens can still be replayed (see `requestsSince`).
   * Bounded: `LimeEngine` prunes it alongside its composition checkpoints,
   * since nothing older than the oldest held checkpoint's `seq` can ever be
   * needed again.
   */
  private readonly log: RequestLogEntry[] = [];

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
   * easing; a positive value uses a linear ramp of that length. Logged (see
   * `requestsSince`), so a future `urgent` rollback can replay it even after
   * it has been applied.
   */
  request(
    patch: MusicalStatePatch,
    applyAtBar: number,
    durationBars = 0,
  ): void {
    this.enqueue(patch, applyAtBar, durationBars, /* log */ true);
  }

  /**
   * Re-queue a request that is already recorded in the log, without logging
   * it again. Used only by an `urgent` rollback (see `LimeEngine.applyUrgent`)
   * to replay carried-over requests — logging the replay too would mean a
   * later rollback could replay the same original intent twice.
   */
  replay(patch: MusicalStatePatch, applyAtBar: number, durationBars: number): void {
    this.enqueue(patch, applyAtBar, durationBars, /* log */ false);
  }

  private enqueue(
    patch: MusicalStatePatch,
    applyAtBar: number,
    durationBars: number,
    log: boolean,
  ): void {
    const merged = applyPatch(this.latestTarget(), patch);
    this.seq += 1;
    const clonedPatch = { ...patch };
    this.pending.push({ patch: clonedPatch, target: merged, applyAtBar, durationBars, seq: this.seq });
    // Stable sort (guaranteed by the spec): entries that tie on `applyAtBar`
    // — e.g. every request an `urgent` rollback collapses onto the same
    // target bar — keep their request order, so `advanceToBar` still applies
    // them oldest-first and ends on the most recently requested one.
    this.pending.sort((a, b) => a.applyAtBar - b.applyAtBar);
    if (log) this.log.push({ patch: clonedPatch, applyAtBar, durationBars, seq: this.seq });
  }

  /**
   * Discard every queued-but-not-yet-applied change, without touching
   * `current`/`target`/`active`. Used by an `urgent` rollback right before
   * replaying the surviving requests (see `LimeEngine.applyUrgent`) onto the
   * new target bar via `replay()`.
   */
  clearPending(): void {
    this.pending.length = 0;
  }

  /** Every logged request issued after `seq` (see `StateManagerSnapshot.seq`), oldest first. */
  requestsSince(seq: number): readonly RequestLogEntry[] {
    return this.log.filter((entry) => entry.seq > seq);
  }

  /**
   * Drop logged requests at or before `seq` — nothing behind the oldest
   * composition checkpoint the engine still holds can ever be replayed
   * again. Keeps the log bounded alongside `LimeEngine`'s checkpoint window.
   */
  pruneLogBefore(seq: number): void {
    while (this.log.length > 0 && this.log[0]!.seq <= seq) this.log.shift();
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

  /** Capture the current state for a later {@link restore}. Read-only. */
  snapshot(): StateManagerSnapshot {
    return {
      current: this.current,
      target: this.target,
      active: this.active ? { ...this.active } : null,
      pending: this.pending.map((p) => ({ ...p })),
      seq: this.seq,
    };
  }

  /**
   * Restore a state captured by {@link snapshot}. Deliberately leaves `seq`
   * (and the request log) alone: rewinding the counter would let a later
   * request reuse a `seq` value the log already used for an earlier one,
   * breaking `requestsSince`'s "after this point" comparisons.
   */
  restore(snapshot: StateManagerSnapshot): void {
    this.current = snapshot.current;
    this.target = snapshot.target;
    this.active = snapshot.active ? { ...snapshot.active } : null;
    this.pending.length = 0;
    this.pending.push(...snapshot.pending.map((p) => ({ ...p })));
  }
}
