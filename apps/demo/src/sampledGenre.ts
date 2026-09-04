import * as Tone from "tone";
import type { InstrumentFactory, LimeInstrument } from "@lime/renderer-tone";
import type { VoiceId, PercussionSound } from "@lime/core";
import { PERCUSSION_MIDI } from "@lime/core";

/**
 * Sampled genre palettes — real recorded instruments, hosted LOCALLY in the repo
 * (apps/demo/public/samples), so quality is consistent and it works offline.
 * Each genre maps to the instruments it actually uses (guitar/bass/piano/organ/
 * sax/brass/strings + a real acoustic kit); the electric guitar runs through an
 * amp chain so it reads as a real distorted guitar.
 *
 * Samples: nbrosowsky/tonejs-instruments + Salamander piano + Tone.js drum kit,
 * all CC-BY 3.0. Samplers load async; the demo gates on Tone.loaded().
 */

const BASE = "/samples";
const midiNote = (p: number): string => Tone.Frequency(p, "midi").toNote();
/** "As1.mp3" → "A#1", "C4.mp3" → "C4". */
const toNote = (file: string): string => file.replace(/\.mp3$/, "").replace(/^([A-G])s/, "$1#");
const urls = (stems: string[]): Record<string, string> =>
  Object.fromEntries(stems.map((s) => [toNote(s), s]));

// Downloaded note sets (filenames under public/samples/<inst>/).
const NOTES: Record<string, string[]> = {
  "guitar-electric": ["A2", "A3", "A4", "A5", "C3", "C4", "C5", "C6", "Cs2", "Ds3", "Ds4", "Ds5", "E2", "Fs2", "Fs3", "Fs4", "Fs5"].map((n) => n + ".mp3"),
  "bass-electric": ["As1", "As2", "As3", "As4", "Cs1", "Cs2", "Cs3", "Cs4", "Cs5", "E1", "E2", "E3", "E4", "G1", "G2", "G3", "G4"].map((n) => n + ".mp3"),
  "guitar-acoustic": ["A2", "As2", "B2", "C3", "Cs3", "D2", "D5", "Ds4", "E4", "F4", "Fs4", "G4"].map((n) => n + ".mp3"),
  "guitar-nylon": ["A2", "A5", "B3", "Cs4", "D5", "E4", "Fs3", "G5"].map((n) => n + ".mp3"),
  organ: ["A1", "A3", "C1", "C3", "C6", "Ds3", "Ds5", "Fs3"].map((n) => n + ".mp3"),
  saxophone: ["A4", "B3", "Cs3", "D4", "Ds5", "F3", "Fs4", "G5"].map((n) => n + ".mp3"),
  trumpet: ["A3", "A5", "C4", "D5", "F3", "F5"].map((n) => n + ".mp3"),
  contrabass: ["A2", "As1", "B3", "C2", "Cs3", "D2", "E2", "E3", "Fs1", "Fs2", "G1", "Gs2", "Gs3"].map((n) => n + ".mp3"),
  cello: ["A2", "As3", "C3", "Cs4", "Ds3", "E4", "Fs3", "G3"].map((n) => n + ".mp3"),
  violin: ["A3", "A4", "A6", "C5", "C7", "E5", "G3", "G5"].map((n) => n + ".mp3"),
  flute: ["A4", "A5", "C4", "C6", "C7", "E5"].map((n) => n + ".mp3"),
  piano: ["A1", "C2", "Ds2", "Fs2", "A2", "C3", "Ds3", "Fs3", "A3", "C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5", "A5", "C6"].map((n) => n + ".mp3"),
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** A plain sampled pitched instrument with an optional lowpass. */
function sampled(inst: string, gain: number, cutoff?: number, release = 0.8): InstrumentFactory {
  return (config): LimeInstrument => {
    const sampler = new Tone.Sampler({ baseUrl: `${BASE}/${inst}/`, urls: urls(NOTES[inst]!), release, volume: 20 * Math.log10(Math.max(0.0001, config?.gain ?? gain)) });
    const output = new Tone.Gain(1);
    const filter = cutoff ? new Tone.Filter({ frequency: cutoff, type: "lowpass", Q: 0.4 }) : null;
    if (filter) sampler.chain(filter, output);
    else sampler.connect(output);
    return {
      output,
      triggerNote(pitch, velocity, timeSec, durationSec) {
        sampler.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.4 + velocity * 0.5);
      },
      setBrightness(v) { filter?.frequency.rampTo((cutoff ?? 3000) * (0.6 + clamp01(v) * 0.8), 0.2); },
      dispose() { sampler.dispose(); filter?.dispose(); output.dispose(); },
    };
  };
}

