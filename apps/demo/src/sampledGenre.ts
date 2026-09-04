import * as Tone from "tone";
import type { InstrumentFactory, LimeInstrument } from "@lime/renderer-tone";
import type { VoiceId, PercussionSound } from "@lime/core";
import { PERCUSSION_MIDI } from "@lime/core";

/**
 * Sampled genre palettes — real General-MIDI soundfont instruments (MusyngKite),
 * hosted locally (apps/demo/public/samples/sf) so quality is consistent and it
 * works offline. These are proper recorded patches — the distorted/overdriven
 * guitars are recorded WITH the amp tone (no software distortion of a clean
 * sample, which sounded bad), plus a real Rhodes, organ, sax, brass, strings.
 *
 * Soundfonts: gleitz/midi-js-soundfonts (MusyngKite), freely redistributable.
 * Drum kit: Tone.js acoustic-kit (CC-BY). Samplers load async; the demo gates on
 * Tone.loaded(). See public/samples/CREDITS.md.
 */

const BASE = "/samples/sf";
const midiNote = (p: number): string => Tone.Frequency(p, "midi").toNote();
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

// The notes downloaded per instrument (filenames use flats). Keys map to sharps
// (enharmonic) for reliable Tone parsing while pointing at the flat filenames.
const NOTE_STEMS = ["C1", "Eb1", "Gb1", "A1", "C2", "Eb2", "Gb2", "A2", "C3", "Eb3", "Gb3", "A3", "C4", "Eb4", "Gb4", "A4", "C5", "Eb5", "Gb5", "A5", "C6", "Eb6", "A6"];
const FLAT_TO_SHARP: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
const toKey = (stem: string): string => {
  const m = stem.match(/^([A-G]b?)(\d+)$/);
  if (!m) return stem;
  return (FLAT_TO_SHARP[m[1]!] ?? m[1]!) + m[2]!;
};
const urls = (): Record<string, string> =>
  Object.fromEntries(NOTE_STEMS.map((s) => [toKey(s), `${s}.mp3`]));

/** A soundfont instrument factory (optional lowpass for taming brightness). */
function sf(inst: string, gain: number, cutoff?: number, release = 0.6): InstrumentFactory {
  return (config): LimeInstrument => {
    const sampler = new Tone.Sampler({
      baseUrl: `${BASE}/${inst}/`,
      urls: urls(),
      release,
      volume: 20 * Math.log10(Math.max(0.0001, config?.gain ?? gain)),
    });
    const output = new Tone.Gain(1);
    const filter = cutoff ? new Tone.Filter({ frequency: cutoff, type: "lowpass", Q: 0.4 }) : null;
    if (filter) sampler.chain(filter, output);
    else sampler.connect(output);
    return {
      output,
      triggerNote(pitch, velocity, timeSec, durationSec) {
        sampler.triggerAttackRelease(midiNote(pitch), durationSec, timeSec, 0.35 + velocity * 0.55);
      },
      setBrightness(v) {
        filter?.frequency.rampTo((cutoff ?? 3000) * (0.6 + clamp01(v) * 0.8), 0.2);
      },
      dispose() {
        sampler.dispose();
        filter?.dispose();
        output.dispose();
      },
    };
  };
}

const MIDI_TO_PERC = new Map<number, PercussionSound>(
  (Object.entries(PERCUSSION_MIDI) as [PercussionSound, number][]).map(([s, m]) => [m, s]),
);

/** Real acoustic drum kit (local samples), polyphonic per drum. */
export const drumKitFactory: InstrumentFactory = (): LimeInstrument => {
  const output = new Tone.Gain(1);
  const one = (file: string, gain: number) =>
    new Tone.Sampler({ baseUrl: "/samples/drums/", urls: { C2: file }, volume: 20 * Math.log10(gain) }).connect(output);
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
    dispose() {
      for (const s of [kick, snare, hat, tom]) s.dispose();
      output.dispose();
    },
  };
};

// Instrument factories (GM soundfont patches).
const overdrive = sf("overdriven_guitar", 0.5);
const distortion = sf("distortion_guitar", 0.5);
const cleanGtr = sf("electric_guitar_clean", 0.6);
const jazzGtr = sf("electric_guitar_jazz", 0.6);
const mutedGtr = sf("electric_guitar_muted", 0.6);
const rhodes = sf("electric_piano_1", 0.6);
const rockOrgan = sf("rock_organ", 0.45);
const organ = sf("drawbar_organ", 0.45);
const piano = sf("acoustic_grand_piano", 0.55);
const eBass = sf("electric_bass_finger", 0.7);
const upright = sf("acoustic_bass", 0.7);
const synthBass = sf("synth_bass_1", 0.7);
const sax = sf("tenor_sax", 0.5);
const trumpet = sf("trumpet", 0.45);
const nylon = sf("acoustic_guitar_nylon", 0.6);
const steel = sf("acoustic_guitar_steel", 0.6);
const strings = sf("string_ensemble_1", 0.4, 3200);
const cello = sf("cello", 0.5, 2600);
const violin = sf("violin", 0.42, 3400);
const flute = sf("flute", 0.45);
const saw = sf("lead_2_sawtooth", 0.42, 4200);
const warmPad = sf("pad_2_warm", 0.4);

type Palette = Partial<Record<VoiceId, InstrumentFactory>>;

/** Genre → sampled palette (real GM instruments, local). */
export const GENRE_PALETTES_SAMPLED: Record<string, Palette> = {
  "genre-classical": { melody: violin, pad: strings, bass: upright },
  "genre-pop": { melody: piano, pad: rhodes, bass: eBass, percussion: drumKitFactory, motion: piano },
  "genre-rock-pop": { melody: overdrive, pad: overdrive, bass: eBass, percussion: drumKitFactory },
  "genre-hiphop": { melody: rhodes, pad: warmPad, bass: synthBass, percussion: drumKitFactory, motion: rhodes },
  "genre-jazz": { melody: sax, pad: rhodes, bass: upright, percussion: drumKitFactory, motion: piano },
  "genre-blues": { melody: cleanGtr, pad: rockOrgan, bass: eBass, percussion: drumKitFactory },
  "genre-folk": { melody: steel, pad: steel, bass: upright },
  "genre-latin": { melody: trumpet, pad: piano, bass: eBass, percussion: drumKitFactory, motion: nylon },
  "genre-funk": { melody: sax, pad: mutedGtr, bass: eBass, percussion: drumKitFactory, motion: rhodes },
  "genre-metal": { melody: distortion, pad: distortion, bass: eBass, percussion: drumKitFactory },
  "genre-electronic": { melody: saw, pad: warmPad, bass: synthBass, percussion: drumKitFactory, motion: saw },
  "genre-ambient": { melody: flute, pad: warmPad },
};

// Retire the unused synth-only genres from lint: jazzGtr/organ kept for future use.
void jazzGtr;
void organ;
