import * as JSSynth from "js-synthesizer";
import type { MusicRenderer, MusicalEvent, VoiceId } from "@lime/core";
import { TICKS_PER_QUARTER } from "@lime/core";

/**
 * FluidRenderer — a MusicRenderer backed by FluidSynth compiled to WebAssembly
 * (js-synthesizer) playing a General-MIDI SoundFont. Each LIME voice maps to a
 * MIDI channel with a GM program (per genre); events are scheduled through
 * FluidSynth's own sequencer for tight timing. This replaces the per-note
 * Sampler playback with the real soundfont engine — one 30 MB SF2 gives every
 * genre proper instruments (distorted guitars, Rhodes, sax, strings, drums).
 *
 * Assets (served from public/): js-synth/libfluidsynth-2.4.6.js,
 * js-synth/js-synthesizer.worklet.js, soundfonts/GeneralUser-GS.sf2.
 */

/** LIME voice → MIDI channel (9 is the GM drum channel). */
const CHANNEL: Record<string, number> = { pad: 0, bass: 1, melody: 2, motion: 3, percussion: 9 };
const PITCHED = ["pad", "bass", "melody", "motion"] as const;

/** Per-voice GM program (0–127). Percussion always uses the drum bank on ch 9. */
export interface FluidPrograms {
  readonly pad?: number;
  readonly bass?: number;
  readonly melody?: number;
  readonly motion?: number;
}

type Seq = Awaited<ReturnType<JSSynth.AudioWorkletNodeSynthesizer["createSequencer"]>>;

export class FluidRenderer implements MusicRenderer {
  private readonly ctx: AudioContext;
  private synth: JSSynth.AudioWorkletNodeSynthesizer | null = null;
  private node: AudioWorkletNode | null = null;
  private seq: Seq | null = null;
  private clientId = -1;
  private sfontId = -1;
  private loaded = false;
  private running = false;

  // Clock: now() (LIME ticks) derived from the shared AudioContext time.
  private bpm = 100;
  private baseTicks = 0;
  private baseTime = 0;
  // Sequencer mapping: seq tick (ms) ↔ ctx time (tempo-independent).
  private ctxBaseTime = 0;
  private seqBaseTick = 0;

  private programs: FluidPrograms = {};
  private readonly muted: Record<string, boolean> = {};

  constructor() {
    // A native AudioContext (js-synthesizer's AudioWorkletNode needs a real
    // BaseAudioContext, not Tone's standardized-audio-context wrapper).
    this.ctx = new AudioContext();
  }

  private ticksPerSec(): number {
    return (this.bpm / 60) * TICKS_PER_QUARTER;
  }

  /** Set the genre's per-voice GM programs (applied on next start / immediately). */
  setGenrePrograms(p: FluidPrograms): void {
    this.programs = p;
    if (this.loaded) this.applyPrograms();
  }

  private applyPrograms(): void {
    const s = this.synth;
    if (!s) return;
    for (const v of PITCHED) {
      const prog = this.programs[v];
      if (prog !== undefined) s.midiProgramSelect(CHANNEL[v]!, this.sfontId, 0, prog);
    }
    s.midiProgramSelect(9, this.sfontId, 128, 0); // GM drum kit
    s.midiControl(CHANNEL.melody!, 10, 76); // pan melody slightly right
    s.midiControl(CHANNEL.motion!, 10, 52); // pan motion slightly left
    for (const v of Object.keys(CHANNEL)) s.midiControl(CHANNEL[v]!, 7, this.muted[v] ? 0 : 100);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.ctx.audioWorklet.addModule("/js-synth/libfluidsynth-2.4.6.js");
    await this.ctx.audioWorklet.addModule("/js-synth/js-synthesizer.worklet.js");
    const synth = new JSSynth.AudioWorkletNodeSynthesizer();
    synth.init(this.ctx.sampleRate);
    this.node = synth.createAudioNode(this.ctx);
    this.node.connect(this.ctx.destination);
    const sf2 = await fetch("/soundfonts/GeneralUser-GS.sf2").then((r) => r.arrayBuffer());
    this.sfontId = await synth.loadSFont(sf2);
    this.seq = await synth.createSequencer();
    this.clientId = await this.seq.registerSynthesizer(synth);
    this.synth = synth;
    this.loaded = true;
  }

