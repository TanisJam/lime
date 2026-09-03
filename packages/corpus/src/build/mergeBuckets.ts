import type { TaggedFile } from "../datasets/index.js";

/** Russell quadrant → a human-readable emotion label. */
export const QUADRANT_LABEL: Record<string, string> = {
  Q1: "happy",
  Q2: "tense",
  Q3: "sad",
  Q4: "calm",
};

export function relabelBucket(bucket: string): string {
  return QUADRANT_LABEL[bucket] ?? bucket;
}

export interface DatasetFiles {
  readonly dataset: string;
  readonly files: TaggedFile[];
}

export interface MergePlan {
  /** All emotion-labeled files across datasets, buckets relabeled semantically. */
  readonly emotion: TaggedFile[];
  /** Non-emotion datasets kept as their own pools. */
  readonly nonEmotion: DatasetFiles[];
}

/**
 * Plan a cross-dataset merge: emotion-labeled files (EMOPIA, VGMIDI, …) are
 * pooled by emotion quadrant — relabeled to happy/tense/sad/calm — so the same
 * emotion from different datasets becomes one StylePack. Datasets without
 * emotion labels (Lakh, classical MusicXML) stay separate.
 */
export function planMerge(perDataset: DatasetFiles[]): MergePlan {
  const emotion: TaggedFile[] = [];
  const nonEmotion: DatasetFiles[] = [];
  for (const { dataset, files } of perDataset) {
    const emo = files
      .filter((f) => f.emotion)
      .map((f) => ({ ...f, bucket: relabelBucket(f.bucket) }));
    const non = files.filter((f) => !f.emotion);
    emotion.push(...emo);
    if (non.length > 0) nonEmotion.push({ dataset, files: non });
  }
  return { emotion, nonEmotion };
}
