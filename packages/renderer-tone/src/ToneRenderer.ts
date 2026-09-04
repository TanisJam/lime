import * as Tone from "tone";
import {
  type MusicRenderer,
  type MusicalEvent,
  type InstrumentationConfig,
  type SynthVoiceConfig,
  type VoiceId,
  TICKS_PER_QUARTER,
} from "@lime/core";
import {
  type LimeInstrument,
  type InstrumentFactory,
  DEFAULT_INSTRUMENT_FACTORIES,
} from "./instruments.js";

export type { LimeInstrument, InstrumentFactory } from "./instruments.js";

/** Voices this renderer realizes (texture is not composed in v0.2). */
type MixVoice = Exclude<VoiceId, "texture">;
const MIX_VOICES: readonly MixVoice[] = ["pad", "bass", "melody", "motion", "percussion"];

const DEFAULT_INSTRUMENTATION: InstrumentationConfig = {
  reverbWet: 0.4,
  reverbDecay: 5,
  delayWet: 0.12,
  percussionGain: 0.55,
  stereoWidth: 1,
  masterGain: 0.9,
  percussionReverbSend: 0.2,
  pad: { oscillator: "sine", attack: 1.4, decay: 1, sustain: 0.75, release: 3, filterCutoff: 2200, gain: 0.42 },
  bass: { oscillator: "triangle", attack: 0.03, decay: 0.3, sustain: 0.6, release: 0.6, filterCutoff: 700, gain: 0.5 },
  melody: { oscillator: "triangle", attack: 0.06, decay: 0.4, sustain: 0.45, release: 0.9, filterCutoff: 3200, gain: 0.4 },
};

/**
 * Per-voice mix defaults (pan / reverb send / delay send). Used when a pack's
 * {@link SynthVoiceConfig} omits them, so every pack — including corpus JSON
 * packs written before these fields existed — sits together tastefully.
 */
const MIX_DEFAULTS: Record<MixVoice, { pan: number; reverbSend: number; delaySend: number }> = {
  pad: { pan: 0, reverbSend: 0.9, delaySend: 0 },
  bass: { pan: 0, reverbSend: 0.15, delaySend: 0 },
  melody: { pan: 0.25, reverbSend: 0.6, delaySend: 0.5 },
  motion: { pan: -0.25, reverbSend: 0.4, delaySend: 0.3 },
  percussion: { pan: 0, reverbSend: 0.2, delaySend: 0 },
};

/** One voice's mix chain: instrument → panner → mute-gain → dry + sends. */
interface VoiceChain {
  instrument: LimeInstrument;
  panner: Tone.Panner;
  gain: Tone.Gain; // mute gate
  baseGain: number; // unmuted target level
  reverbSend: Tone.Gain;
  delaySend: Tone.Gain;
  muted: boolean;
}

export interface ToneRendererOptions {
  instrumentation?: InstrumentationConfig;
  /**
   * Optional per-voice instrument factories. A voice with a custom factory uses
   * it; otherwise the built-in self-contained palette is used. This is how a
   * better instrument (e.g. a {@link Tone.Sampler}-based one with your own
   * samples) is plugged in later without touching `@lime/core`.
   */
  instruments?: Partial<Record<VoiceId, InstrumentFactory>>;
}

/**
 * Browser renderer for LIME built on Tone.js.
 *
 * Core emits tick-based symbolic events; this renderer maps them onto
 * Tone.Transport (whose PPQ is set to match {@link TICKS_PER_QUARTER}), so tempo
 * changes ramp smoothly and scheduling stays sample-accurate.
 *
 * Sound is made by pluggable {@link LimeInstrument}s (a warm, self-contained
 * synthesis palette by default). The renderer owns only the mix: one shared
 * reverb aux, one shared delay aux (favouring melody), a panner + mute-gain per
 * voice, and a master gain into a limiter. Chains are deliberately small — the
 * space comes from the shared aux, not from long per-voice effect stacks.
 *
 * Signal chain:
 *
 *   [instrument.output] → panner → gain(mute) ┬─────────────→ master ┐
 *                                             ├─ reverbSend → reverb ─┤
 *                                             └─ delaySend  → delay ──┘→ reverb
 *                                                                   master → limiter → destination
 */
export class ToneRenderer implements MusicRenderer {
  private readonly cfg: InstrumentationConfig;
  private readonly factories: Record<MixVoice, InstrumentFactory>;

  private reverb!: Tone.Reverb;
  private delay!: Tone.FeedbackDelay;
  private master!: Tone.Gain;
  private limiter!: Tone.Limiter;
  private chains!: Record<MixVoice, VoiceChain>;

  private built = false;
  private running = false;
  private brightness = 0.5;