/** Real electric guitar through the amp/cabinet chain (distorted). */
function sampledGuitar(gain: number, distortion: number, cabHz: number): InstrumentFactory {
  return (config): LimeInstrument => {
    const sampler = new Tone.Sampler({ baseUrl: `${BASE}/guitar-electric/`, urls: urls(NOTES["guitar-electric"]!), release: 0.5, volume: 20 * Math.log10(Math.max(0.0001, config?.gain ?? gain)) });
    const hp = new Tone.Filter({ frequency: 110, type: "highpass" });
    const dist = new Tone.Distortion({ distortion, oversample: "4x", wet: 0.92 });
    const mid = new Tone.Filter({ type: "peaking", frequency: 1000, Q: 1, gain: 4 });
    const cab = new Tone.Filter({ frequency: cabHz, type: "lowpass", rolloff: -24 });
    const output = new Tone.Gain(1);
    sampler.chain(hp, dist, mid, cab, output);
    return {
      output,
      triggerNote(pitch, velocity, timeSec, durationSec) {
        sampler.triggerAttackRelease(midiNote(pitch), durationSec, timeSec + Math.random() * 0.008, 0.5 + velocity * 0.5);
      },
      setBrightness(v) { cab.frequency.rampTo(cabHz - 1500 + clamp01(v) * 3000, 0.3); },
      dispose() { for (const n of [sampler, hp, dist, mid, cab, output]) n.dispose(); },
    };
  };
}

const MIDI_TO_PERC = new Map<number, PercussionSound>(
  (Object.entries(PERCUSSION_MIDI) as [PercussionSound, number][]).map(([s, m]) => [m, s]),
);

/** Real acoustic drum kit (local samples), polyphonic per drum. */
export const drumKitFactory: InstrumentFactory = (): LimeInstrument => {
  const output = new Tone.Gain(1);
  const one = (file: string, gain: number) => new Tone.Sampler({ baseUrl: `${BASE}/drums/`, urls: { C2: file }, volume: 20 * Math.log10(gain) }).connect(output);
  const kick = one("kick.mp3", 1.0);
  const snare = one("snare.mp3", 0.85);
  const hat = one("hihat.mp3", 0.5);
  const tom = one("tom1.mp3", 0.7);
  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      const s = MIDI_TO_PERC.get(pitch) ?? "hat";
      const smp = s === "kick" ? kick : s === "snare" ? snare : s === "tom" ? tom : hat;
      smp.triggerAttackRelease("C2", Math.min(durationSec, 0.6), timeSec, s === "hat" ? velocity * 0.8 : velocity);
    },
    dispose() { for (const s of [kick, snare, hat, tom]) s.dispose(); output.dispose(); },
  };
};

// Instrument factories.
const elecGuitarRock = sampledGuitar(0.34, 0.62, 7000);
const elecGuitarMetal = sampledGuitar(0.32, 0.85, 6000);
const elecGuitarBlues = sampledGuitar(0.34, 0.26, 5400);
const elecBass = sampled("bass-electric", 0.5, 2200, 0.4);
const acoustic = sampled("guitar-acoustic", 0.36, undefined, 1.0);
const nylon = sampled("guitar-nylon", 0.36, undefined, 1.0);
const piano = sampled("piano", 0.42, undefined, 1.2);
const organ = sampled("organ", 0.3, 3000, 1.4);
const sax = sampled("saxophone", 0.34, undefined, 0.6);
const trumpet = sampled("trumpet", 0.32, undefined, 0.5);
const cello = sampled("cello", 0.3, 2400, 2.0);
const violin = sampled("violin", 0.26, 3000, 2.0);
const contrabass = sampled("contrabass", 0.4, 900, 1.2);
const flute = sampled("flute", 0.3, undefined, 0.8);

type Palette = Partial<Record<VoiceId, InstrumentFactory>>;

/** Genre → sampled palette (real instruments, local). Electronic/ambient keep synth. */
export const GENRE_PALETTES_SAMPLED: Record<string, Palette> = {
  "genre-classical": { melody: violin, pad: cello, bass: contrabass },
  "genre-pop": { melody: piano, pad: piano, bass: elecBass, percussion: drumKitFactory, motion: piano },
  "genre-rock-pop": { melody: elecGuitarRock, pad: elecGuitarRock, bass: elecBass, percussion: drumKitFactory },
  "genre-hiphop": { melody: piano, pad: organ, bass: elecBass, percussion: drumKitFactory, motion: piano },
  "genre-jazz": { melody: sax, pad: piano, bass: contrabass, percussion: drumKitFactory, motion: piano },
  "genre-blues": { melody: elecGuitarBlues, pad: organ, bass: elecBass, percussion: drumKitFactory },
  "genre-folk": { melody: acoustic, pad: acoustic, bass: contrabass },
  "genre-latin": { melody: trumpet, pad: piano, bass: elecBass, percussion: drumKitFactory, motion: nylon },
  "genre-funk": { melody: sax, pad: organ, bass: elecBass, percussion: drumKitFactory, motion: organ },
  "genre-metal": { melody: elecGuitarMetal, pad: elecGuitarMetal, bass: elecBass, percussion: drumKitFactory },
  "genre-ambient": { melody: flute, pad: cello },
};
