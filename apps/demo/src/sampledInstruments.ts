import * as Tone from "tone";
import type { InstrumentFactory, LimeInstrument } from "@lime/renderer-tone";
import type { SynthVoiceConfig, VoiceId } from "@lime/core";

/**
 * Sampled-instrument palette for the demo's A/B toggle.
 *
 * These factories plug into the renderer's pluggable instrument API
 * ({@link InstrumentFactory}). Each one only has to MAKE SOUND from its `output`
 * node; the renderer owns panning, mute, and the shared reverb/delay sends.
 *
 * ---------------------------------------------------------------------------
 * Sample credits (required by CC-BY):
 *   - melody: Salamander Grand Piano — CC-BY 3.0
 *       https://tonejs.github.io/audio/salamander/
 *   - pad (cello + violin) & bass (contrabass, bowed): tonejs-instruments — CC-BY 3.0
 *       https://github.com/nbrosowsky/tonejs-instruments
 * All served with permissive CORS (access-control-allow-origin: *).
 * ---------------------------------------------------------------------------
 *
 * Samplers load their buffers asynchronously. The demo gates playback on
 * `Tone.loaded()` before it relies on these instruments, so notes are not
 * dropped into silence before the buffers arrive.
 */

/** Clamp helper for brightness → cutoff mapping. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * melody — Salamander Grand Piano (mp3, CC-BY 3.0).
 *
 * The FULL 30-note set (minimal repitching for a natural piano across the range).
 * Runs through a gentle lowpass for an intimate "felt" character; `setBrightness`
 * moves that cutoff. Note the sharp filenames use `Ds`/`Fs` while the Sampler
 * keys use `#`.
 */
const melodyFactory: InstrumentFactory = (_config: SynthVoiceConfig | undefined): LimeInstrument => {
  const output = new Tone.Gain(0.4);
  const filter = new Tone.Filter({ type: "lowpass", frequency: 2500, Q: 0.4 });
  const sampler = new Tone.Sampler({
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    release: 1.2,
    urls: {
      A0: "A0.mp3",
      C1: "C1.mp3",
      "D#1": "Ds1.mp3",
      "F#1": "Fs1.mp3",
      A1: "A1.mp3",
      C2: "C2.mp3",
      "D#2": "Ds2.mp3",
      "F#2": "Fs2.mp3",
      A2: "A2.mp3",
      C3: "C3.mp3",
      "D#3": "Ds3.mp3",
      "F#3": "Fs3.mp3",
      A3: "A3.mp3",
      C4: "C4.mp3",
      "D#4": "Ds4.mp3",
      "F#4": "Fs4.mp3",
      A4: "A4.mp3",
      C5: "C5.mp3",
      "D#5": "Ds5.mp3",
      "F#5": "Fs5.mp3",
      A5: "A5.mp3",
      C6: "C6.mp3",
      "D#6": "Ds6.mp3",
      "F#6": "Fs6.mp3",
      A6: "A6.mp3",
      C7: "C7.mp3",
      "D#7": "Ds7.mp3",
      "F#7": "Fs7.mp3",
      A7: "A7.mp3",
      C8: "C8.mp3",
    },
  });

  sampler.chain(filter, output);

  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      sampler.triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), durationSec, timeSec, velocity);
    },
    setBrightness(v) {
      // v ∈ [0,1] → ~1200..5000 Hz.
      filter.frequency.rampTo(1200 + clamp01(v) * 3800, 0.1);
    },
    dispose() {
      sampler.dispose();
      filter.dispose();
      output.dispose();
    },
  };
};

/**
 * pad — LAYERED string pad (tonejs-instruments, mp3, CC-BY 3.0).
 *
 * Two samplers feed a shared lowpass: the FULL cello set carries the low/mid body
 * while the FULL violin set, quieter and higher, adds air on top. Warm, slow
 * attack; `setBrightness` moves the shared cutoff. The violin gain sits well below
 * the cello so it colors rather than dominates.
 */
