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
    percussionGain: 0.5,
    stereoWidth: 1,
    masterGain: 0.9,
    percussionReverbSend: 0.2,
    pad: {
      oscillator: "sine",
      attack: 1.4,
      decay: 1.0,
      sustain: 0.7,
      release: 3.2,
      filterCutoff: 2200,
      gain: 0.4,
      pan: 0,
      reverbSend: 0.9,
    },
    bass: {
      oscillator: "triangle",
      attack: 0.03,
      decay: 0.3,
      sustain: 0.6,
      release: 0.6,
      filterCutoff: 600,
      gain: 0.34,
      pan: 0,
      reverbSend: 0.12,
    },
    melody: {
      // A soft felt-piano character via the renderer's FM melody instrument;
      // a short-ish attack keeps notes intimate and percussive rather than pad-like.
      oscillator: "triangle",
      attack: 0.02,
      decay: 0.5,
      sustain: 0.25,
      release: 1.1,
      filterCutoff: 3000,
      gain: 0.38,
      pan: 0.22,
      reverbSend: 0.55,
      delaySend: 0.45,
    },
  },
};