  async start(): Promise<void> {
    await this.ctx.resume(); // resume from the user gesture (ENTER click)
    await this.ensureLoaded();
    this.seq!.removeAllEvents();
    this.allNotesOff();
    this.applyPrograms();
    this.baseTicks = 0;
    this.baseTime = this.ctx.currentTime;
    this.ctxBaseTime = this.ctx.currentTime;
    this.seqBaseTick = await this.seq!.getTick();
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    this.seq?.removeAllEvents();
    this.allNotesOff();
    this.running = false;
  }

  private allNotesOff(): void {
    if (!this.synth) return;
    for (const ch of [0, 1, 2, 3, 9]) this.synth.midiControl(ch, 123, 0);
  }

  now(): number {
    if (!this.loaded) return this.baseTicks;
    return this.baseTicks + (this.ctx.currentTime - this.baseTime) * this.ticksPerSec();
  }

  setTempo(bpm: number): void {
    this.baseTicks = this.now(); // re-anchor so now() stays continuous
    this.baseTime = this.ctx.currentTime;
    this.bpm = bpm;
  }

  schedule(events: MusicalEvent[]): void {
    if (!this.loaded || !this.seq) return;
    for (const e of events) {
      const ch = CHANNEL[e.voice];
      if (ch === undefined || this.muted[e.voice]) continue;
      const deltaTicks = e.time - this.now();
      const targetCtx = this.ctx.currentTime + deltaTicks / this.ticksPerSec();
      const seqTick = this.seqBaseTick + (targetCtx - this.ctxBaseTime) * 1000;
      if (seqTick < 0) continue;
      const vel = Math.max(1, Math.min(127, Math.round(e.velocity * 127)));
      const durMs = (e.duration / this.ticksPerSec()) * 1000;
      this.seq.sendEventToClientAt(
        this.clientId,
        { type: "noteon", channel: ch, key: e.pitch, vel } as unknown as JSSynth.SequencerEvent,
        Math.round(seqTick),
        true,
      );
      this.seq.sendEventToClientAt(
        this.clientId,
        { type: "noteoff", channel: ch, key: e.pitch } as unknown as JSSynth.SequencerEvent,
        Math.round(seqTick + Math.max(30, durMs)),
        true,
      );
    }
  }

  setBrightness(v: number): void {
    if (!this.synth) return;
    const c = Math.round(Math.max(0, Math.min(1, v)) * 127);
    for (const ch of [0, 1, 2, 3]) this.synth.midiControl(ch, 74, c);
  }

  setVoiceMuted(voice: VoiceId, muted: boolean): void {
    this.muted[voice] = muted;
    const ch = CHANNEL[voice];
    if (ch !== undefined && this.synth) this.synth.midiControl(ch, 7, muted ? 0 : 100);
  }

  dispose(): void {
    // Persistent singleton across genre switches — keep the loaded SoundFont.
  }
}

/** Per-genre GM program map (voice → GM program). Drums are automatic on ch 9. */
export const GM_PROGRAMS: Record<string, FluidPrograms> = {
  "genre-classical": { melody: 40, pad: 48, bass: 43 },
  "genre-pop": { melody: 0, pad: 4, bass: 33, motion: 0 },
  "genre-rock-pop": { melody: 29, pad: 29, bass: 33 },
  "genre-hiphop": { melody: 4, pad: 89, bass: 38, motion: 4 },
  "genre-jazz": { melody: 66, pad: 4, bass: 32, motion: 0 },
  "genre-blues": { melody: 27, pad: 18, bass: 33 },
  "genre-folk": { melody: 25, pad: 24, bass: 32 },
  "genre-latin": { melody: 56, pad: 0, bass: 33, motion: 24 },
  "genre-funk": { melody: 66, pad: 28, bass: 33, motion: 4 },
  "genre-metal": { melody: 30, pad: 30, bass: 33 },
  "genre-electronic": { melody: 81, pad: 89, bass: 38, motion: 81 },
  "genre-ambient": { melody: 73, pad: 89 },
};
