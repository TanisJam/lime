import type { CorpusScore } from "../ir.js";
import { scoreDurationTicks } from "../ir.js";

/**
 * Section segmentation — split a score into fixed-length windows so emotion can
 * be read per tramo rather than averaged over a whole piece.
 *
 * A whole symphony movement averages its many moods into mush (and saturates
 * arousal); a section captures that the music travels from serene to furious.
 * v0.3 uses fixed bar windows — robust and deterministic; novelty-based
 * boundaries are a later refinement. Each section's notes are rebased to start
 * at tick 0 and clipped to the window, so the slice reads as a self-contained
 * score (its density/duration reflect the section, not the source).
 */

export interface Section {
  readonly index: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly startBar: number;
  readonly barCount: number;
  /** A self-contained score for the window (notes rebased to tick 0). */
  readonly score: CorpusScore;
}

export interface SegmentOptions {
  /** Window length in bars. Default 8. */
  readonly barsPerSection?: number;
  /** Sections with fewer notes than this are dropped as too sparse. Default 12. */
  readonly minNotes?: number;
}

export function segmentScore(score: CorpusScore, opts: SegmentOptions = {}): Section[] {
  const barsPerSection = opts.barsPerSection ?? 8;
  const minNotes = opts.minNotes ?? 12;

  const beatTicks = (score.ppq * 4) / score.timeSignature.denominator;
  const barTicks = beatTicks * score.timeSignature.numerator;
  if (barTicks <= 0) return [];
  const secTicks = barTicks * barsPerSection;

  const total = scoreDurationTicks(score);
  const windows = Math.max(1, Math.ceil(total / secTicks));

  const out: Section[] = [];
  for (let s = 0; s < windows; s++) {
    const secStart = s * secTicks;
    const secEnd = secStart + secTicks;
    const notes = [];
    for (const n of score.notes) {
      if (n.start < secStart || n.start >= secEnd) continue;
      notes.push({ ...n, start: n.start - secStart, duration: Math.min(n.duration, secEnd - n.start) });
    }
    if (notes.length < minNotes) continue;
    out.push({
      index: out.length,
      startTick: secStart,
      endTick: secEnd,
      startBar: s * barsPerSection,
      barCount: barsPerSection,
      score: { ...score, id: `${score.id}#${s}`, notes },
    });
  }

  // Never return nothing for a score that clearly has material: fall back to one
  // whole-piece section (short pieces, or every window below the note floor).
  if (out.length === 0 && score.notes.length > 0) {
    out.push({
      index: 0,
      startTick: 0,
      endTick: total,
      startBar: 0,
      barCount: Math.max(1, Math.ceil(total / barTicks)),
      score,
    });
  }
  return out;
}
