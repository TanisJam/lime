import { SeededRandom } from "../random/SeededRandom.js";
import {
  type Meter,
  FOUR_FOUR,
  ticksPerBar,
  ticksPerBeat,
} from "../time/MusicalTime.js";
import {
  type MusicalState,
  type MusicalStatePatch,
  type StateChangeOptions,
  DEFAULT_STATE,
  applyPatch,
  clampTempo,
  clamp01,
} from "../state/MusicalState.js";
import { StateManager } from "../state/StateManager.js";
import { PhrasePlanner } from "../phrase/PhrasePlanner.js";
import { PhraseDirector } from "../phrase/PhrasePlan.js";
import { FormDirector } from "../phrase/FormDirector.js";
import { HarmonyPlanner } from "../harmony/HarmonyPlanner.js";
import { pitchClassName } from "../harmony/Scale.js";
import { chordLabel, chordRoman } from "../harmony/Chord.js";
import type { NoteEvent } from "../events/MusicalEvent.js";
import { Orchestrator } from "../orchestration/Orchestrator.js";
import { CompositionScheduler } from "../scheduler/CompositionScheduler.js";
import type { StylePack } from "../style/StylePack.js";
import type { MusicRenderer } from "./MusicRenderer.js";
import type { DebugSnapshot, UpcomingChord } from "../debug/DebugSnapshot.js";
import type { BarCapture, CompositionCapture } from "../analysis/types.js";

export interface LimeConfig {
  readonly seed: string | number;
  readonly style: StylePack;
  readonly renderer?: MusicRenderer;
  readonly initialState?: MusicalStatePatch;
  readonly meter?: Meter;
  /** Bars kept composed ahead of the playhead. Default 4. */
  readonly lookAheadBars?: number;
  /** Override the style's key. */
  readonly keyPc?: number;
  /** Smoothing rate for `setState` easing (0–1). Default 0.25. */
  readonly easingPerBar?: number;
  /** How often the composition horizon is advanced, in ms. Default 100. */
  readonly pumpIntervalMs?: number;
}

/** Public engine surface. */
export interface Lime {
  start(): Promise<void>;
  stop(): void;
  setState(patch: MusicalStatePatch, options?: StateChangeOptions): void;
  transitionTo(patch: MusicalStatePatch, options: StateChangeOptions): void;
  readonly isRunning: boolean;
  readonly debug: { snapshot(): DebugSnapshot };
  /** Compose (and schedule) one bar directly. Mainly for headless/tests. */
  composeBar(bar: number): NoteEvent[];
  /** Advance the composition horizon once. */
  pump(): void;
  /** Compose forward through a bar without a renderer (headless/tests). */
  composeThrough(bar: number): void;
  /** Compose the next bar and return its capture (headless analysis/sweeps). */
  step(): BarCapture;
  /** Compose `bars` bars headlessly and return a capture for analysis. */
  captureComposition(bars: number): CompositionCapture;
  /** Assemble a capture from bars already produced by `step()`. */
  buildCapture(bars: BarCapture[]): CompositionCapture;
}

const RECENT_EVENT_BARS = 8;

/** How strongly the form's arch swings the effective energy around the host's. */
const FORM_SPREAD = 0.7;

/**
 * How strongly the form's arch swings harmonic tension — a smaller amount than
 * the energy swing, so the harmony ventures out and comes home without ever
 * losing the plot.
 */
const HARM_SPREAD = 0.35;

/**
 * Portable timer access. Core must not assume DOM or Node lib types, but both
 * environments (and Web Workers) expose these on `globalThis`. Hosts that would
 * rather drive composition themselves can ignore the timer and call `pump()`.
 */
const timers = globalThis as unknown as {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
};

export class LimeEngine implements Lime {
  private readonly rng: SeededRandom;
  private readonly meter: Meter;
  private readonly lookAheadBars: number;
  private readonly pumpIntervalMs: number;
  private readonly style: StylePack;
  private readonly renderer: MusicRenderer | undefined;

