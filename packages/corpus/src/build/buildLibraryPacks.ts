import { SeededRandom, type Mode, type MusicalStatePatch, type StylePack } from "@lime/core";
import { parseScoreFile } from "../score/parseScore.js";
import { detectKey } from "../analysis/keyDetection.js";
import { chordify } from "../analysis/chordify.js";
import { degreeSequence, HarmonyModelBuilder } from "../analysis/harmonyStats.js";
import { MelodyModelBuilder } from "../analysis/melodyStats.js";
import { RhythmModelBuilder } from "../analysis/rhythmStats.js";
import { compileStylePack } from "../style/compileStylePack.js";
import { estimateEmotion } from "../analysis/emotionEstimate.js";
import { segmentScore, type SegmentOptions } from "../analysis/segment.js";
import { genreForPath, type Genre } from "./genreMap.js";
import type { Quadrant } from "./labelLibrary.js";
import type { EmotionAnnotation } from "../ir.js";
import type { MidiFile } from "./walkMidi.js";

/**
 * Build section-aware StylePacks from the labelled ./midi library.
 *
 * Every section of every file is routed to two kinds of bucket: its EMOTION
 * (Russell quadrant, pooled across the whole corpus) and its GENRE. One pass
 * feeds the shared harmony/melody/rhythm model builders per bucket, then each
 * bucket compiles to a StylePack the engine can play — so "calm" or "classical"
 * becomes a corpus-derived musical grammar, not a hand-tuned guess.
 */

/** Russell quadrant → the emotion word used in the pack id. */
const FEEL: Record<Quadrant, string> = { Q1: "happy", Q2: "tense", Q3: "sad", Q4: "calm" };

/** Genres that make a meaningful pack (skip the anonymous `various` dump + tiny `pop`). */
const DEFAULT_GENRES: Genre[] = ["classical", "rock-pop", "screen", "hyperpop", "arabic"];

export interface LibraryPackOptions {
  /** Drop buckets with fewer than this many chord observations. Default 30. */
  readonly minSamples?: number;
  /** Cap sections fed to any one bucket (speed + balance). Default 4000. */
  readonly maxSectionsPerBucket?: number;
  readonly segment?: SegmentOptions;
  readonly phraseLengthBars?: 4 | 8;
  /** Genres to build a pack for. Default: the meaningful ones. */
  readonly genres?: Genre[];
  /** Build the four emotion packs. Default true. */
  readonly buildEmotion?: boolean;
  /** Build per-genre packs. Default true. */
  readonly buildGenre?: boolean;
  /** Seed for the deterministic file shuffle (so caps sample the corpus evenly). */
  readonly seed?: string;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface LibraryPackResult {
  readonly id: string;
  readonly bucket: string;
  readonly kind: "emotion" | "genre";
  readonly sectionCount: number;
  readonly sampleCount: number;
  readonly dominantMode: Mode;
  readonly keyPc: number;
  readonly tempoRange: [number, number];
  readonly emotion: EmotionAnnotation;
  readonly cadenceResolutionRate: number;
  readonly style: StylePack;
  readonly suggestedState?: MusicalStatePatch;
}

/** Per-bucket accumulator of the three corpus models plus aggregates. */
class Bucket {
  readonly harmony = new HarmonyModelBuilder();
  readonly melody = new MelodyModelBuilder();
  readonly rhythm = new RhythmModelBuilder();
  readonly tempos: number[] = [];
  readonly modes = new Map<Mode, number>();
  readonly tonics = new Map<number, number>();
  valSum = 0;
  aroSum = 0;
  sections = 0;

