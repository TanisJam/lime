import * as Tone from "tone";
import type { VoiceId, PercussionSound } from "@lime/core";
import { PERCUSSION_MIDI } from "@lime/core";
import { linToDb, type InstrumentFactory } from "./instruments.js";

/**
 * Sampled genre palettes — real recorded instruments (CC-BY, tonejs-instruments
 * + Salamander piano) for the genres a synth can't fake. The headline: a real
 * electric-guitar multisample run through the amp chain (distortion + cabinet
 * EQ) reads as an actual guitar, not a saw. Drums stay synthetic (no verified
 * sampled kit yet).
 *
 * Sample credits (CC-BY 3.0):
 *   guitar-electric, bass-electric, guitar-acoustic — nbrosowsky/tonejs-instruments
 *   piano — Salamander Grand Piano (tonejs.github.io/audio/salamander)
 * All served with permissive CORS. Samplers load async; the demo gates on
 * Tone.loaded().
 */

const midiNote = (p: number): string => Tone.Frequency(p, "midi").toNote();
const TI = "https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/";

const GUITAR_ELECTRIC_URLS: Record<string, string> = {
  A2: "A2.mp3", A3: "A3.mp3", A4: "A4.mp3", A5: "A5.mp3",
  C3: "C3.mp3", C4: "C4.mp3", C5: "C5.mp3", C6: "C6.mp3",
  "C#2": "Cs2.mp3", "D#3": "Ds3.mp3", "D#4": "Ds4.mp3", "D#5": "Ds5.mp3",
  E2: "E2.mp3", "F#2": "Fs2.mp3", "F#3": "Fs3.mp3", "F#4": "Fs4.mp3", "F#5": "Fs5.mp3",
};
const BASS_ELECTRIC_URLS: Record<string, string> = {
  "A#1": "As1.mp3", "A#2": "As2.mp3", "A#3": "As3.mp3", "A#4": "As4.mp3",
  "C#1": "Cs1.mp3", "C#2": "Cs2.mp3", "C#3": "Cs3.mp3", "C#4": "Cs4.mp3", "C#5": "Cs5.mp3",
  E1: "E1.mp3", E2: "E2.mp3", E3: "E3.mp3", E4: "E4.mp3",
  G1: "G1.mp3", G2: "G2.mp3", G3: "G3.mp3", G4: "G4.mp3",
};
const GUITAR_ACOUSTIC_URLS: Record<string, string> = {
  A2: "A2.mp3", A3: "A3.mp3", A4: "A4.mp3", C3: "C3.mp3", C4: "C4.mp3", C5: "C5.mp3",
  "D#2": "Ds2.mp3", "D#3": "Ds3.mp3", "D#4": "Ds4.mp3", E2: "E2.mp3", E3: "E3.mp3", E4: "E4.mp3",
  "F#2": "Fs2.mp3", "F#3": "Fs3.mp3", "F#4": "Fs4.mp3", G2: "G2.mp3", G3: "G3.mp3", G4: "G4.mp3",
};

/** A real electric-guitar multisample through the amp/cabinet chain. */
function sampledGuitarVoice(opts: { gain: number; distortion: number; chebyshev: number; cabHz: number }) {
  const sampler = new Tone.Sampler({ urls: GUITAR_ELECTRIC_URLS, baseUrl: TI + "guitar-electric/", release: 0.6, volume: linToDb(opts.gain) });
  const hp = new Tone.Filter({ frequency: 110, type: "highpass" });
  const dist = new Tone.Distortion({ distortion: opts.distortion, oversample: "4x", wet: 0.92 });
  const cheb = new Tone.Chebyshev({ order: opts.chebyshev, wet: 0.28 });
  const mid = new Tone.Filter({ type: "peaking", frequency: 1000, Q: 1, gain: 4 });
  const presence = new Tone.Filter({ type: "peaking", frequency: 2600, Q: 1.2, gain: 3 });
  const cab = new Tone.Filter({ frequency: opts.cabHz, type: "lowpass", rolloff: -24 });
  const output = new Tone.Gain(1);
  sampler.chain(hp, dist, cheb, mid, presence, cab, output);
  return {
    output,
    triggerNote(pitch: number, velocity: number, timeSec: number, durationSec: number) {
      sampler.triggerAttackRelease(midiNote(pitch), durationSec, timeSec + Math.random() * 0.008, 0.5 + velocity * 0.5);
    },
    setBrightness(v: number) {
      cab.frequency.rampTo(opts.cabHz - 1500 + Math.max(0, Math.min(1, v)) * 3000, 0.3);
    },
    dispose() {
      for (const n of [sampler, hp, dist, cheb, mid, presence, cab, output]) n.dispose();
    },
  };
}

export const sampledRockGuitarFactory: InstrumentFactory = (c) => sampledGuitarVoice({ gain: c?.gain ?? 0.34, distortion: 0.68, chebyshev: 5, cabHz: 7000 });
export const sampledRockRhythmFactory: InstrumentFactory = (c) => sampledGuitarVoice({ gain: c?.gain ?? 0.28, distortion: 0.6, chebyshev: 4, cabHz: 6200 });
export const sampledMetalGuitarFactory: InstrumentFactory = (c) => sampledGuitarVoice({ gain: c?.gain ?? 0.32, distortion: 0.85, chebyshev: 8, cabHz: 6000 });
export const sampledBluesGuitarFactory: InstrumentFactory = (c) => sampledGuitarVoice({ gain: c?.gain ?? 0.34, distortion: 0.28, chebyshev: 3, cabHz: 5400 });

