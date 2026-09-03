import type { Mode, MusicalStatePatch, StylePack } from "@lime/core";
import { parseScoreFile } from "../score/parseScore.js";
import { detectKey } from "../analysis/keyDetection.js";
import { chordify } from "../analysis/chordify.js";
import { degreeSequence, HarmonyModelBuilder } from "../analysis/harmonyStats.js";
import { MelodyModelBuilder } from "../analysis/melodyStats.js";
import { RhythmModelBuilder } from "../analysis/rhythmStats.js";
import { compileStylePack } from "../style/compileStylePack.js";
import type { EmotionAnnotation } from "../ir.js";
import type { TaggedFile } from "../datasets/index.js";

export interface BuildOptions {
  /** Prefix for compiled StylePack ids, e.g. dataset id. */
  readonly idPrefix: string;
  readonly phraseLengthBars?: 4 | 8;
  /** Skip buckets with fewer than this many chord observations. Default 30. */
  readonly minSamples?: number;
}

export interface BucketResult {
  readonly id: string;
  readonly bucket: string;
  readonly fileCount: number;
  readonly parsedCount: number;
  readonly sampleCount: number;
  readonly dominantMode: Mode;
  readonly keyPc: number;
  readonly tempoRange: [number, number];
  readonly emotion?: EmotionAnnotation;
  readonly cadenceResolutionRate: number;
  readonly style: StylePack;
  readonly suggestedState?: MusicalStatePatch;
}

/** Group files by bucket and compile one StylePack per bucket. */
export function buildStylePacks(files: TaggedFile[], opts: BuildOptions): BucketResult[] {
  const minSamples = opts.minSamples ?? 30;
  const byBucket = new Map<string, TaggedFile[]>();
  for (const f of files) {
    const list = byBucket.get(f.bucket) ?? [];
    list.push(f);
    byBucket.set(f.bucket, list);
  }

  const results: BucketResult[] = [];
  for (const [bucket, bucketFiles] of [...byBucket.entries()].sort()) {
    const builder = new HarmonyModelBuilder();
    const melodyBuilder = new MelodyModelBuilder();
    const rhythmBuilder = new RhythmModelBuilder();
    const tempos: number[] = [];
    const modeCounts = new Map<Mode, number>();
    const tonicCounts = new Map<number, number>();
    const valences: number[] = [];
    const arousals: number[] = [];
    let parsed = 0;

    for (const f of bucketFiles) {
      try {
        const score = parseScoreFile(f.path, { source: opts.idPrefix, license: "nc" });
        if (score.notes.length < 8) continue;
        const key = detectKey(score);
        const seq = degreeSequence(chordify(score, { tonicPc: key.tonicPc, mode: key.mode }));
        if (seq.length < 2) continue;
        builder.add(seq);
        melodyBuilder.add(score, { tonicPc: key.tonicPc, mode: key.mode });
        rhythmBuilder.add(score);
        tempos.push(score.tempoBpm);
        modeCounts.set(key.mode, (modeCounts.get(key.mode) ?? 0) + 1);
        tonicCounts.set(key.tonicPc, (tonicCounts.get(key.tonicPc) ?? 0) + 1);
        if (f.emotion) {
          valences.push(f.emotion.valence);
          arousals.push(f.emotion.arousal);
        }
        parsed++;
      } catch {
        // Skip unreadable/corrupt files; real corpora contain some.
      }
    }

    const model = builder.build();
    if (model.sampleCount < minSamples) continue;

    const dominantMode = mostFrequent(modeCounts, "major");
    const keyPc = mostFrequent(tonicCounts, 0);
    const tempoRange = tempoRangeFrom(tempos);
    const emotion = valences.length > 0
      ? { valence: mean(valences), arousal: mean(arousals) }
      : undefined;

    const { style, suggestedState } = compileStylePack(model, {
      id: `${opts.idPrefix}-${bucket}`,
      keyPc,
      mode: dominantMode,
      phraseLengthBars: opts.phraseLengthBars ?? 8,
      tempoRange,
      emotion,
      melodyModel: melodyBuilder.build(),
      rhythmModel: rhythmBuilder.build(),
    });

    results.push({
      id: style.id,
      bucket,
      fileCount: bucketFiles.length,
      parsedCount: parsed,
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

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Robust tempo range (10th–90th percentile), clamped to LIME's 60–130. */
function tempoRangeFrom(tempos: number[]): [number, number] {
  if (tempos.length === 0) return [70, 100];
  const sorted = [...tempos].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  let lo = Math.max(60, Math.min(130, Math.round(pick(0.1))));
  let hi = Math.max(60, Math.min(130, Math.round(pick(0.9))));
  if (hi <= lo) hi = Math.min(130, lo + 10);
  return [lo, hi];
}
