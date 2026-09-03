import type { Meter } from "../time/MusicalTime.js";
import type { MusicalState } from "../state/MusicalState.js";
import type { Mode } from "../harmony/Scale.js";
import type { HarmonicEvent } from "../harmony/Chord.js";
import type { PhraseInfo } from "../phrase/PhrasePlanner.js";
import type { NoteEvent } from "../events/MusicalEvent.js";

/** Everything composed in one bar, with the context that produced it. */
export interface BarCapture {
  readonly bar: number;
  readonly state: MusicalState;
  readonly chord: HarmonicEvent;
  readonly phrase: PhraseInfo;
  readonly events: NoteEvent[];
}

/** A finished stretch of composition, ready for analysis. */
export interface CompositionCapture {
  readonly keyPc: number;
  readonly mode: Mode;
  readonly meter: Meter;
  readonly phraseLengthBars: number;
  readonly bars: BarCapture[];
  /** Chronological motif-use log (base ids), for recurrence analysis. */
  readonly motifUsage: string[];
  readonly motifCount: number;
}

/** A single scored metric. `score` is normalized 0–1 (higher = better). */
export interface Metric {
  readonly score: number;
  readonly value: number;
  readonly detail: string;
}

/** A group of metrics with an aggregate. */
export interface DimensionReport {
  readonly metrics: Record<string, Metric>;
  readonly score: number;
}

/** Full musical evaluation of a composition. */
export interface AnalysisReport {
  readonly harmony: DimensionReport;
  readonly rhythm: DimensionReport;
  readonly melody: DimensionReport;
  readonly responsiveness: DimensionReport;
  /** Weighted overall score, 0–1. */
  readonly overall: number;
  readonly bars: number;
}
