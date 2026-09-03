import * as Tone from "tone";
import type { VoiceId } from "@lime/core";
import { linToDb, type InstrumentFactory } from "./instruments.js";
import { guitarVoice, rockBassFactory, rockKitFactory } from "./rockPalette.js";

/**
 * Genre timbre palettes beyond rock — the synth "sounds like the genre" layer,
 * mapped per genre by the host. Still pure synthesis (samples are a later,
 * unified pass); each aims to be evocative of its genre.
 */

const midiNote = (p: number): string => Tone.Frequency(p, "midi").toNote();

// --- Metal: heavier gain, tighter cab, reuses the rock rhythm section ---------

export const metalLeadFactory: InstrumentFactory = (config) =>
  guitarVoice({
    gain: config?.gain ?? 0.3,
    distortion: 0.86,
    chebyshev: 8,
    cabHz: 6000,
    attack: 0.003,
    sustain: 0.55,
    release: 0.2,
  });

export const metalRhythmFactory: InstrumentFactory = (config) =>
  guitarVoice({
    gain: config?.gain ?? 0.26,
    distortion: 0.82,
    chebyshev: 6,
    cabHz: 5600,
    attack: 0.006,
    sustain: 0.72,
    release: 0.35,
  });

export const METAL_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  pad: metalRhythmFactory,
  bass: rockBassFactory,
  melody: metalLeadFactory,
  percussion: rockKitFactory,
};

// --- Pop: clean, bright, produced ---------------------------------------------

/** A clean bright synth voice (triangle + light chorus), for pop lead/pad. */
function cleanSynth(opts: { gain: number; wave: "triangle" | "sawtooth"; cutoff: number; attack: number; sustain: number; release: number; wet: number }) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: `fat${opts.wave}` as "fattriangle" | "fatsawtooth", spread: 12, count: 2 },
    envelope: { attack: opts.attack, decay: 0.3, sustain: opts.sustain, release: opts.release },
    volume: linToDb(opts.gain),
  });
  const filter = new Tone.Filter({ frequency: opts.cutoff, type: "lowpass", rolloff: -12, Q: 0.4 });
  const chorus = new Tone.Chorus({ frequency: 0.7, delayTime: 3.5, depth: 0.3, wet: opts.wet }).start();
  const output = new Tone.Gain(1);
  synth.chain(filter, chorus, output);
  return {
    output,
    triggerNote(pitch: number, velocity: number, timeSec: number, durationSec: number) {
      synth.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.4 + velocity * 0.5);
    },
    setBrightness(v: number) {
      const c = Math.max(0, Math.min(1, v));
      filter.frequency.rampTo(opts.cutoff - 1500 + c * 3000, 0.3);
    },
    dispose() {
      for (const n of [synth, filter, chorus, output]) n.dispose();
    },
  };
}

export const popLeadFactory: InstrumentFactory = (config) =>
  cleanSynth({ gain: config?.gain ?? 0.3, wave: "triangle", cutoff: 4200, attack: 0.006, sustain: 0.5, release: 0.4, wet: 0.25 });

export const popPadFactory: InstrumentFactory = (config) =>
  cleanSynth({ gain: config?.gain ?? 0.24, wave: "sawtooth", cutoff: 2600, attack: 0.02, sustain: 0.75, release: 0.8, wet: 0.35 });

/** Rounded synth bass for pop — sawtooth with a low cutoff, no grit. */
export const popBassFactory: InstrumentFactory = (config) => {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.2 },
    volume: linToDb(config?.gain ?? 0.48),
  });
  const filter = new Tone.Filter({ frequency: 1200, type: "lowpass", rolloff: -24, Q: 0.5 });
  const output = new Tone.Gain(1);
  synth.chain(filter, output);
  return {
    output,
    triggerNote(pitch: number, velocity: number, timeSec: number, durationSec: number) {
      synth.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.5 + velocity * 0.45);
    },
    setBrightness(v: number) {
      const c = Math.max(0, Math.min(1, v));
      filter.frequency.rampTo(900 + c * 1200, 0.3);
    },
    dispose() {
      for (const n of [synth, filter, output]) n.dispose();
    },
  };
};

export const POP_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: popLeadFactory,
  pad: popPadFactory,
  bass: popBassFactory,
  percussion: rockKitFactory,
};

// --- Shared voices for the remaining genres -----------------------------------

/** Deep sub-bass (sine + a little triangle body) for 808/electronic/hip-hop. */
export const subBassFactory: InstrumentFactory = (config) => {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.01, decay: 0.4, sustain: 0.8, release: 0.5 },
    volume: linToDb(config?.gain ?? 0.55),
  });
  const filter = new Tone.Filter({ frequency: 700, type: "lowpass", rolloff: -24 });
  const output = new Tone.Gain(1);
  synth.chain(filter, output);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      synth.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.6 + velocity * 0.4);
    },
    setBrightness(v) {
      filter.frequency.rampTo(500 + Math.max(0, Math.min(1, v)) * 700, 0.3);
    },
    dispose() {
      for (const n of [synth, filter, output]) n.dispose();
    },
  };
};

const warmLead: InstrumentFactory = (c) => cleanSynth({ gain: c?.gain ?? 0.3, wave: "triangle", cutoff: 3400, attack: 0.01, sustain: 0.6, release: 0.5, wet: 0.3 });
const warmPad: InstrumentFactory = (c) => cleanSynth({ gain: c?.gain ?? 0.24, wave: "sawtooth", cutoff: 2400, attack: 0.05, sustain: 0.8, release: 1.2, wet: 0.4 });
const brightLead: InstrumentFactory = (c) => cleanSynth({ gain: c?.gain ?? 0.3, wave: "sawtooth", cutoff: 4600, attack: 0.004, sustain: 0.5, release: 0.3, wet: 0.2 });
const bluesGuitar: InstrumentFactory = (c) => guitarVoice({ gain: c?.gain ?? 0.3, distortion: 0.3, chebyshev: 3, cabHz: 5200, attack: 0.005, sustain: 0.6, release: 0.4 });

/** Jazz — warm electric-piano-ish keys, rounded bass, brushed kit. */
export const JAZZ_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: warmLead, pad: warmPad, bass: popBassFactory, percussion: rockKitFactory,
};
/** Blues — lightly overdriven guitar over a shuffle kit. */
export const BLUES_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: bluesGuitar, pad: bluesGuitar, bass: rockBassFactory, percussion: rockKitFactory,
};
/** Hip-hop — synth keys, deep sub, boom-bap kit. */
export const HIPHOP_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: warmLead, pad: warmPad, bass: subBassFactory, percussion: rockKitFactory,
};
/** Electrónica — bright saws, sub bass, four-on-floor kit. */
export const ELECTRONIC_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: brightLead, pad: warmPad, bass: subBassFactory, percussion: rockKitFactory,
};
/** Folk — soft clean voices, no kit. */
export const FOLK_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: warmLead, pad: warmPad, bass: popBassFactory,
};
/** Latin — bright piano-ish keys, rounded bass, clave kit. */
export const LATIN_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: brightLead, pad: warmPad, bass: popBassFactory, percussion: rockKitFactory,
};
/** Funk — bright clav-ish lead, punchy bass, funk kit. */
export const FUNK_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: brightLead, pad: warmPad, bass: popBassFactory, percussion: rockKitFactory,
};
/** Clásica — warm string-ish ensemble, soft bass, no kit. */
export const CLASSICAL_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: warmLead, pad: warmPad, bass: popBassFactory,
};
