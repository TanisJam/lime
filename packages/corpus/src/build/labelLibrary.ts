import { estimateEmotion, emotionFeatures } from "../analysis/emotionEstimate.js";
import { segmentScore, type SegmentOptions } from "../analysis/segment.js";
import { parseScoreFile } from "../score/parseScore.js";
import { genreForPath, type Genre } from "./genreMap.js";

/**
 * Library labelling — turn one MIDI file into a genre + per-section emotion
 * record, and summarise a batch. This is the classified library: every file
 * with its genre and its sections' feelings, both the deliverable and the QA
 * surface before any StylePack is built.
 */

export type Quadrant = "Q1" | "Q2" | "Q3" | "Q4";

export interface SectionLabel {
  readonly index: number;
  readonly startBar: number;
  readonly barCount: number;
  readonly noteCount: number;
  readonly quadrant: Quadrant;
  readonly valence: number;
  readonly arousal: number;
}

export interface LibraryEntry {
  /** Path relative to the midi root. */
  readonly path: string;
  readonly genre: Genre;
  readonly noteCount: number;
  readonly tempoBpm: number;
  /** Whole-file estimate (a coarse summary; sections carry the detail). */
  readonly fileQuadrant: Quadrant;
  readonly valence: number;
  readonly arousal: number;
  readonly sections: SectionLabel[];
}

export interface LabelOptions extends SegmentOptions {
  /** Skip files with more notes than this (pathological / Black-MIDI safety). */
  readonly maxNotes?: number;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Label one file. Returns `null` when the file is excluded by genre, unparseable,
 * empty, or pathologically large — a skip, not an error.
 */
export function labelFile(
  absPath: string,
  relPath: string,
  opts: LabelOptions = {},
): LibraryEntry | null {
  const genre = genreForPath(relPath);
  if (genre === "exclude") return null;

  let score;
  try {
    score = parseScoreFile(absPath, { source: "library", license: "local", genre });
  } catch {
    return null;
  }
  const noteCount = score.notes.length;
  if (noteCount < 8) return null;
  if (noteCount > (opts.maxNotes ?? 40_000)) return null;

  const file = estimateEmotion(score);
  const sections: SectionLabel[] = segmentScore(score, opts).map((sec) => {
    const e = estimateEmotion(sec.score);
    return {
      index: sec.index,
      startBar: sec.startBar,
      barCount: sec.barCount,
      noteCount: sec.score.notes.length,
      quadrant: e.quadrant!,
      valence: round(e.valence),
      arousal: round(e.arousal),
    };
  });

  return {
    path: relPath,
    genre,
    noteCount,
    tempoBpm: Math.round(emotionFeatures(score).tempoBpm),
    fileQuadrant: file.quadrant!,
    valence: round(file.valence),
    arousal: round(file.arousal),
    sections,
  };
}

export interface LibrarySummary {
  readonly fileCount: number;
  readonly sectionCount: number;
  readonly byGenre: Record<string, number>;
  readonly byQuadrant: Record<Quadrant, number>;
  /** Section counts per genre × quadrant. */
  readonly genreQuadrant: Record<string, Record<Quadrant, number>>;
}

const QUADS: Quadrant[] = ["Q1", "Q2", "Q3", "Q4"];

/** Aggregate a batch of entries into distribution counts. */
export function summarize(entries: readonly LibraryEntry[]): LibrarySummary {
  const byGenre: Record<string, number> = {};
  const byQuadrant: Record<Quadrant, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  const genreQuadrant: Record<string, Record<Quadrant, number>> = {};
  let sectionCount = 0;

  for (const e of entries) {
    byGenre[e.genre] = (byGenre[e.genre] ?? 0) + 1;
    genreQuadrant[e.genre] ??= { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    for (const s of e.sections) {
      sectionCount++;
      byQuadrant[s.quadrant]++;
      genreQuadrant[e.genre]![s.quadrant]++;
    }
  }

  return { fileCount: entries.length, sectionCount, byGenre, byQuadrant, genreQuadrant };
}

export { QUADS };
