/**
 * Deterministic pseudo-random number generator.
 *
 * LIME must be fully reproducible: given the same seed and the same sequence of
 * musical decisions, the symbolic output is identical. Composition code MUST use
 * this class and never `Math.random()`.
 *
 * Hierarchical streams: {@link SeededRandom.derive} produces an independent child
 * stream keyed by a name, so changing (for example) percussion logic does not
 * disturb the harmony stream. See the RNG architecture note in the handoff.
 */

/** cyrb128 string hash → four 32-bit seed words. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** sfc32 PRNG — fast, high-quality, fully deterministic. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function next(): number {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  /** Canonical seed key; child streams append to it deterministically. */
  readonly seedKey: string;
  private readonly _next: () => number;

  constructor(seed: string | number) {
    this.seedKey = typeof seed === "number" ? `n:${seed}` : seed;
    const [a, b, c, d] = cyrb128(this.seedKey);
    this._next = sfc32(a, b, c, d);
    // Discard a few outputs so closely-related seed keys diverge quickly.
    for (let i = 0; i < 8; i++) this._next();
  }

  /** Next float in [0, 1). */
  next(): number {
    return this._next();
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this._next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this._next() * (max - min + 1));
  }

  /** True with probability `p` (default 0.5). */
  bool(p = 0.5): boolean {
    return this._next() < p;
  }

  /** Uniformly pick one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("SeededRandom.pick: empty array");
    return items[Math.floor(this._next() * items.length)] as T;
  }

  /**
   * Weighted pick. `weights[i]` is the relative weight of `items[i]`.
   * Non-positive total weight falls back to a uniform pick.
   */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) throw new Error("SeededRandom.weighted: empty array");
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return this.pick(items);
    let r = this._next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Approximate standard-normal sample (Box–Muller), mean 0, stddev 1. */
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this._next();
    while (v === 0) v = this._next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Derive an independent child stream keyed by `name`. Deterministic:
   * the same parent seed and name always yield the same child sequence.
   */
  derive(name: string): SeededRandom {
    return new SeededRandom(`${this.seedKey}/${name}`);
  }
}