const padFactory: InstrumentFactory = (_config: SynthVoiceConfig | undefined): LimeInstrument => {
  const output = new Tone.Gain(0.35);
  const filter = new Tone.Filter({ type: "lowpass", frequency: 2600, Q: 0.3 });

  const celloGain = new Tone.Gain(0.28);
  const cello = new Tone.Sampler({
    baseUrl: "https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/cello/",
    attack: 0.6,
    release: 2.5,
    urls: {
      C2: "C2.mp3",
      D2: "D2.mp3",
      "D#2": "Ds2.mp3",
      E2: "E2.mp3",
      F2: "F2.mp3",
      G2: "G2.mp3",
      "G#2": "Gs2.mp3",
      A2: "A2.mp3",
      "A#2": "As2.mp3",
      B2: "B2.mp3",
      C3: "C3.mp3",
      "C#3": "Cs3.mp3",
      D3: "D3.mp3",
      "D#3": "Ds3.mp3",
      E3: "E3.mp3",
      F3: "F3.mp3",
      "F#3": "Fs3.mp3",
      G3: "G3.mp3",
      "G#3": "Gs3.mp3",
      A3: "A3.mp3",
      "A#3": "As3.mp3",
      B3: "B3.mp3",
      C4: "C4.mp3",
      "C#4": "Cs4.mp3",
      D4: "D4.mp3",
      "D#4": "Ds4.mp3",
      E4: "E4.mp3",
      F4: "F4.mp3",
      "F#4": "Fs4.mp3",
      G4: "G4.mp3",
      "G#4": "Gs4.mp3",
      A4: "A4.mp3",
      B4: "B4.mp3",
      C5: "C5.mp3",
    },
  });

  const violinGain = new Tone.Gain(0.14);
  const violin = new Tone.Sampler({
    baseUrl: "https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/violin/",
    attack: 0.6,
    release: 2.5,
    urls: {
      A3: "A3.mp3",
      C4: "C4.mp3",
      E4: "E4.mp3",
      G4: "G4.mp3",
      A4: "A4.mp3",
      C5: "C5.mp3",
      E5: "E5.mp3",
      G5: "G5.mp3",
      A5: "A5.mp3",
      C6: "C6.mp3",
      E6: "E6.mp3",
      G6: "G6.mp3",
      A6: "A6.mp3",
      C7: "C7.mp3",
    },
  });

  cello.connect(celloGain);
  violin.connect(violinGain);
  celloGain.connect(filter);
  violinGain.connect(filter);
  filter.connect(output);

  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      const note = Tone.Frequency(pitch, "midi").toNote();
      cello.triggerAttackRelease(note, durationSec, timeSec, velocity);
      violin.triggerAttackRelease(note, durationSec, timeSec, velocity);
    },
    setBrightness(v) {
      filter.frequency.rampTo(1400 + clamp01(v) * 3200, 0.1);
    },
    dispose() {
      cello.dispose();
      violin.dispose();
      celloGain.dispose();
      violinGain.dispose();
      filter.dispose();
      output.dispose();
    },
  };
};

/**
 * bass — contrabass, bowed (tonejs-instruments, mp3, CC-BY 3.0).
 *
 * A BOWED string, not a plucked electric bass. This matters: the composer holds
 * sustained bass roots at low energy, and a plucked sample forced to sustain (via
 * a long release into reverb) sounds fake — the arco contrabass sustains for real.
 * It also shares the string family of the cello+violin pad, so the low end sits
 * inside the bed instead of standing in front of it. Kept notably quieter than the
 * old electric bass so it grounds rather than leads. The set is register-limited
 * (F#1–B3), which is exactly the bass range we need.
 */
const bassFactory: InstrumentFactory = (_config: SynthVoiceConfig | undefined): LimeInstrument => {
  const output = new Tone.Gain(0.24);
  const filter = new Tone.Filter({ type: "lowpass", frequency: 900, Q: 0.3 });
  const sampler = new Tone.Sampler({
    baseUrl: "https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/contrabass/",
    attack: 0.35, // slow bow so it swells in rather than thumps
    release: 2.2,
    urls: {
      "F#1": "Fs1.mp3",
      G1: "G1.mp3",
      "A#1": "As1.mp3",
      C2: "C2.mp3",
      D2: "D2.mp3",
      E2: "E2.mp3",
      "F#2": "Fs2.mp3",
      "G#2": "Gs2.mp3",
      A2: "A2.mp3",
      "C#3": "Cs3.mp3",
      E3: "E3.mp3",
      "G#3": "Gs3.mp3",
      B3: "B3.mp3",
    },
  });

  sampler.chain(filter, output);

  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      sampler.triggerAttackRelease(Tone.Frequency(pitch, "midi").toNote(), durationSec, timeSec, velocity);
    },
    setBrightness(v) {
      filter.frequency.rampTo(600 + clamp01(v) * 1000, 0.1);
    },
    dispose() {
      sampler.dispose();
      filter.dispose();
      output.dispose();
    },
  };
};

/**
 * High-quality sampled palette. `percussion` is intentionally omitted so the
 * built-in synth percussion is used (there is no verified sampled kit here).
 */
export const SAMPLED_INSTRUMENTS: Partial<Record<VoiceId, InstrumentFactory>> = {
  melody: melodyFactory,
  pad: padFactory,
  bass: bassFactory,
};
