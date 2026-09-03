import * as Tone from "tone";
import type { SynthVoiceConfig, PercussionSound, VoiceId } from "@lime/core";
import { PERCUSSION_MIDI } from "@lime/core";
import { linToDb, type InstrumentFactory } from "./instruments.js";

/**
 * Rock instrument palette — the first genre-specific timbre set (GENRES.md §5,
 * §7). Where the default palette is warm ambient synthesis, this is gritty:
 * distorted guitars, a punchy electric bass, and a hard-hitting kit. Still pure
 * synthesis (no assets) — an evocative "sounds like rock", the stepping stone
 * before sampled instruments.
 *
 * Selected per-genre by the host (the demo maps a rock StylePack to this set);
 * `@lime/core` stays timbre-agnostic.
 */

const midiNote = (pitch: number): string => Tone.Frequency(pitch, "midi").toNote();

/** Lead / melody — a bright, driven electric-guitar-ish saw through distortion. */
export const rockGuitarFactory: InstrumentFactory = (config) => {
  const gain = config?.gain ?? 0.32;
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.004, decay: 0.2, sustain: 0.65, release: 0.25 },
    volume: linToDb(gain),
  });
  const dist = new Tone.Distortion({ distortion: 0.55, wet: 0.9 });
  const hp = new Tone.Filter({ frequency: 140, type: "highpass" });
  const lp = new Tone.Filter({ frequency: 3600, type: "lowpass", rolloff: -24 });
  const output = new Tone.Gain(1);
  synth.chain(dist, hp, lp, output);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      synth.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.5 + velocity * 0.5);
    },
    setBrightness(v) {
      const c = Math.max(0, Math.min(1, v));
      lp.frequency.rampTo(2000 + c * 3200, 0.3);
    },
    dispose() {
      for (const n of [synth, dist, hp, lp, output]) n.dispose();
    },
  };
};

/** Harmonic bed — sustained overdriven rhythm guitar (power-chord body). */
export const rockRhythmFactory: InstrumentFactory = (config) => {
  const gain = config?.gain ?? 0.26;
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.75, release: 0.5 },
    volume: linToDb(gain),
  });
  const dist = new Tone.Distortion({ distortion: 0.38, wet: 0.85 });
  const hp = new Tone.Filter({ frequency: 150, type: "highpass" });
  const lp = new Tone.Filter({ frequency: 3000, type: "lowpass", rolloff: -24 });
  const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.3, wet: 0.2 }).start();
  const output = new Tone.Gain(1);
  synth.chain(dist, hp, lp, chorus, output);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      synth.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.4 + velocity * 0.5);
    },
    setBrightness(v) {
      const c = Math.max(0, Math.min(1, v));
      lp.frequency.rampTo(1800 + c * 2600, 0.3);
    },
    dispose() {
      for (const n of [synth, dist, hp, lp, chorus, output]) n.dispose();
    },
  };
};

/** Electric bass — picked saw with a touch of grit, tight and mid-forward. */
export const rockBassFactory: InstrumentFactory = (config) => {
  const gain = config?.gain ?? 0.5;
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.008, decay: 0.22, sustain: 0.7, release: 0.2 },
    volume: linToDb(gain),
  });
  const dist = new Tone.Distortion({ distortion: 0.18, wet: 0.6 });
  const lp = new Tone.Filter({ frequency: 2200, type: "lowpass", rolloff: -24, Q: 0.6 });
  const output = new Tone.Gain(1);
  synth.chain(dist, lp, output);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      synth.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.55 + velocity * 0.45);
    },
    setBrightness(v) {
      const c = Math.max(0, Math.min(1, v));
      lp.frequency.rampTo(1600 + c * 1400, 0.3);
    },
    dispose() {
      for (const n of [synth, dist, lp, output]) n.dispose();
    },
  };
};

const MIDI_TO_PERC = new Map<number, PercussionSound>(
  (Object.entries(PERCUSSION_MIDI) as [PercussionSound, number][]).map(([s, m]) => [m, s]),
);

/** Rock kit — harder kick, cracking snare, bright hats. Punchier than the ambient kit. */
export const rockKitFactory: InstrumentFactory = () => {
  const output = new Tone.Gain(1);

  const kick = new Tone.MembraneSynth({
    octaves: 4,
    pitchDecay: 0.03,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.4 },
    volume: linToDb(1.0),
  });
  kick.connect(output);

  // Snare: filtered noise body + a short tonal "crack".
  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
    volume: linToDb(0.7),
  });
  const snareBody = new Tone.Filter({ frequency: 1900, type: "bandpass", Q: 0.6 });
  snare.chain(snareBody, output);

  const hat = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
    volume: linToDb(0.5),
  });
  const hatFilter = new Tone.Filter({ frequency: 7000, type: "highpass" });
  hat.chain(hatFilter, output);

  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      const sound = MIDI_TO_PERC.get(pitch) ?? "hat";
      switch (sound) {
        case "kick":
          kick.triggerAttackRelease("C1", Math.max(durationSec, 0.12), timeSec, velocity);
          break;
        case "snare":
        case "tom":
          snare.triggerAttackRelease(Math.min(Math.max(durationSec, 0.12), 0.24), timeSec, velocity);
          break;
        default:
          hat.triggerAttackRelease(Math.min(durationSec, 0.06), timeSec, velocity * 0.85);
          break;
      }
    },
    dispose() {
      for (const n of [kick, snare, snareBody, hat, hatFilter, output]) n.dispose();
    },
  };
};

/** The rock palette, keyed by voice — pass to `createToneRenderer({ instruments })`. */
export const ROCK_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  pad: rockRhythmFactory,
  bass: rockBassFactory,
  melody: rockGuitarFactory,
  percussion: rockKitFactory,
};
