import type {
  InstrumentationConfig,
  Mode,
  MusicalStatePatch,
  StylePack,
  TransitionTable,
} from "@lime/core";
import type { HarmonyModel } from "../analysis/harmonyStats.js";
import type { MelodyModel } from "../analysis/melodyStats.js";
import type { RhythmModel } from "../analysis/rhythmStats.js";
import type { EmotionAnnotation } from "../ir.js";
import { emotionToState } from "./emotionMapping.js";

/** A neutral instrumentation, used unless the caller supplies one. */
export const DEFAULT_INSTRUMENTATION: InstrumentationConfig = {
  reverbWet: 0.35,
  reverbDecay: 4,
  delayWet: 0.1,
  percussionGain: 0.55,
  pad: { oscillator: "sine", attack: 1.2, decay: 1, sustain: 0.7, release: 2.5, filterCutoff: 2400, gain: 0.42 },
  bass: { oscillator: "triangle", attack: 0.03, decay: 0.3, sustain: 0.6, release: 0.5, filterCutoff: 800, gain: 0.5 },
  melody: { oscillator: "triangle", attack: 0.05, decay: 0.35, sustain: 0.5, release: 0.8, filterCutoff: 3000, gain: 0.4 },
};

export interface CompileStylePackOptions {
  readonly id: string;
  readonly keyPc?: number;
  readonly mode?: Mode;
  readonly phraseLengthBars?: 4 | 8;
  readonly tempoRange?: readonly [number, number];
  readonly instrumentation?: InstrumentationConfig;
  readonly emotion?: EmotionAnnotation;
  /** Target per-row max weight, so state modulation stays balanced. Default 4. */
  readonly weightScale?: number;
  /** Corpus melody model → StylePack.melody. */
  readonly melodyModel?: MelodyModel;
  /** Corpus rhythm model → StylePack.rhythm. */
  readonly rhythmModel?: RhythmModel;
}

export interface CompiledStyle {
  readonly style: StylePack;
  /** Suggested initial state derived from the emotion (if any). */
  readonly suggestedState?: MusicalStatePatch;
}

/**
 * Compile a corpus {@link HarmonyModel} (+ optional emotion) into a LIME
 * {@link StylePack} whose harmony is corpus-driven. Only derived statistics are
 * carried — never the source material.
 */
export function compileStylePack(
  model: HarmonyModel,
  options: CompileStylePackOptions,
): CompiledStyle {
  const tempoRange = options.tempoRange ?? [70, 100];
  const transitions = normalizeTransitions(model.transitions, options.weightScale ?? 4);

  const style: StylePack = {
    id: options.id,
    modes: ["major", "naturalMinor", "dorian", "mixolydian"],
    defaultMode: options.mode ?? "major",
    keyPc: options.keyPc ?? 0,
    phraseLengthBars: options.phraseLengthBars ?? 8,
    tempoRange: [tempoRange[0], tempoRange[1]],
    instrumentation: options.instrumentation ?? DEFAULT_INSTRUMENTATION,
    harmony: { transitions },
    melody: options.melodyModel
      ? {
          intervalWeights: options.melodyModel.intervalWeights,
          durationWeights: options.melodyModel.durationWeights,
        }
      : undefined,
    rhythm: options.rhythmModel ? { onsetProfile: options.rhythmModel.onsetProfile } : undefined,
  };

  const suggestedState = options.emotion
    ? emotionToState(options.emotion, style.tempoRange)
    : undefined;

  return { style, suggestedState };
}

/** Rescale each from-row so its max weight equals `target` (ratios preserved). */
function normalizeTransitions(table: TransitionTable, target: number): TransitionTable {
  const out: TransitionTable = {};
  for (let from = 1; from <= 7; from++) {
    const row = table[from] ?? [];
    const max = row.reduce((m, t) => Math.max(m, t.weight), 0);
    out[from] = max > 0 ? row.map((t) => ({ degree: t.degree, weight: (t.weight / max) * target })) : [];
  }
  return out;
}
