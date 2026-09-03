import type { Mode } from "@lime/core";
import type { CorpusScore } from "../ir.js";
import { scoreDurationTicks } from "../ir.js";
import type { EmotionAnnotation } from "../ir.js";
import { detectKeyDetailed, pitchClassProfile } from "./keyDetection.js";

/**
 * Analytic emotion labelling — estimate a Russell valence/arousal position (and
 * its quadrant) from the music alone, with no human annotation.
 *
 * The two axes read from cheap, robust musical cues:
 *
 *  - AROUSAL (calm ↔ intense): tempo, note density (onsets per second), and
 *    average velocity. Fast, dense, loud → aroused.
 *  - VALENCE (dark ↔ bright): mode is the strongest cheap cue (major → positive,
 *    minor → negative), tinted by register height and how firmly the key is
 *    established.
 *
 * This is deliberately a *bias*, not a perfect per-file classifier: aggregated
 * over hundreds of files per bucket the noise averages out, and it is calibrated
 * against EMOPIA's human quadrant labels (see emotionEstimate.test.ts) so the
 * signal is known to be real before it labels an unlabelled corpus. Works on a
 * whole score or on a section slice — same shape in, same estimate out.
 */

/** Raw perceptual features behind an estimate — surfaced for the manifest/QA. */
export interface EmotionFeatures {
  readonly tempoBpm: number;
  readonly notesPerSecond: number;
  readonly avgVelocity: number;
  readonly avgPitch: number;
  readonly mode: Mode;
  readonly keyConfidence: number;
  /** Signed major−minor correlation at the tonic (>0 brighter). */
  readonly majorMinorMargin: number;
  /** Third/sixth colour, −1 (minor/dark) .. +1 (major/bright). */
  readonly thirdColor: number;
  readonly noteCount: number;
}

// --- Tunable constants (calibrated on EMOPIA) --------------------------------
// Centres and spreads that map a raw feature onto a −1..1 contribution.
const TEMPO_CENTER = 110; // bpm that reads as neutral arousal
const TEMPO_SPREAD = 55;
const DENSITY_CENTER = 7; // onsets/sec that reads as neutral arousal
const DENSITY_SPREAD = 6;
const VELOCITY_CENTER = 0.62;
const VELOCITY_SPREAD = 0.28;
const PITCH_CENTER = 62; // ~D4, neutral brightness
const PITCH_SPREAD = 20;

const AROUSAL_WEIGHTS = { tempo: 0.42, density: 0.45, velocity: 0.13 };
// Valence now reads graded colour, not a binary mode flip: the major−minor
// correlation margin and the actual third/sixth colour carry most of it, with
// register as a gentle tint.
const VALENCE_WEIGHTS = { margin: 0.45, third: 0.45, pitch: 0.1 };
const MARGIN_SPREAD = 0.32; // maps the correlation margin onto −1..1

function clampUnit(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

/**
 * Third/sixth colour at the tonic: how much major-third/-sixth weight the piece
 * carries versus minor. Catches minor colour inside a "major-key" detection.
 */
function thirdColorAt(hist: number[], tonicPc: number): number {
  const w = (semis: number) => hist[(((tonicPc + semis) % 12) + 12) % 12]!;
  const maj3 = w(4);
  const min3 = w(3);
  const maj6 = w(9);
  const min6 = w(8);
  const num = 2 * (maj3 - min3) + (maj6 - min6);
  const den = 2 * (maj3 + min3) + (maj6 + min6);
  return den > 0 ? clampUnit(num / den) : 0;
}

/** Extract the raw features an emotion estimate reads from. */
export function emotionFeatures(score: CorpusScore): EmotionFeatures {
  const pitched = score.notes.filter((n) => !n.isPercussion);
  const noteCount = score.notes.length;

  let velSum = 0;
  for (const n of score.notes) velSum += n.velocity;
  const avgVelocity = noteCount > 0 ? velSum / noteCount : 0;

  let pitchSum = 0;
  for (const n of pitched) pitchSum += n.pitch;
  const avgPitch = pitched.length > 0 ? pitchSum / pitched.length : PITCH_CENTER;

  const ticks = scoreDurationTicks(score);
  const quarters = score.ppq > 0 ? ticks / score.ppq : 0;
  const seconds = quarters * (60 / (score.tempoBpm > 0 ? score.tempoBpm : 120));
  const notesPerSecond = seconds > 0 ? noteCount / seconds : 0;

  const key = detectKeyDetailed(score);
  const thirdColor = thirdColorAt(pitchClassProfile(score), key.tonicPc);

  return {
    tempoBpm: score.tempoBpm,
    notesPerSecond,
    avgVelocity,
    avgPitch,
    mode: key.mode,
    keyConfidence: key.confidence,
    majorMinorMargin: key.majorCorr - key.minorCorr,
    thirdColor,
    noteCount,
  };
}

/** Estimate valence/arousal (each −1..1) and quadrant from a score or section. */
export function estimateEmotion(score: CorpusScore): EmotionAnnotation {
  const f = emotionFeatures(score);
  if (f.noteCount === 0) return { valence: 0, arousal: 0, quadrant: "Q4" };

  // Arousal: tempo + density + loudness, each centred and normalised.
  const aTempo = clampUnit((f.tempoBpm - TEMPO_CENTER) / TEMPO_SPREAD);
  const aDensity = clampUnit((f.notesPerSecond - DENSITY_CENTER) / DENSITY_SPREAD);
  const aVel = clampUnit((f.avgVelocity - VELOCITY_CENTER) / VELOCITY_SPREAD);
  const arousal = clampUnit(
    AROUSAL_WEIGHTS.tempo * aTempo +
      AROUSAL_WEIGHTS.density * aDensity +
      AROUSAL_WEIGHTS.velocity * aVel,
  );

  // Valence: graded colour, not a binary mode flip. The major−minor correlation
  // margin and the actual third/sixth colour do the heavy lifting; register
  // gives a gentle bright/dark tint.
  const vMargin = clampUnit(f.majorMinorMargin / MARGIN_SPREAD);
  const vThird = f.thirdColor;
  const vPitch = clampUnit((f.avgPitch - PITCH_CENTER) / PITCH_SPREAD);
  const valence = clampUnit(
    VALENCE_WEIGHTS.margin * vMargin +
      VALENCE_WEIGHTS.third * vThird +
      VALENCE_WEIGHTS.pitch * vPitch,
  );

  return { valence, arousal, quadrant: quadrantOf(valence, arousal) };
}

/** Russell quadrant from signed valence/arousal (matches emotionMapping). */
export function quadrantOf(valence: number, arousal: number): "Q1" | "Q2" | "Q3" | "Q4" {
  if (arousal >= 0) return valence >= 0 ? "Q1" : "Q2";
  return valence >= 0 ? "Q4" : "Q3";
}