/** Real electric bass — a light lowpass keeps it round. */
export const sampledElectricBassFactory: InstrumentFactory = (config) => {
  const sampler = new Tone.Sampler({ urls: BASS_ELECTRIC_URLS, baseUrl: TI + "bass-electric/", release: 0.4, volume: linToDb(config?.gain ?? 0.5) });
  const filter = new Tone.Filter({ frequency: 2200, type: "lowpass", rolloff: -24, Q: 0.5 });
  const output = new Tone.Gain(1);
  sampler.chain(filter, output);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      sampler.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.55 + velocity * 0.45);
    },
    setBrightness(v) { filter.frequency.rampTo(1500 + Math.max(0, Math.min(1, v)) * 1400, 0.3); },
    dispose() { for (const n of [sampler, filter, output]) n.dispose(); },
  };
};

/** Real acoustic guitar (folk). */
export const sampledAcousticGuitarFactory: InstrumentFactory = (config) => {
  const sampler = new Tone.Sampler({ urls: GUITAR_ACOUSTIC_URLS, baseUrl: TI + "guitar-acoustic/", release: 1.0, volume: linToDb(config?.gain ?? 0.34) });
  const output = new Tone.Gain(1);
  sampler.connect(output);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      sampler.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.4 + velocity * 0.5);
    },
    dispose() { sampler.dispose(); output.dispose(); },
  };
};

/** Salamander grand piano (jazz/classical/latin/pop keys). */
export const sampledPianoFactory: InstrumentFactory = (config) => {
  const sampler = new Tone.Sampler({
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    release: 1.2,
    volume: linToDb(config?.gain ?? 0.4),
    urls: { A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3", C6: "C6.mp3" },
  });
  const output = new Tone.Gain(1);
  sampler.connect(output);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      sampler.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.4 + velocity * 0.5);
    },
    dispose() { sampler.dispose(); output.dispose(); },
  };
};

const MIDI_TO_PERC = new Map<number, PercussionSound>(
  (Object.entries(PERCUSSION_MIDI) as [PercussionSound, number][]).map(([s, m]) => [m, s]),
);

/** Real acoustic drum kit (Tone.js drum-samples, CC-BY). Polyphonic per drum. */
export const sampledKitFactory: InstrumentFactory = () => {
  const output = new Tone.Gain(1);
  const base = "https://tonejs.github.io/audio/drum-samples/acoustic-kit/";
  const mk = (file: string, gain: number) =>
    new Tone.Sampler({ baseUrl: base, urls: { C2: file }, volume: linToDb(gain) }).connect(output);
  const kick = mk("kick.mp3", 1.0);
  const snare = mk("snare.mp3", 0.8);
  const hat = mk("hihat.mp3", 0.5);
  const tom = mk("tom1.mp3", 0.7);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      const sound = MIDI_TO_PERC.get(pitch) ?? "hat";
      const s = sound === "kick" ? kick : sound === "snare" ? snare : sound === "tom" ? tom : hat;
      s.triggerAttackRelease("C2", Math.min(durationSec, 0.6), timeSec, sound === "hat" ? velocity * 0.8 : velocity);
    },
    dispose() {
      for (const s of [kick, snare, hat, tom]) s.dispose();
      output.dispose();
    },
  };
};

// --- Sampled palettes per genre (real acoustic drum kit) ---------------------
export const ROCK_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { pad: sampledRockRhythmFactory, melody: sampledRockGuitarFactory, bass: sampledElectricBassFactory, percussion: sampledKitFactory };
export const METAL_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { pad: sampledMetalGuitarFactory, melody: sampledMetalGuitarFactory, bass: sampledElectricBassFactory, percussion: sampledKitFactory };
export const BLUES_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { pad: sampledBluesGuitarFactory, melody: sampledBluesGuitarFactory, bass: sampledElectricBassFactory, percussion: sampledKitFactory };
export const JAZZ_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { pad: sampledPianoFactory, melody: sampledPianoFactory, bass: sampledElectricBassFactory, percussion: sampledKitFactory };
export const POP_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { pad: sampledPianoFactory, melody: sampledPianoFactory, bass: sampledElectricBassFactory, percussion: sampledKitFactory };
export const LATIN_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { pad: sampledPianoFactory, melody: sampledPianoFactory, bass: sampledElectricBassFactory, percussion: sampledKitFactory };
export const FUNK_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { pad: sampledPianoFactory, melody: sampledPianoFactory, bass: sampledElectricBassFactory, percussion: sampledKitFactory };
export const CLASSICAL_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { melody: sampledPianoFactory, pad: sampledPianoFactory, bass: sampledElectricBassFactory };
export const FOLK_SAMPLED: Partial<Record<VoiceId, InstrumentFactory>> = { melody: sampledAcousticGuitarFactory, pad: sampledAcousticGuitarFactory, bass: sampledElectricBassFactory };
