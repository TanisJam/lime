import { type Meter, ticksPerBar } from "../time/MusicalTime.js";

export interface CompositionSchedulerOptions {
  readonly meter: Meter;
  /** Bars kept composed ahead of the playhead. */
  readonly lookAheadBars: number;
  /** Current transport position, in ticks. */
  readonly now: () => number;
  /** Compose (and schedule) a single bar. Called once per bar, in order. */
  readonly composeBar: (bar: number) => void;
}

/**
 * Keeps a moving composition horizon ahead of the playhead.
 *
 *   PLAYHEAD
 *      ↓
 *   ████████|████████████░░░░░░░░
 *    played    scheduled    unknown
 *
 * `pump()` composes forward until `lookAheadBars` beyond the current bar are
 * ready. It never regenerates a bar: `composedThroughBar` only moves forward, so
 * committed material stays frozen.
 */
export class CompositionScheduler {
  private readonly opts: CompositionSchedulerOptions;
  private _composedThroughBar = 0;

  constructor(opts: CompositionSchedulerOptions) {
    this.opts = opts;
  }

  /** Exclusive frontier: the next bar that still needs composing. */
  get composedThroughBar(): number {
    return this._composedThroughBar;
  }

  /** Bar the playhead is currently in. */
  currentBar(): number {
    return Math.floor(this.opts.now() / ticksPerBar(this.opts.meter));
  }

  /** Compose forward to maintain the look-ahead horizon. Idempotent per bar. */
  pump(): void {
    const target = this.currentBar() + this.opts.lookAheadBars;
    while (this._composedThroughBar <= target) {
      this.opts.composeBar(this._composedThroughBar);
      this._composedThroughBar++;
    }
  }

  /** Compose forward through an explicit bar (used headless / in tests). */
  composeThrough(bar: number): void {
    while (this._composedThroughBar <= bar) {
      this.opts.composeBar(this._composedThroughBar);
      this._composedThroughBar++;
    }
  }

  reset(): void {
    this._composedThroughBar = 0;
  }
}
