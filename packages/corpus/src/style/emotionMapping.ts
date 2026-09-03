import type { MusicalStatePatch } from "@lime/core";
import type { EmotionAnnotation } from "../ir.js";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Map a dataset emotion annotation (Russell valence/arousal, each −1..1) to a
 * LIME musical-state patch.
 *
 * valence → LIME valence/brightness; arousal → energy/density/complexity;
 * the tense corner (high arousal + negative valence) raises tension/instability.
 * If `tempoRange` is given, tempo is placed within it by arousal.
 */
export function emotionToState(
  emotion: EmotionAnnotation,
  tempoRange?: readonly [number, number],
): MusicalStatePatch {
  const valence = clamp01((emotion.valence + 1) / 2);
  const arousal = clamp01((emotion.arousal + 1) / 2);
  const negativity = 1 - valence;

  const patch: MusicalStatePatch = {
    energy: clamp01(0.1 + 0.8 * arousal),
    valence,
    brightness: clamp01(0.25 + 0.6 * valence),
    density: clamp01(0.2 + 0.6 * arousal),
    complexity: clamp01(0.2 + 0.5 * arousal),
    tension: clamp01(0.55 * arousal + 0.5 * negativity),
    instability: clamp01(0.15 + 0.6 * arousal * negativity),
  };

  if (tempoRange) {
    patch.tempo = tempoRange[0] + (tempoRange[1] - tempoRange[0]) * arousal;
  }
  return patch;
}

/** Russell 4-quadrant label → representative valence/arousal. */
export function quadrantToEmotion(quadrant: "Q1" | "Q2" | "Q3" | "Q4"): EmotionAnnotation {
  switch (quadrant) {
    case "Q1": // high arousal, positive (happy/excited)
      return { valence: 0.6, arousal: 0.6, quadrant };
    case "Q2": // high arousal, negative (tense/angry)
      return { valence: -0.6, arousal: 0.6, quadrant };
    case "Q3": // low arousal, negative (sad/depressed)
      return { valence: -0.6, arousal: -0.6, quadrant };
    case "Q4": // low arousal, positive (calm/serene)
      return { valence: 0.6, arousal: -0.6, quadrant };
  }
}