  constructor(options: ToneRendererOptions = {}) {
    this.cfg = options.instrumentation ?? DEFAULT_INSTRUMENTATION;
    const custom = options.instruments ?? {};
    this.factories = {
      pad: custom.pad ?? DEFAULT_INSTRUMENT_FACTORIES.pad,
      bass: custom.bass ?? DEFAULT_INSTRUMENT_FACTORIES.bass,
      melody: custom.melody ?? DEFAULT_INSTRUMENT_FACTORIES.melody,
      motion: custom.motion ?? DEFAULT_INSTRUMENT_FACTORIES.motion,
      percussion: custom.percussion ?? DEFAULT_INSTRUMENT_FACTORIES.percussion,
    };
  }

  private build(): void {
    if (this.built) return;
    const cfg = this.cfg;

    // --- Master: gain → limiter → destination -----------------------------
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Gain(cfg.masterGain ?? 0.9).connect(this.limiter);

    // --- Shared aux sends (used fully-wet; amount set by per-voice sends) ---
    this.reverb = new Tone.Reverb({ decay: cfg.reverbDecay, preDelay: 0.02, wet: 1 }).connect(this.master);
    this.delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.28, wet: 1 }).connect(this.reverb);

    const width = cfg.stereoWidth ?? 1;

    this.chains = {} as Record<MixVoice, VoiceChain>;
    for (const voice of MIX_VOICES) {
      const voiceCfg: SynthVoiceConfig | undefined =
        voice === "percussion" || voice === "motion"
          ? undefined
          : (cfg[voice] as SynthVoiceConfig);
      const instrument = this.factories[voice](voiceCfg);

      const mix = MIX_DEFAULTS[voice];
      const pan = clampRange((voiceCfg?.pan ?? mix.pan) * width, -1, 1);
      const revAmount =
        voice === "percussion"
          ? (cfg.percussionReverbSend ?? mix.reverbSend)
          : (voiceCfg?.reverbSend ?? mix.reverbSend);
      const delAmount = voiceCfg?.delaySend ?? mix.delaySend;
      const baseGain = voice === "percussion" ? (cfg.percussionGain ?? 0.55) : 1;

      const panner = new Tone.Panner(pan);
      const gain = new Tone.Gain(baseGain);
      const reverbSend = new Tone.Gain(revAmount * (cfg.reverbWet ?? 0.4));
      const delaySend = new Tone.Gain(delAmount * (cfg.delayWet ?? 0.12));

      instrument.output.connect(panner);
      panner.connect(gain);
      gain.connect(this.master); // dry
      gain.connect(reverbSend);
      reverbSend.connect(this.reverb);
      gain.connect(delaySend);
      delaySend.connect(this.delay);

      this.chains[voice] = { instrument, panner, gain, baseGain, reverbSend, delaySend, muted: false };
    }

    this.built = true;
    this.applyBrightness(this.brightness);
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
    const chain = this.chains[e.voice as MixVoice];
    if (!chain) return; // e.g. texture — not realized in v0.2
    chain.instrument.triggerNote(e.pitch, e.velocity, time, dur);
  }

  setTempo(bpm: number): void {
    Tone.getTransport().bpm.rampTo(bpm, 0.5);
  }

  now(): number {
    return Tone.getTransport().ticks;
  }

  /** Map brightness (0–1) to per-instrument filter response. Renderer-only. */
  setBrightness(v: number): void {
    this.brightness = Math.max(0, Math.min(1, v));
    if (this.built) this.applyBrightness(this.brightness);
  }

  private applyBrightness(v: number): void {
    for (const voice of MIX_VOICES) this.chains[voice].instrument.setBrightness?.(v);
  }

  /**
   * Mute/unmute one voice by ramping its mix gain to 0 / its base level. Solo is
   * the demo's concern (solo = mute all others); this only does per-voice mute.
   */
  setVoiceMuted(voice: VoiceId, muted: boolean): void {
    const chain = this.chains?.[voice as MixVoice];
    if (!chain) return;
    chain.muted = muted;
    chain.gain.gain.rampTo(muted ? 0 : chain.baseGain, 0.08);
  }

  dispose(): void {
    if (!this.built) return;
    for (const voice of MIX_VOICES) {
      const c = this.chains[voice];
      c.instrument.dispose();
      c.panner.dispose();
      c.gain.dispose();
      c.reverbSend.dispose();
      c.delaySend.dispose();
    }
    this.delay.dispose();
    this.reverb.dispose();
    this.master.dispose();
    this.limiter.dispose();
    this.built = false;
  }
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function createToneRenderer(options?: ToneRendererOptions): ToneRenderer {
  return new ToneRenderer(options);
}
