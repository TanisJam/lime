import * as Tone from "tone";
import type { SynthVoiceConfig, PercussionSound, VoiceId } from "@lime/core";
import { PERCUSSION_MIDI } from "@lime/core";

/**
 * A pluggable LIME instrument.
 *
 * An instrument owns its own sound generation (synthesis, or later a
 * {@link Tone.Sampler}) and exposes a single {@link output} node that the
 * renderer wires into the shared mix (panner → mute-gain → dry + sends). It
 * knows nothing about panning, sends, reverb, or muting — that mix plumbing is
 * the renderer's job — so a custom instrument only has to make a good sound.
 *
 * Instruments live entirely in `@lime/renderer-tone`; `@lime/core` never imports
 * Tone.js or any instrument/sample knowledge.
 */
export interface LimeInstrument {
  /**
   * Play one note.
   * @param pitch MIDI note number. Percussion instruments map this to a drum
   *   sound (see {@link PERCUSSION_MIDI}); pitched instruments treat it as a note.
   * @param velocity Normalized velocity 0..1.
   * @param timeSec Absolute Tone transport time, in seconds.
   * @param durationSec Note length, in seconds.
   */
  triggerNote(pitch: number, velocity: number, timeSec: number, durationSec: number): void;
  /** The node the renderer connects into the mix bus. */
  readonly output: Tone.ToneAudioNode;
  /** Optional per-instrument brightness response (0..1). */
  setBrightness?(v: number): void;
  /** Release audio resources. */
  dispose(): void;
}

/**
 * Builds a {@link LimeInstrument} for one voice. The renderer passes the voice's
 * {@link SynthVoiceConfig} (undefined for voices without one, e.g. percussion).
 */
export type InstrumentFactory = (config: SynthVoiceConfig | undefined) => LimeInstrument;

/** Linear gain (0–1) to decibels for Tone volume params. */
export function linToDb(gain: number): number {
  return 20 * Math.log10(Math.max(0.0001, gain));
}

/** Turn a plain waveform into its "fat" (super-saw style, detuned) variant. */
type FatType = "fatsine" | "fattriangle" | "fatsawtooth" | "fatsquare";
function fat(wave: SynthVoiceConfig["oscillator"]): FatType {
  return `fat${wave}` as FatType;
}

// --- Default palette --------------------------------------------------------
// A warm, restrained ambient palette. Each voice is self-contained synthesis
// (no samples, no CDN) and keeps its own short effect chain small: the shared
// reverb/delay/pan live in the renderer, not here.

/** Fallback config if a pack somehow omits a voice's SynthVoiceConfig. */
const FALLBACK: SynthVoiceConfig = {
  oscillator: "sine",
  attack: 0.5,
  decay: 0.5,
  sustain: 0.6,
  release: 1.5,
  filterCutoff: 2000,
  gain: 0.4,
};

/**
 * pad — the harmonic bed. Warm detuned ("fat") polyphonic oscillator with a
 * slow attack, a gentle lowpass, and a slow shallow chorus for width. No big
 * reverb here; the shared aux does the space.
 */
export const padFactory: InstrumentFactory = (config) => {
  const cfg = config ?? FALLBACK;
  const cutoff = cfg.filterCutoff ?? 2200;

  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: fat(cfg.oscillator), spread: 24, count: 3 },
    envelope: { attack: cfg.attack, decay: cfg.decay, sustain: cfg.sustain, release: cfg.release },
    volume: linToDb(cfg.gain),
  });
  const filter = new Tone.Filter({ frequency: cutoff, type: "lowpass", rolloff: -12, Q: 0.3 });
  const chorus = new Tone.Chorus({ frequency: 0.4, delayTime: 5, depth: 0.4, wet: 0.25 }).start();
  const output = new Tone.Gain(1);
  synth.connect(filter);
  filter.connect(chorus);
  chorus.connect(output);

  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      synth.triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), durationSec, timeSec, velocity);
    },
    setBrightness(v) {
      const clamp = Math.max(0, Math.min(1, v));
      filter.frequency.rampTo(700 + clamp * (cutoff + 1800 - 700), 0.3);
    },
    dispose() {
      synth.dispose();
      filter.dispose();
      chorus.dispose();
      output.dispose();
    },
  };
};

/**
 * bass — soft rounded low synth. A single sine/triangle voice with a soft
 * envelope and a low lowpass so it supports the harmony without booming.
 */
