import type { StylePack } from "@lime/core";

/**
 * ambient-minimal — the single built-in style for v0.1.
 *
 * A dark-but-warm modal world (A dorian), long phrases, slow tempo range, soft
 * sine pads, and gentle reverb. Tuned to sound coherent for many minutes while
 * musical state moves between calm and danger.
 */
export const ambientMinimal: StylePack = {
  id: "ambient-minimal",
  modes: ["dorian", "naturalMinor", "major", "mixolydian"],
  defaultMode: "dorian",
  keyPc: 9, // A
  phraseLengthBars: 8,
  tempoRange: [60, 100],
  instrumentation: {
    reverbWet: 0.42,
    reverbDecay: 6,
    delayWet: 0.14,
    percussionGain: 0.55,
    pad: {
      oscillator: "sine",
      attack: 1.4,
      decay: 1.0,
      sustain: 0.75,
      release: 3.2,
      filterCutoff: 2200,
      gain: 0.42,
    },
    bass: {
      oscillator: "triangle",
      attack: 0.03,
      decay: 0.3,
      sustain: 0.6,
      release: 0.6,
      filterCutoff: 700,
      gain: 0.5,
    },
    melody: {
      oscillator: "triangle",
      attack: 0.06,
      decay: 0.4,
      sustain: 0.45,
      release: 0.9,
      filterCutoff: 3200,
      gain: 0.4,
    },
  },
};
