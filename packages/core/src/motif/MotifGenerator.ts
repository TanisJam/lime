import type { SeededRandom } from "../random/SeededRandom.js";
import { Durations, type MusicalDuration } from "../time/MusicalTime.js";
import type { MelodyStyle } from "../style/StylePack.js";
import type { Motif } from "./Motif.js";

/** The shape a motif's pitch contour traces from start to end. */
export type Contour = "rising" | "falling" | "arch" | "valley" | "static";

const CONTOURS: readonly Contour[] = ["rising", "falling", "arch", "valley", "static"];

/**
 * Target diatonic offset for note `i` of `n` under a contour, scaled to `peak`.
 * `t` runs 0→1 across the motif; the shapes are a line up, a line down, an
 * up-then-down arch, a down-then-up valley, and a held static line.
 */
function contourTarget(contour: Contour, i: number, n: number, peak: number): number {
  const t = n > 1 ? i / (n - 1) : 0;
  switch (contour) {
    case "rising":
      return peak * t;
    case "falling":
      return -peak * t;
    case "arch":
      return peak * Math.sin(Math.PI * t);
    case "valley":
      return -peak * Math.sin(Math.PI * t);
    case "static":
      return 0;
  }
}

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
    const contour = this.rng.pick(CONTOURS);

    const intervals = this.buildContour(noteCount, contour, complexity);
    const rhythm = this.buildRhythm(noteCount, complexity);

    return { id, intervals, rhythm };
  }

  /**
   * Diatonic step offsets shaped toward an intentional contour and held within
   * a limited range. Rather than a free random walk, each note biases toward a
   * per-position target envelope, so the motif has a recognizable shape (a rise,
   * a fall, an arch, a valley, or a held static line) instead of wandering.
   */
  private buildContour(noteCount: number, contour: Contour, complexity: number): number[] {
    const steps = this.steps ?? (complexity > 0.5 ? [-3, -2, -1, 1, 2, 3, 4] : [-2, -1, 1, 2, 3]);
    const stepWeights =
      this.stepWeights ?? (complexity > 0.5 ? [1, 2, 3, 3, 2, 1.5, 1] : [1, 3, 3, 2, 1]);
    // Peak amplitude of the shape: a 3rd to a 6th, wider with complexity.
    const peak = 2 + Math.round(complexity * 3);

    const intervals: number[] = [0];
    let cur = 0;
    for (let i = 1; i < noteCount; i++) {
      const target = contourTarget(contour, i, noteCount, peak);
      const step = this.pickStepToward(steps, stepWeights, target - cur);
      cur += step;
      intervals.push(cur);
    }
    return intervals;
  }

  /**
   * Pick a vocabulary step, biased toward `want` (the signed distance still to
   * travel to the contour target). The base weights are preserved — so a corpus
   * interval vocabulary keeps its character — and only re-weighted by direction,
   * which leaves a single-sign vocabulary (e.g. only +2) untouched.
   */
  private pickStepToward(steps: number[], weights: number[], want: number): number {
    const dir = Math.sign(want);
    if (dir === 0) return this.rng.weighted(steps, weights);
    const biased = steps.map((s, i) => {
      const w = weights[i]!;
      // Favor steps that move toward the target; mildly damp those going away.
      return Math.sign(s) === dir ? w * 2.2 : w * 0.5;
    });
    return this.rng.weighted(steps, biased);
  }

  /**
   * A short rhythmic cell (one or two durations) tiled across the motif, so the
   * motif carries a recognizable rhythmic identity that survives transposition
   * and return — instead of every note drawing an unrelated duration.
   */
  private buildRhythm(noteCount: number, complexity: number): MusicalDuration[] {
    const cellLen = noteCount >= 4 && this.rng.bool(0.6) ? 2 : 1;
    const cell: MusicalDuration[] = [];
    for (let i = 0; i < cellLen; i++) cell.push(this.pickDuration(complexity));
    const rhythm: MusicalDuration[] = [];
    for (let i = 0; i < noteCount; i++) rhythm.push(cell[i % cellLen]!);
    return rhythm;
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
