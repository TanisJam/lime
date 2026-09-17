import * as JSSynth from "js-synthesizer";
import type { MusicRenderer, MusicalEvent, VoiceId } from "@lime/core";
import { TICKS_PER_QUARTER } from "@lime/core";
import * as styles from "@lime/styles";

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
  /** Cap the melody channel's brightness (CC74, 0–127) so a distorted lead doesn't fizz on top. */
  readonly melodyCut?: number;
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

  /**
   * Every event actually sent to the sequencer (see `schedule()`), kept so
   * `cancelFrom()` can drop the not-yet-played ones and resend the
   * survivors. The sequencer API (js-synthesizer) has no per-event or
   * time-ranged cancel — only `removeAllEvents()` (everything) or
   * `removeAllEventsFromClient()` (still everything for this client, not
   * time-filtered) — so a selective cancel has to be built on top: wipe the
   * sequencer, then resend what should stay. See `cancelFrom()` for how a
   * survivor already mid-flight is resent (never as a fresh note-on).
   */
  private scheduledEvents: MusicalEvent[] = [];

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
    if (bpm === this.bpm) return;
    this.bpm = bpm;
    // Queued events were converted tick → ms at the tempo in force when they
    // were sent, up to the whole look-ahead window earlier. Left alone they
    // keep playing at the old tempo while newly sent bars use the new one, so
    // during a tempo ramp the two drift apart by whole beats (heard as out of
    // time and dissonant). Re-time everything still queued at the new tempo.
    this.resendTracked();
  }

  schedule(events: MusicalEvent[]): void {
    // Track only what is actually sent below — an event recorded here while
    // the synth isn't loaded yet would never reach the sequencer at all, so
    // cancelFrom() would "resend" it later as if it had really been playing.
    if (!this.loaded || !this.seq) return;
    this.scheduledEvents.push(...events);
    // Bounded bookkeeping: once an event's tick is well behind "now" it can
    // never again be a candidate for cancelFrom (which only ever targets bars
    // at or ahead of the playhead), so it is safe to forget. A fixed 8-bar
    // (4/4) window — tempo-independent, since ticks don't scale with bpm.
    const cutoff = this.now() - 8 * 4 * TICKS_PER_QUARTER;
    // Pruned by END tick: a resend wipes every queued note-off, so a long note
    // still sounding must stay tracked or it would hang.
    this.scheduledEvents = this.scheduledEvents.filter((e) => e.time + e.duration >= cutoff);
    for (const e of events) this.sendEvent(e);
  }

  /** LIME tick → js-synthesizer sequencer tick (ms since the sequencer clock's origin). */
  private toSeqTick(tick: number): number {
    const deltaTicks = tick - this.now();
    const targetCtx = this.ctx.currentTime + deltaTicks / this.ticksPerSec();
    return this.seqBaseTick + (targetCtx - this.ctxBaseTime) * 1000;
  }

  /** Send a fresh note-on/note-off pair for `e`, unless its start has already passed. */
  private sendEvent(e: MusicalEvent): void {
    const ch = CHANNEL[e.voice];
    if (ch === undefined || this.muted[e.voice] || !this.seq) return;
    const seqTick = Math.round(this.toSeqTick(e.time));
    if (seqTick < 0) return;
    const vel = Math.max(1, Math.min(127, Math.round(e.velocity * 127)));
    const durMs = (e.duration / this.ticksPerSec()) * 1000;
    const key = e.pitch;
    this.seq.sendEventToClientAt(
      this.clientId,
      { type: "noteon", channel: ch, key, vel } as unknown as JSSynth.SequencerEvent,
      seqTick,
      true,
    );
    this.seq.sendEventToClientAt(
      this.clientId,
      { type: "noteoff", channel: ch, key } as unknown as JSSynth.SequencerEvent,
      Math.round(seqTick + Math.max(30, durMs)),
      true,
    );
  }

  /**
   * Drop every scheduled event whose start tick is `>= tick` — used by an
   * urgent state change to discard composed-but-unplayed bars before their
   * recomposed replacement is scheduled.
   *
   * The underlying sequencer can only be cleared wholesale (see
   * `scheduledEvents` above): `removeAllEvents()` wipes every event still in
   * its queue, including the *pending note-off* of a survivor that is
   * already sounding (its note-on fired for real before this call — only the
   * note-off was still queued). Naively resending that survivor as a fresh
   * note-on/note-off pair would either re-trigger a note that never stopped,
   * or (the actual bug this fixes) get skipped outright because its note-on
   * time is already in the past — losing the note-off and hanging the voice
   * forever. So each survivor is resent by how far along it is: not started
   * yet → the normal pair; already sounding → only its note-off, at its
   * original time (or right now if even that has passed) and never a new
   * note-on; already finished → nothing to resend.
   */
  cancelFrom(tick: number): void {
    this.scheduledEvents = this.scheduledEvents.filter((e) => e.time < tick);
    this.resendTracked();
  }

  /**
   * Wipe the sequencer and resend every tracked event at the current tempo,
   * each by how far along it is (see `cancelFrom()`).
   */
  private resendTracked(): void {
    if (!this.loaded || !this.seq || !this.running) return;
    this.seq.removeAllEvents();
    const nowTick = this.now();
    for (const e of this.scheduledEvents) {
      if (e.time >= nowTick) {
        this.sendEvent(e);
        continue;
      }
      const endTick = e.time + e.duration;
      if (endTick <= nowTick) continue; // already finished — nothing pending to fix
      const ch = CHANNEL[e.voice];
      if (ch === undefined || this.muted[e.voice]) continue;
      const offTick = Math.max(Math.round(this.toSeqTick(endTick)), 0);
      this.seq.sendEventToClientAt(
        this.clientId,
        { type: "noteoff", channel: ch, key: e.pitch } as unknown as JSSynth.SequencerEvent,
        offTick,
        true,
      );
    }
  }

  setBrightness(v: number): void {
    if (!this.synth) return;
    const c = Math.round(Math.max(0, Math.min(1, v)) * 127);
    const melCut = this.programs.melodyCut;
    for (const ch of [0, 1, 2, 3]) {
      const cc = ch === CHANNEL.melody && melCut !== undefined ? Math.min(c, melCut) : c;
      this.synth.midiControl(ch, 74, cc);
    }
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

/**
 * Per-genre GM program map. The values live in `@lime/styles` as the single
 * source of truth so the judge's offline renders and this live path cannot
 * diverge — they once did, and Funk was listened to through an instrument the
 * demo never played. See `packages/styles/src/gmPrograms.ts`.
 */
export const GM_PROGRAMS: Record<string, FluidPrograms> = styles.GM_PROGRAMS as Record<
  string,
  FluidPrograms
>;