export const bassFactory: InstrumentFactory = (config) => {
  const cfg = config ?? FALLBACK;
  const cutoff = cfg.filterCutoff ?? 700;

  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: cfg.oscillator },
    envelope: { attack: cfg.attack, decay: cfg.decay, sustain: cfg.sustain, release: cfg.release },
    volume: linToDb(cfg.gain),
  });
  const filter = new Tone.Filter({ frequency: cutoff, type: "lowpass", rolloff: -24, Q: 0.4 });
  const output = new Tone.Gain(1);
  synth.connect(filter);
  filter.connect(output);

  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      synth.triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), durationSec, timeSec, velocity);
    },
    setBrightness(v) {
      // Bass moves little with brightness — keep it grounded.
      const clamp = Math.max(0, Math.min(1, v));
      filter.frequency.rampTo(cutoff * (0.8 + clamp * 0.5), 0.3);
    },
    dispose() {
      synth.dispose();
      filter.dispose();
      output.dispose();
    },
  };
};

/**
 * melody — the "felt piano" stand-in. An FMSynth with a low modulation index
 * gives a soft electric-piano/pluck body; a short percussive amp envelope with
 * a gentle release, plus a lowpass, keeps it intimate rather than sharp.
 * The pack's SynthVoiceConfig envelope/gain/cutoff are honoured; the FM
 * structure (harmonicity, modulation index) is chosen internally for character.
 */
export const melodyFactory: InstrumentFactory = (config) => {
  const cfg = config ?? FALLBACK;
  const cutoff = cfg.filterCutoff ?? 3200;

  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 3.2,
    oscillator: { type: "sine" },
    envelope: { attack: cfg.attack, decay: cfg.decay, sustain: cfg.sustain, release: cfg.release },
    modulation: { type: "triangle" },
    modulationEnvelope: { attack: 0.008, decay: 0.25, sustain: 0.1, release: 0.4 },
    volume: linToDb(cfg.gain),
  });
  const filter = new Tone.Filter({ frequency: cutoff, type: "lowpass", rolloff: -12, Q: 0.2 });
  const output = new Tone.Gain(1);
  synth.connect(filter);
  filter.connect(output);

  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      // Soften velocity a touch so accents stay intimate.
      const v = 0.35 + velocity * 0.55;
      synth.triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), durationSec, timeSec, v);
    },
    setBrightness(v) {
      const clamp = Math.max(0, Math.min(1, v));
      filter.frequency.rampTo(1200 + clamp * (cutoff + 2500 - 1200), 0.3);
    },
    dispose() {
      synth.dispose();
      filter.dispose();
      output.dispose();
    },
  };
};

/** Reverse map: MIDI drum number → abstract percussion sound. */
const MIDI_TO_PERC = new Map<number, PercussionSound>(
  (Object.entries(PERCUSSION_MIDI) as [PercussionSound, number][]).map(([sound, midi]) => [midi, sound]),
);

/**
 * percussion — a restrained organic/electronic kit built from synthesis:
 * a softened MembraneSynth kick, filtered-noise snare/tom (bandpass), and a
 * soft short hat/shaker (highpass). Overall level is calibrated to unity here;
 * the renderer applies `percussionGain` and keeps the kit low and mostly dry.
 * `config` is unused (percussion has no SynthVoiceConfig).
 */
export const percussionFactory: InstrumentFactory = () => {
  const output = new Tone.Gain(1);

  const kick = new Tone.MembraneSynth({
    octaves: 3,
    pitchDecay: 0.045,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.9 },
    volume: linToDb(0.9),
  });
  const kickShaper = new Tone.Filter({ frequency: 2000, type: "lowpass" });
  kick.connect(kickShaper);
  kickShaper.connect(output);

  const snare = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
    volume: linToDb(0.5),
  });
  const snareBody = new Tone.Filter({ frequency: 1600, type: "bandpass", Q: 0.8 });
  snare.connect(snareBody);
  snareBody.connect(output);

  const hat = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.045, sustain: 0 },
    volume: linToDb(0.35),
  });
  const hatFilter = new Tone.Filter({ frequency: 8000, type: "highpass" });
  hat.connect(hatFilter);
  hatFilter.connect(output);

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
          snare.triggerAttackRelease(Math.min(durationSec, 0.2), timeSec, velocity);
          break;
        default: // hat / shaker
          hat.triggerAttackRelease(Math.min(durationSec, 0.06), timeSec, velocity * 0.8);
          break;
      }
    },
    dispose() {
      for (const n of [kick, kickShaper, snare, snareBody, hat, hatFilter, output]) n.dispose();
    },
  };
};

/** The built-in self-contained palette, keyed by voice. */
export const DEFAULT_INSTRUMENT_FACTORIES: Record<
  Exclude<VoiceId, "texture">,
  InstrumentFactory
> = {
  pad: padFactory,
  bass: bassFactory,
  melody: melodyFactory,
  percussion: percussionFactory,
};