  constructor(
    readonly id: string,
    readonly kind: "emotion" | "genre",
  ) {}
}

export function buildLibraryPacks(
  files: readonly MidiFile[],
  opts: LibraryPackOptions = {},
): LibraryPackResult[] {
  const minSamples = opts.minSamples ?? 30;
  const cap = opts.maxSectionsPerBucket ?? 4000;
  const genres = new Set(opts.genres ?? DEFAULT_GENRES);
  const buildEmotion = opts.buildEmotion ?? true;
  const buildGenre = opts.buildGenre ?? true;

  // Shuffle deterministically so per-bucket caps sample across the whole corpus
  // rather than whatever sorts first alphabetically (one genre per folder).
  const order = shuffled(files, opts.seed ?? "library");

  const buckets = new Map<string, Bucket>();
  const bucketOf = (id: string, kind: "emotion" | "genre") => {
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = new Bucket(id, kind)));
    return b;
  };

  let done = 0;
  for (const f of order) {
    opts.onProgress?.(done++, order.length);
    let score;
    try {
      const genre = genreForPath(f.rel);
      if (genre === "exclude") continue;
      score = parseScoreFile(f.abs, { source: "library", license: "local", genre });
      if (score.notes.length < 8) continue;

      const targets: Bucket[] = [];
      for (const sec of segmentScore(score, opts.segment)) {
        const e = estimateEmotion(sec.score);
        targets.length = 0;
        if (buildEmotion) targets.push(bucketOf(`feel-${FEEL[e.quadrant!]}`, "emotion"));
        if (buildGenre && genres.has(genre)) targets.push(bucketOf(`genre-${genre}`, "genre"));
        if (targets.every((b) => b.sections >= cap)) continue;

        const key = detectKey(sec.score);
        const seq = degreeSequence(chordify(sec.score, { tonicPc: key.tonicPc, mode: key.mode }));
        if (seq.length < 2) continue;

        for (const b of targets) {
          if (b.sections >= cap) continue;
          b.harmony.add(seq);
          b.melody.add(sec.score, { tonicPc: key.tonicPc, mode: key.mode });
          b.rhythm.add(sec.score);
          b.tempos.push(sec.score.tempoBpm);
          b.modes.set(key.mode, (b.modes.get(key.mode) ?? 0) + 1);
          b.tonics.set(key.tonicPc, (b.tonics.get(key.tonicPc) ?? 0) + 1);
          b.valSum += e.valence;
          b.aroSum += e.arousal;
          b.sections++;
        }
      }
    } catch {
      // Corrupt/unreadable file — real corpora contain some.
    }
  }
  opts.onProgress?.(order.length, order.length);

  const results: LibraryPackResult[] = [];
  for (const b of [...buckets.values()].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const model = b.harmony.build();
    if (model.sampleCount < minSamples) continue;

    const dominantMode = mostFrequent(b.modes, "major" as Mode);
    const keyPc = mostFrequent(b.tonics, 0);
    const tempoRange = tempoRangeFrom(b.tempos);
    const emotion: EmotionAnnotation = {
      valence: b.sections ? b.valSum / b.sections : 0,
      arousal: b.sections ? b.aroSum / b.sections : 0,
    };

    const { style, suggestedState } = compileStylePack(model, {
      id: b.id,
      keyPc,
      mode: dominantMode,
      phraseLengthBars: opts.phraseLengthBars ?? 8,
      tempoRange,
      emotion,
      melodyModel: b.melody.build(),
      rhythmModel: b.rhythm.build(),
    });

    results.push({
      id: b.id,
      bucket: b.id,
      kind: b.kind,
      sectionCount: b.sections,
      sampleCount: model.sampleCount,
      dominantMode,
      keyPc,
      tempoRange,
      emotion,
      cadenceResolutionRate: model.cadenceResolutionRate,
      style,
      suggestedState,
    });
  }
  return results;
}

/** Deterministic Fisher–Yates using the seeded RNG, without mutating input. */
function shuffled(files: readonly MidiFile[], seed: string): MidiFile[] {
  const rng = new SeededRandom(seed);
  const out = [...files];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function mostFrequent<T>(counts: Map<T, number>, fallback: T): T {
  let best = fallback;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

function tempoRangeFrom(tempos: number[]): [number, number] {
  if (tempos.length === 0) return [70, 100];
  const sorted = [...tempos].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  let lo = Math.max(60, Math.min(130, Math.round(pick(0.1))));
  const hi = Math.max(60, Math.min(130, Math.round(pick(0.9))));
  return [lo, hi <= lo ? Math.min(130, lo + 10) : hi];
}
