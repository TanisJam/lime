import type { CorpusScore } from "../ir.js";

const GRID = 16; // sixteenth-note positions per 4/4 bar

/**
 * Rhythmic statistics extracted from a corpus: a per-position onset profile (a
 * groove template over a 16-step bar), average density, and syncopation. Feeds
 * the percussion generator so generated grooves follow the corpus.
 */
export interface RhythmModel {
  /** Onset likelihood at each of 16 sixteenth positions, normalized to max 1. */
  readonly onsetProfile: number[];
  readonly avgOnsetsPerBar: number;
  /** Fraction of onsets that fall off the beat (syncopation). */
  readonly syncopation: number;
  readonly sampleCount: number;
}

/** Accumulates a {@link RhythmModel} across many scores. */
export class RhythmModelBuilder {
  private readonly profile = new Array<number>(GRID).fill(0);
  private totalOnsets = 0;
  private offBeatOnsets = 0;
  private bars = 0;

  add(score: CorpusScore): void {
    const beatTicks = (score.ppq * 4) / score.timeSignature.denominator;
    const barTicks = beatTicks * score.timeSignature.numerator;
    const cell = barTicks / GRID;
    if (cell <= 0) return;

    // Collapse simultaneous onsets to one rhythmic event.
    const onsets = new Set<number>();
    for (const n of score.notes) onsets.add(n.start);

    let maxOnset = 0;
    for (const t of onsets) {
      const posInBar = ((t % barTicks) + barTicks) % barTicks;
      const idx = Math.round(posInBar / cell) % GRID;
      this.profile[idx]!++;
      this.totalOnsets++;
      if (idx % 4 !== 0) this.offBeatOnsets++;
      maxOnset = Math.max(maxOnset, t);
    }
    this.bars += Math.max(1, Math.ceil((maxOnset + 1) / barTicks));
  }

  build(): RhythmModel {
    const max = Math.max(1, ...this.profile);
    return {
      onsetProfile: this.profile.map((c) => c / max),
      avgOnsetsPerBar: this.bars > 0 ? this.totalOnsets / this.bars : 0,
      syncopation: this.totalOnsets > 0 ? this.offBeatOnsets / this.totalOnsets : 0,
      sampleCount: this.totalOnsets,
    };
  }
}
