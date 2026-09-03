import * as Tone from "tone";
import {
  type MusicRenderer,
  type MusicalEvent,
  type InstrumentationConfig,
  TICKS_PER_QUARTER,
} from "@lime/core";

const DEFAULT_INSTRUMENTATION: InstrumentationConfig = {
  reverbWet: 0.4,
  reverbDecay: 5,
  delayWet: 0.12,
  percussionGain: 0.55,
  pad: { oscillator: "sine", attack: 1.4, decay: 1, sustain: 0.75, release: 3, filterCutoff: 2200, gain: 0.42 },
  bass: { oscillator: "triangle", attack: 0.03, decay: 0.3, sustain: 0.6, release: 0.6, filterCutoff: 700, gain: 0.5 },
  melody: { oscillator: "triangle", attack: 0.06, decay: 0.4, sustain: 0.45, release: 0.9, filterCutoff: 3200, gain: 0.4 },
};

export interface ToneRendererOptions {
  instrumentation?: InstrumentationConfig;
}

/**
 * Browser renderer for LIME built on Tone.js.
 *
 * Core emits tick-based symbolic events; this renderer maps them onto
 * Tone.Transport (whose PPQ is set to match {@link TICKS_PER_QUARTER}), so tempo
 * changes ramp smoothly and scheduling stays sample-accurate. Sounds are
 * intentionally simple — the point is to prove composition, pleasantly.
 */
export class ToneRenderer implements MusicRenderer {
  private readonly cfg: InstrumentationConfig;

  private reverb!: Tone.Reverb;
  private delay!: Tone.FeedbackDelay;
  private padSynth!: Tone.PolySynth;
  private padFilter!: Tone.Filter;
  private bassSynth!: Tone.PolySynth;
  private melodySynth!: Tone.Synth;
  private melodyFilter!: Tone.Filter;
  private kick!: Tone.MembraneSynth;
  private snare!: Tone.NoiseSynth;
  private hat!: Tone.NoiseSynth;
  private percGain!: Tone.Gain;

  private built = false;
  private running = false;

  constructor(options: ToneRendererOptions = {}) {
    this.cfg = options.instrumentation ?? DEFAULT_INSTRUMENTATION;
  }

  private build(): void {
    if (this.built) return;
    const cfg = this.cfg;

    this.reverb = new Tone.Reverb({ decay: cfg.reverbDecay, wet: cfg.reverbWet }).toDestination();
    this.delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.28, wet: cfg.delayWet }).connect(this.reverb);

    this.padFilter = new Tone.Filter(cfg.pad.filterCutoff ?? 2200, "lowpass").connect(this.reverb);
    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: cfg.pad.oscillator },
      envelope: { attack: cfg.pad.attack, decay: cfg.pad.decay, sustain: cfg.pad.sustain, release: cfg.pad.release },
      volume: linToDb(cfg.pad.gain),
    }).connect(this.padFilter);

    this.bassSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: cfg.bass.oscillator },
      envelope: { attack: cfg.bass.attack, decay: cfg.bass.decay, sustain: cfg.bass.sustain, release: cfg.bass.release },
      volume: linToDb(cfg.bass.gain),
    });
    const bassFilter = new Tone.Filter(cfg.bass.filterCutoff ?? 800, "lowpass").toDestination();
    this.bassSynth.connect(bassFilter);
    this.bassSynth.connect(this.reverb);

    this.melodyFilter = new Tone.Filter(cfg.melody.filterCutoff ?? 3200, "lowpass").connect(this.delay);
    this.melodyFilter.connect(this.reverb);
    this.melodySynth = new Tone.Synth({
      oscillator: { type: cfg.melody.oscillator },
      envelope: { attack: cfg.melody.attack, decay: cfg.melody.decay, sustain: cfg.melody.sustain, release: cfg.melody.release },
      volume: linToDb(cfg.melody.gain),
      portamento: 0.01,
    }).connect(this.melodyFilter);

    this.percGain = new Tone.Gain(cfg.percussionGain).toDestination();
    this.kick = new Tone.MembraneSynth({ octaves: 4, pitchDecay: 0.05 }).connect(this.percGain);
    const snareFilter = new Tone.Filter(1800, "highpass").connect(this.percGain);
    this.snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(snareFilter);
    const hatFilter = new Tone.Filter(7000, "highpass").connect(this.percGain);
    this.hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(hatFilter);

    this.built = true;
  }

  async start(): Promise<void> {
    if (this.running) return;
    await Tone.start();
    this.build();
    const transport = Tone.getTransport();
    transport.PPQ = TICKS_PER_QUARTER;
    transport.start();
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    this.running = false;
  }

  schedule(events: MusicalEvent[]): void {
    if (!this.built) this.build();
    const transport = Tone.getTransport();
    for (const e of events) {
      const at = `${e.time}i`;
      transport.schedule((time) => {
        const dur = Tone.Ticks(e.duration).toSeconds();
        this.trigger(e, time, dur);
      }, at);
    }
  }

  private trigger(e: MusicalEvent, time: number, dur: number): void {
    const vel = e.velocity;
    if (e.voice === "percussion") {
      switch (e.percussion) {
        case "kick":
          this.kick.triggerAttackRelease("C1", dur, time, vel);
          break;
        case "snare":
        case "tom":
          this.snare.triggerAttackRelease(Math.min(dur, 0.2), time, vel);
          break;
        default: // hat / shaker
          this.hat.triggerAttackRelease(Math.min(dur, 0.06), time, vel * 0.8);
          break;
      }
      return;
    }
    const note = Tone.Frequency(e.pitch, "midi").toNote();
    if (e.voice === "pad") this.padSynth.triggerAttackRelease(note, dur, time, vel);
    else if (e.voice === "bass") this.bassSynth.triggerAttackRelease(note, dur, time, vel);
    else if (e.voice === "melody") this.melodySynth.triggerAttackRelease(note, dur, time, vel);
  }

  setTempo(bpm: number): void {
    Tone.getTransport().bpm.rampTo(bpm, 0.5);
  }

  now(): number {
    return Tone.getTransport().ticks;
  }

  /** Map brightness (0–1) to filter cutoffs. Renderer-only parameter. */
  setBrightness(v: number): void {
    if (!this.built) return;
    const clamp = Math.max(0, Math.min(1, v));
    this.padFilter.frequency.rampTo(600 + clamp * 4000, 0.2);
    this.melodyFilter.frequency.rampTo(1200 + clamp * 6000, 0.2);
  }

  dispose(): void {
    if (!this.built) return;
    for (const node of [
      this.padSynth, this.padFilter, this.bassSynth, this.melodySynth, this.melodyFilter,
      this.kick, this.snare, this.hat, this.percGain, this.delay, this.reverb,
    ]) {
      node.dispose();
    }
    this.built = false;
  }
}

/** Linear gain (0–1) to decibels for Tone volume params. */
function linToDb(gain: number): number {
  return 20 * Math.log10(Math.max(0.0001, gain));
}

export function createToneRenderer(options?: ToneRendererOptions): ToneRenderer {
  return new ToneRenderer(options);
}
