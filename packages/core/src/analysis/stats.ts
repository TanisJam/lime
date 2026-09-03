/** Small statistics helpers used by the analyzer. All pure. */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Pearson correlation coefficient. Returns 0 when undefined (no variance). */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] as number) - mx;
    const b = (ys[i] as number) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/** Shannon entropy (base 2) of a count distribution, in bits. */
export function entropyBits(counts: number[]): number {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Linear map from [inMin,inMax] to [0,1], clamped. */
export function ramp(v: number, inMin: number, inMax: number): number {
  if (inMax === inMin) return 0;
  return clamp01((v - inMin) / (inMax - inMin));
}

/**
 * Triangular "sweet-spot" score: 1 at `ideal`, falling to 0 at `lo`/`hi`.
 * Rewards values in a healthy middle band and penalizes extremes.
 */
export function sweetSpot(v: number, lo: number, ideal: number, hi: number): number {
  if (v <= lo || v >= hi) return 0;
  if (v === ideal) return 1;
  return v < ideal
    ? clamp01((v - lo) / (ideal - lo))
    : clamp01((hi - v) / (hi - ideal));
}
