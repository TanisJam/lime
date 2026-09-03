import type { Mode } from "@lime/core";

/**
 * Corpus intermediate representation (IR).
 *
 * A normalized, source-agnostic view of a score/MIDI file. Parsers (MIDI,
 * MusicXML) produce IR; extractors read it. Times are in the source's ticks;
 * `ppq` lets consumers convert to beats/bars.
 */

export interface CorpusNote {
  /** Onset, in source ticks. */
  readonly start: number;
  /** Duration, in source ticks. */
  readonly duration: number;
  /** MIDI pitch 0–127. */
  readonly pitch: number;
  /** Velocity 0–1 (normalized from 0–127). */
  readonly velocity: number;
  /** Source track index. */
  readonly track: number;
  /** General MIDI program (instrument) for the track, if known. */
  readonly program?: number;
  /** True if the track is a percussion channel (MIDI channel 10). */
  readonly isPercussion?: boolean;
}

/** Emotion annotation. Either a Russell 4-quadrant label or raw valence/arousal. */
export interface EmotionAnnotation {
  /** -1..1 (negative → positive). */
  readonly valence: number;
  /** -1..1 (calm → intense). */
  readonly arousal: number;
  /** Optional discrete quadrant label (Q1..Q4). */
  readonly quadrant?: "Q1" | "Q2" | "Q3" | "Q4";
}

export interface CorpusMeta {
  /** Dataset/source id, e.g. "emopia", "openscore". */
  readonly source: string;
  readonly license: string;
  readonly genre?: string;
  readonly emotion?: EmotionAnnotation;
  /** Estimated or provided key. */
  readonly key?: { tonicPc: number; mode: Mode };
  readonly title?: string;
}

export interface CorpusScore {
  readonly id: string;
  /** Ticks per quarter note of the source. */
  readonly ppq: number;
  /** Representative tempo (first tempo event or default 120). */
  readonly tempoBpm: number;
  /** Time signature numerator/denominator (first event or 4/4). */
  readonly timeSignature: { numerator: number; denominator: number };
  readonly notes: CorpusNote[];
  readonly meta: CorpusMeta;
}

/** Total sounding duration of a score, in ticks. */
export function scoreDurationTicks(score: CorpusScore): number {
  let end = 0;
  for (const n of score.notes) end = Math.max(end, n.start + n.duration);
  return end;
}
