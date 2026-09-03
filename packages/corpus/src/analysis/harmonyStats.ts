import type { ChordWindow } from "./chordify.js";

/** Weighted successor, matching core's `DegreeWeight` shape for StylePack use. */
export interface DegreeWeight {
  readonly degree: number;
  readonly weight: number;
}

/**
 * A harmonic model extracted from a corpus: a weighted transition table plus
 * degree frequencies. The transition table is directly consumable by core's
 * harmony rules (same `DegreeWeight` shape), so a StylePack can be corpus-driven.
 */
export interface HarmonyModel {
  /** from-degree (1–7) → weighted successors (self-transitions excluded). */
  readonly transitions: Record<number, DegreeWeight[]>;
  /** Relative frequency of each degree (index 1–7; 0 unused). */
  readonly degreeFrequency: number[];
  /** How often a phrase-final chord resolves to the tonic. */
  readonly cadenceResolutionRate: number;
  /** Number of chord observations that fed the model. */
  readonly sampleCount: number;
}

/** Collapse a window sequence into consecutive distinct degrees (drops rests). */
export function degreeSequence(windows: ChordWindow[]): number[] {
  const seq: number[] = [];
  for (const w of windows) {
    if (w.degree === null) continue;
    if (seq.length === 0 || seq[seq.length - 1] !== w.degree) seq.push(w.degree);
  }
  return seq;
}

/** Accumulate transition/frequency counts across many degree sequences. */
export class HarmonyModelBuilder {
  private readonly counts: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  private readonly freq = new Array<number>(8).fill(0);
  private cadences = 0;
  private cadenceResolved = 0;
  private samples = 0;

  /** Add one piece's degree sequence. Treats the final chord as a cadence. */
  add(seq: number[]): void {
    for (const d of seq) {
      if (d >= 1 && d <= 7) this.freq[d]!++;
    }
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1]!;
      const b = seq[i]!;
      if (a >= 1 && a <= 7 && b >= 1 && b <= 7) this.counts[a]![b]!++;
    }
    if (seq.length > 0) {
      this.cadences++;
      if (seq[seq.length - 1] === 1) this.cadenceResolved++;
    }
    this.samples += seq.length;
  }

  build(): HarmonyModel {
    const transitions: Record<number, DegreeWeight[]> = {};
    for (let from = 1; from <= 7; from++) {
      const row: DegreeWeight[] = [];
      for (let to = 1; to <= 7; to++) {
        const c = this.counts[from]![to]!;
        if (c > 0) row.push({ degree: to, weight: c });
      }
      row.sort((a, b) => b.weight - a.weight);
      transitions[from] = row;
    }
    const freqTotal = this.freq.reduce((s, x) => s + x, 0) || 1;
    const degreeFrequency = this.freq.map((c) => c / freqTotal);
    return {
      transitions,
      degreeFrequency,
      cadenceResolutionRate: this.cadences > 0 ? this.cadenceResolved / this.cadences : 0,
      sampleCount: this.samples,
    };
  }
}
