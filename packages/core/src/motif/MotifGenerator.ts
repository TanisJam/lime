import type { SeededRandom } from "../random/SeededRandom.js";
import { Durations, type MusicalDuration } from "../time/MusicalTime.js";
import type { MelodyStyle } from "../style/StylePack.js";
import type { Motif } from "./Motif.js";

/**
 * Creates fresh motifs from a small grammar. Deterministic given the RNG stream.
 *
 * Contours favor small diatonic steps (singable, coherent) with occasional
 * leaps. Rhythms are drawn from a compact vocabulary. `complexity` widens both.
 *
 * When a corpus-derived {@link MelodyStyle} is supplied, its interval and
 * duration distributions replace the built-in vocabularies, so generated motifs
 * take on the corpus's melodic character. Missing pieces fall back to defaults.
 */
export class MotifGenerator {
  private counter = 0;
  private readonly steps: number[] | null;
  private readonly stepWeights: number[] | null;
  private readonly durPool: MusicalDuration[] | null;
  private readonly durWeights: number[] | null;

  constructor(
    private readonly rng: SeededRandom,
    melody?: MelodyStyle,
  ) {
    const iv = melody?.intervalWeights;
    if (iv && Object.keys(iv).length > 0) {
      const entries = Object.entries(iv)
        .map(([k, w]) => [Number(k), w] as const)
        .filter(([k, w]) => k !== 0 && w > 0);
      this.steps = entries.map(([k]) => k);
      this.stepWeights = entries.map(([, w]) => w);
    } else {
      this.steps = null;
      this.stepWeights = null;
    }

    const dw = melody?.durationWeights;
    if (dw && Object.keys(dw).length > 0) {
      const pool: MusicalDuration[] = [];
      const weights: number[] = [];
      for (const [name, w] of Object.entries(dw)) {
        const ticks = (Durations as Record<string, number>)[name];
        if (ticks !== undefined && w > 0) {
          pool.push(ticks);
          weights.push(w);
        }
      }
      this.durPool = pool.length > 0 ? pool : null;
      this.durWeights = pool.length > 0 ? weights : null;
    } else {
      this.durPool = null;
      this.durWeights = null;
    }
  }

  create(complexity: number): Motif {
    const id = `m${this.counter++}`;
    const noteCount = this.rng.int(3, complexity > 0.6 ? 6 : 4);

    const steps = this.steps ?? (complexity > 0.5 ? [-3, -2, -1, 1, 2, 3, 4] : [-2, -1, 1, 2, 3]);
    const stepWeights = this.stepWeights ?? (complexity > 0.5 ? [1, 2, 3, 3, 2, 1.5, 1] : [1, 3, 3, 2, 1]);

    const intervals: number[] = [0];
    let cur = 0;
    for (let i = 1; i < noteCount; i++) {
      const step = this.rng.weighted(steps, stepWeights);
      cur += step;
      // Keep the contour within a reasonable range.
      if (cur > 6) cur = 6;
      if (cur < -5) cur = -5;
      intervals.push(cur);
    }

    const rhythm: MusicalDuration[] = intervals.map(() => this.pickDuration(complexity));

    return { id, intervals, rhythm };
  }

  private pickDuration(complexity: number): MusicalDuration {
    if (this.durPool && this.durWeights) {
      return this.rng.weighted(this.durPool, this.durWeights);
    }
    const pool =
      complexity > 0.5
        ? [Durations.eighth, Durations.quarter, Durations.dottedEighth, Durations.sixteenth]
        : [Durations.quarter, Durations.eighth, Durations.half];
    const weights = complexity > 0.5 ? [3, 2, 1.5, 1] : [3, 2, 1];
    return this.rng.weighted(pool, weights);
  }
}
