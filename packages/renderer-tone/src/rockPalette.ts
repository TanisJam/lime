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

/**
 * Guards one monophonic source against being triggered at or before its own
 * previous trigger, which Tone rejects outright.
 *
 * Several voices here share a single source on purpose: the guitar's pick noise
 * fires on every note, and one NoiseSynth covers both snare and tom hits. Two
 * events landing on the same tick is ordinary music, not a mistake — a tom and
 * a snare on the same beat, or the notes of one chord once the strum offset
 * moves them. Live playback rarely hit this because the transport schedules a
 * bar at a time; rendering a clip offline schedules everything at once and hits
 * it reliably. A tenth of a millisecond apart is inaudible.
 */
function monotonicTime(): (timeSec: number) => number {
  let last = -Infinity;
  return (timeSec) => {
    if (timeSec < last - 1) last = -Infinity; // the transport restarted
    const t = timeSec <= last ? last + 1e-4 : timeSec;
    last = t;
    return t;
  };
}

/**
 * A distorted electric-guitar voice (shared by lead and rhythm). The chain
 * follows what actually reads as "guitar" vs "buzzy synth" (researched):
 * fat detuned saw → high-pass out the flub → waveshaping (Distortion with
 * `oversample:"4x"` to kill aliasing fizz, plus a Chebyshev for tube-like odd
 * harmonics) → amp-cabinet EQ (mid + presence peaks, high cut ~7 kHz). A short
 * filtered-noise pick transient and a few ms of strum/humanize per note keep it
 * from sounding static.
 */
export function guitarVoice(opts: {
  gain: number;
  distortion: number;
  chebyshev: number;
  cabHz: number;
  attack: number;
  sustain: number;
  release: number;
}) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", spread: 16, count: 2 },
    envelope: { attack: opts.attack, decay: 0.2, sustain: opts.sustain, release: opts.release },
    volume: linToDb(opts.gain),
  });
  const hp = new Tone.Filter({ frequency: 110, type: "highpass" });
  const dist = new Tone.Distortion({ distortion: opts.distortion, oversample: "4x", wet: 0.95 });
  const cheb = new Tone.Chebyshev({ order: opts.chebyshev, wet: 0.3 });
  const mid = new Tone.Filter({ type: "peaking", frequency: 1000, Q: 1, gain: 5 });
  const presence = new Tone.Filter({ type: "peaking", frequency: 2600, Q: 1.2, gain: 3 });
  const cab = new Tone.Filter({ frequency: opts.cabHz, type: "lowpass", rolloff: -24 });
  const output = new Tone.Gain(1);
  synth.chain(hp, dist, cheb, mid, presence, cab, output);

  // Pick transient: a tiny high-passed noise click on each note (the "attack").
  const pick = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.02, sustain: 0 },
    volume: linToDb(0.22),
  });
  const pickHp = new Tone.Filter({ frequency: 2500, type: "highpass" });
  pick.chain(pickHp, output);

  const nextPickTime = monotonicTime();

  return {
    output,
    triggerNote(pitch: number, velocity: number, timeSec: number, durationSec: number) {
      // Strum offset, derived from the pitch rather than drawn at random.
      // Math.random() here was a real bug, not just a reproducibility problem:
      // the notes of one chord all arrive with the same timeSec, so different
      // offsets could schedule the second note BEFORE the first and Tone threw
      // "the time must be greater than or equal to the last scheduled time".
      // Live playback hid it behind look-ahead; rendering a whole clip up front
      // hits it every time. A deterministic offset also makes the audio
      // reproducible, which the offline judge needs.
      const jitter = ((pitch * 2654435761) % 1024) / 1024 * 0.01;
      const t = nextPickTime(timeSec + jitter);

      synth.triggerAttackRelease(midiNote(pitch), durationSec, t, 0.5 + velocity * 0.5);
      pick.triggerAttackRelease(0.02, t, velocity * 0.6);
    },
    setBrightness(v: number) {
      const c = Math.max(0, Math.min(1, v));
      cab.frequency.rampTo(opts.cabHz - 1500 + c * 3000, 0.3);
    },
    dispose() {
      for (const n of [synth, hp, dist, cheb, mid, presence, cab, pick, pickHp, output]) n.dispose();
    },
  };
}

/** Lead / melody — a biting single-note lead guitar. */
export const rockGuitarFactory: InstrumentFactory = (config) =>
  guitarVoice({
    gain: config?.gain ?? 0.3,
    distortion: 0.72,
    chebyshev: 6,
    cabHz: 7000,
    attack: 0.004,
    sustain: 0.6,
    release: 0.25,
  });

/** Harmonic bed — sustained rhythm guitar (power chords, a touch less gain). */
export const rockRhythmFactory: InstrumentFactory = (config) =>
  guitarVoice({
    gain: config?.gain ?? 0.24,
    distortion: 0.6,
    chebyshev: 4,
    cabHz: 6200,
    attack: 0.008,
    sustain: 0.75,
    release: 0.5,
  });

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

  const nextKick = monotonicTime();
  const nextSnare = monotonicTime();
  const nextHat = monotonicTime();

  return {
    output,
    triggerNote(pitch, velocity, timeSec, durationSec) {
      const sound = MIDI_TO_PERC.get(pitch) ?? "hat";
      switch (sound) {
        case "kick":
          kick.triggerAttackRelease("C1", Math.max(durationSec, 0.12), nextKick(timeSec), velocity);
          break;
        case "snare":
        case "tom":
          // One source for both, so a tom and a snare on the same beat collide.
          snare.triggerAttackRelease(
            Math.min(Math.max(durationSec, 0.12), 0.24),
            nextSnare(timeSec),
            velocity,
          );
          break;
        default:
          hat.triggerAttackRelease(Math.min(durationSec, 0.06), nextHat(timeSec), velocity * 0.85);
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