  private readonly stateManager: StateManager;
  private readonly phrases: PhrasePlanner;
  private readonly director: PhraseDirector;
  private readonly form: FormDirector;
  private readonly harmony: HarmonyPlanner;
  private readonly orchestrator: Orchestrator;
  private readonly scheduler: CompositionScheduler;

  private running = false;
  private pumpTimer: unknown = undefined;

  private readonly eventsByBar = new Map<number, NoteEvent[]>();
  private readonly tempoByBar = new Map<number, number>();
  private lastScheduledTempo: number;
  private lastComposedState: MusicalState;
  private lastCapture: BarCapture | undefined;

  constructor(config: LimeConfig) {
    this.rng = new SeededRandom(config.seed);
    this.meter = config.meter ?? FOUR_FOUR;
    this.lookAheadBars = config.lookAheadBars ?? 4;
    this.pumpIntervalMs = config.pumpIntervalMs ?? 100;
    this.style = config.style;
    this.renderer = config.renderer;

    const initialTempo = clampTempo(
      config.initialState?.tempo ??
        (this.style.tempoRange[0] + this.style.tempoRange[1]) / 2,
    );
    const initial = applyPatch(DEFAULT_STATE, {
      ...config.initialState,
      tempo: initialTempo,
    });

    this.stateManager = new StateManager(initial, config.easingPerBar ?? 0.25);
    this.lastComposedState = initial;
    this.lastScheduledTempo = initial.tempo;

    this.phrases = new PhrasePlanner({
      phraseLengthBars: this.style.phraseLengthBars,
    });
    this.director = new PhraseDirector();
    this.form = new FormDirector();
    this.harmony = new HarmonyPlanner({
      rng: this.rng.derive("harmony"),
      phrasePlanner: this.phrases,
      keyPc: config.keyPc ?? this.style.keyPc,
      mode: this.style.defaultMode,
      transitions: this.style.harmony?.transitions,
    });
    this.orchestrator = new Orchestrator(this.rng.derive("orchestration"), undefined, {
      melody: this.style.melody,
      rhythm: this.style.rhythm,
    });

    this.scheduler = new CompositionScheduler({
      meter: this.meter,
      lookAheadBars: this.lookAheadBars,
      now: () => (this.renderer ? this.renderer.now() : 0),
      composeBar: (bar) => {
        this.composeBar(bar);
      },
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.renderer) {
      throw new Error("LimeEngine.start requires a renderer; use composeThrough for headless.");
    }
    this.running = true;
    this.renderer.setTempo(this.stateManager.currentState.tempo);
    await this.renderer.start();
    // Fill the initial horizon immediately so playback has material.
    this.scheduler.pump();
    this.pumpTimer = timers.setInterval(() => this.pump(), this.pumpIntervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pumpTimer !== undefined) {
      timers.clearInterval(this.pumpTimer);
      this.pumpTimer = undefined;
    }
    this.renderer?.stop();
  }

  pump(): void {
    this.scheduler.pump();
    this.applyPlayheadTempo();
  }

  composeThrough(bar: number): void {
    this.scheduler.composeThrough(bar);
  }

  /**
   * Compose the next bar and return its full capture (state, chord, phrase,
   * events). Advances the composition frontier so `setState`/`transitionTo`
   * quantization resolves correctly while stepping headlessly.
   */
  step(): BarCapture {
    const bar = this.scheduler.composedThroughBar;
    this.scheduler.composeThrough(bar);
    return this.lastCapture!;
  }

  /**
   * Compose `bars` bars headlessly and return a capture for analysis. Intended
   * for a fresh engine; drive state changes between `step()` calls if you need a
   * sweep instead.
   */
  captureComposition(bars: number): CompositionCapture {
    const collected: BarCapture[] = [];
    for (let i = 0; i < bars; i++) collected.push(this.step());
    return this.buildCapture(collected);
  }

  /** Assemble a capture from already-composed bars (e.g. from `step()`). */
  buildCapture(bars: BarCapture[]): CompositionCapture {
    return {
      keyPc: this.harmony.keyPc,
      mode: this.harmony.mode,
      meter: this.meter,
      phraseLengthBars: this.phrases.phraseLengthBars,
      bars,
      motifUsage: [...this.orchestrator.memory.usageLog],
      motifCount: this.orchestrator.memory.motifs.length,
    };
  }

  /**
   * Compose one bar: advance state, resolve harmony, run the orchestrator,
   * schedule the events, and bookkeep for debug/tempo.
   */
  composeBar(bar: number): NoteEvent[] {
    this.stateManager.advanceToBar(bar);
    const hostState = this.stateManager.currentState;
    // The form's slow arch shapes the effective state the composer works from,
    // so the piece builds and releases over minutes. Harmony stays on the host's
    // emotional state — the form shapes intensity/structure, not the mood.
    const formState = this.form.at(bar, this.phrases.phraseLengthBars);
    const state = this.applyForm(hostState, formState.deviation);
    this.lastComposedState = state;

    // Ensure this bar and the next are planned (next is used for anticipation).
    // The form gives harmony a journey too: chords venture away from the tonic
    // through the development and climax, and settle home in the recap and coda.
    this.harmony.ensurePlannedThrough(bar + 1, this.applyFormToHarmony(hostState, formState.deviation));
    const chord = this.harmony.chordAt(bar)!;
    const nextChord = this.harmony.chordAt(bar + 1);
    const phrase = this.phrases.at(bar);
    const phrasePlan = this.director.plan(state, phrase);

    const events = this.orchestrator.composeBar({
      bar,
      barStartTick: bar * ticksPerBar(this.meter),
      meter: this.meter,
      state,
      chord,
      nextChord,
      phrase,
      phrasePlan,
    });

    this.orchestrator.memory.expireCommitments(bar);
    this.lastCapture = { bar, state, chord, phrase, events };

    // Bookkeeping (bounded) for debug and playhead-aligned tempo.
    this.eventsByBar.set(bar, events);
    this.tempoByBar.set(bar, state.tempo);
    this.pruneMaps(bar);

    if (this.renderer) this.renderer.schedule(events);
    return events;
  }

  setState(patch: MusicalStatePatch, options: StateChangeOptions = {}): void {
    const applyAtBar = this.resolveApplyBar(options.quantize ?? "nextBar");
    const durationBars = options.duration?.bars ?? 0;
    this.stateManager.request(patch, applyAtBar, durationBars);
  }

  transitionTo(patch: MusicalStatePatch, options: StateChangeOptions): void {
    const applyAtBar = this.resolveApplyBar(options.quantize ?? "nextBar");
    const durationBars = options.duration?.bars ?? 4;
    this.stateManager.request(patch, applyAtBar, durationBars);
  }

  readonly debug = {
    snapshot: (): DebugSnapshot => this.snapshot(),
  };

  // --- internals -----------------------------------------------------------

  /**
   * Shape the host state by the form's intensity deviation. Gated by host energy
   * so a deliberately near-silent passage is left untouched — the form only
   * carves a journey once there's energy to work with — and applied to energy
   * (and, more gently, density) so the arc drives the whole texture.
   */
  private applyForm(host: MusicalState, deviation: number): MusicalState {
    const gate = clamp01((host.energy - 0.15) / 0.2);
    const shift = deviation * FORM_SPREAD * gate;
    if (shift === 0) return host;
    return {
      ...host,
      energy: clamp01(host.energy + shift),
      density: clamp01(host.density + shift * 0.6),
    };
  }

  /**
   * Shape harmonic adventurousness by the form: the development and climax lift
   * tension (chords wander from the tonic), the recap and coda lower it (home).
   * Gated by host energy so a deliberately calm passage keeps its simple harmony.
   */
  private applyFormToHarmony(host: MusicalState, deviation: number): MusicalState {
    const gate = clamp01((host.energy - 0.15) / 0.2);
    const shift = deviation * HARM_SPREAD * gate;
    if (shift === 0) return host;
    return {
      ...host,
      tension: clamp01(host.tension + shift),
      instability: clamp01(host.instability + shift * 0.5),
    };
  }

  private playheadBar(): number {
    return this.renderer
      ? Math.floor(this.renderer.now() / ticksPerBar(this.meter))
      : this.scheduler.composedThroughBar;
  }

  private resolveApplyBar(quantize: string): number {
    const playhead = this.playheadBar();
    const len = this.phrases.phraseLengthBars;
    let boundary: number;
    switch (quantize) {
      case "nextPhrase":
        boundary = (Math.floor(playhead / len) + 1) * len;
        break;
      case "nextBar":
        boundary = playhead + 1;
        break;
      default: // immediate / nextBeat
        boundary = playhead;
    }
    // Committed (already composed) bars are frozen; apply at the earliest
    // uncommitted bar at the latest. This is the parameter-level inertia.
    return Math.max(boundary, this.scheduler.composedThroughBar);
  }

  private applyPlayheadTempo(): void {
    if (!this.renderer) return;
    const bar = this.playheadBar();
    const tempo = this.tempoByBar.get(bar);
    if (tempo !== undefined && Math.abs(tempo - this.lastScheduledTempo) > 0.4) {
      this.renderer.setTempo(tempo);
      this.lastScheduledTempo = tempo;
    }
  }

  private pruneMaps(bar: number): void {
    const cutoff = bar - RECENT_EVENT_BARS;
    for (const key of this.eventsByBar.keys()) {
      if (key < cutoff) this.eventsByBar.delete(key);
    }
    for (const key of this.tempoByBar.keys()) {
      if (key < cutoff - 4) this.tempoByBar.delete(key);
    }
  }

  private snapshot(): DebugSnapshot {
    const bar = this.playheadBar();
    const nowTick = this.renderer ? this.renderer.now() : bar * ticksPerBar(this.meter);
    const beat = Math.floor(
      (nowTick - bar * ticksPerBar(this.meter)) / ticksPerBeat(this.meter),
    );
    const state = this.stateManager.currentState;
    const form = this.form.at(bar, this.phrases.phraseLengthBars);

    const chord = this.harmony.chordAt(bar);
    const upcoming = this.harmony.upcoming(bar, 8, state);
    const upcomingHarmony: UpcomingChord[] = upcoming.map((c) => ({
      bar: c.bar,
      durationBars: c.durationBars,
      degree: c.degree,
      roman: chordRoman(c),
      label: chordLabel(c),
    }));

    const recentMotifs = this.orchestrator.memory.recentMotifIds;
    const activeMotifId = recentMotifs[recentMotifs.length - 1] ?? null;

    const upcomingEvents: NoteEvent[] = [];
    for (let b = bar; b < bar + 4; b++) {
      const evts = this.eventsByBar.get(b);
      if (evts) upcomingEvents.push(...evts);
    }

    return {
      bar,
      beat,
      bpm: state.tempo,
      keyPc: this.harmony.keyPc,
      keyName: pitchClassName(this.harmony.keyPc),
      mode: this.harmony.mode,
      chordRoman: chord ? chordRoman(chord) : null,
      chordLabel: chord ? chordLabel(chord) : null,
      phrase: this.phrases.at(bar),
      phrasePlan: this.director.plan(state, this.phrases.at(bar)),
      activeVoices: [...this.orchestrator.arrangement.current],
      activeMotifId,
      motifCount: this.orchestrator.memory.motifs.length,
      currentState: state,
      targetState: this.stateManager.targetState,
      formSection: form.section,
      formIntensity: form.intensity,
      composedThroughBar: this.scheduler.composedThroughBar,
      upcomingHarmony,
      upcomingEvents,
    };
  }
}

/** Factory — the public entry point. */
export function createLime(config: LimeConfig): Lime {
  return new LimeEngine(config);
}
