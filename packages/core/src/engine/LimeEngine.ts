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
import { StateManager, type StateManagerSnapshot } from "../state/StateManager.js";
import { PhrasePlanner } from "../phrase/PhrasePlanner.js";
import { PhraseDirector } from "../phrase/PhrasePlan.js";
import { FormDirector } from "../phrase/FormDirector.js";
import { HarmonyPlanner, type HarmonyPlannerSnapshot } from "../harmony/HarmonyPlanner.js";
import { pitchClassName } from "../harmony/Scale.js";
import { chordLabel, chordRoman } from "../harmony/Chord.js";
import type { NoteEvent } from "../events/MusicalEvent.js";
import { humanizeBar } from "../humanize/Humanizer.js";
import { Orchestrator, type OrchestratorSnapshot } from "../orchestration/Orchestrator.js";
import {
  OrchestrationDirector,
  type OrchestrationDirectorSnapshot,
} from "../orchestration/OrchestrationDirector.js";
import type { OrchestrationPlan } from "../orchestration/OrchestrationPlan.js";
import { ROLE_FOR_VOICE } from "../orchestration/MusicalRole.js";
import { CompositionScheduler } from "../scheduler/CompositionScheduler.js";
import { DEFAULT_FEEL, type StylePack } from "../style/StylePack.js";
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
  /**
   * Begin (or resume) playback through the configured renderer.
   *
   * **Stop/start contract:** `stop()` halts the renderer but never resets the
   * composition — key, form position, motif memory, harmonic plan, and the
   * composed-ahead horizon all survive. A later `start()` resumes the *same*
   * piece from where it left off; it does not start a fresh piece at bar 0.
   * Internally this works by re-anchoring the renderer's clock (which most
   * renderers reset to tick 0 on `stop()`, e.g. `Tone.Transport.stop()`) onto
   * the composition's own timeline, and by re-sending whatever was already
   * composed but not yet played — `stop()` wipes the renderer's own schedule,
   * so that material would otherwise be lost rather than merely paused.
   * Calling `start()` while already running is a no-op; interleaving
   * `start()`/`stop()` never double-registers the internal pump timer.
   */
  start(): Promise<void>;
  /**
   * Halt the renderer. See {@link start} for what survives a subsequent
   * restart. Safe to call when not running (no-op).
   */
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

/**
 * A restorable capture of every mutable composition component, taken right
 * before `composeBar(bar)` runs. Restoring one puts the engine back exactly
 * where it was before that bar was composed, so `bar` (and everything after
 * it) can be recomposed from scratch under a new state — the mechanism behind
 * an `urgent` state change (see {@link StateChangeOptions.urgent}).
 *
 * Taking a snapshot only ever reads component state (see each `snapshot()`);
 * it never consumes RNG or mutates anything, so checkpointing has no effect on
 * composed output unless a checkpoint is later restored.
 */
interface CompositionCheckpoint {
  readonly bar: number;
  readonly stateManager: StateManagerSnapshot;
  readonly harmony: HarmonyPlannerSnapshot;
  readonly orchestrator: OrchestratorSnapshot;
  readonly orchestrationDirector: OrchestrationDirectorSnapshot;
  readonly lastComposedState: MusicalState;
  readonly lastCapture: BarCapture | undefined;
  readonly lastOrchestrationPlan: OrchestrationPlan | undefined;
  readonly lastScheduledTempo: number;
  readonly eventsByBar: ReadonlyMap<number, NoteEvent[]>;
  readonly tempoByBar: ReadonlyMap<number, number>;
}

/**
 * How far past the look-ahead horizon a checkpoint is still kept, so a
 * checkpoint remains available even if `resolveApplyBar`'s inertia or a
 * slightly stale playhead read pushes the urgent target a bar or two past
 * `composedThroughBar - lookAheadBars`. Checkpoints for bars behind that
 * window are pruned — they describe bars the playhead has moved past, which
 * an urgent change can no longer usefully target.
 */
const CHECKPOINT_MARGIN_BARS = 2;

/**
 * Minimum lead time, in beats, an `urgent` rollback leaves before the bar it
 * targets starts. Both shipped renderers need real lookahead to actually
 * sound a note handed to them this late: `ToneRenderer` schedules through
 * Tone.js's own `lookAhead` window and silently drops anything already past
 * it, and `FluidRenderer` times sequencer events off the same live
 * `AudioContext` clock. An urgent click landing in the last instants of the
 * current bar would otherwise hand either renderer a target bar that has
 * already started (or is about to) by the time it's scheduled — silence, not
 * a late note. One beat comfortably exceeds either renderer's own scheduling
 * latency at any tempo this engine supports.
 */
const URGENT_LEAD_BEATS = 1;

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
  private readonly orchestrationDirector: OrchestrationDirector;
  private readonly orchestrator: Orchestrator;
  private readonly scheduler: CompositionScheduler;
  /**
   * Dedicated RNG stream for humanization, derived once here so it never
   * perturbs the streams the voice generators themselves consume (see the
   * RNG architecture note in the handoff). A per-bar child is derived from
   * this in {@link composeBar}, matching the pattern used for `orchestration`
   * below.
   */
  private readonly humanizeRng: SeededRandom;

  private running = false;
  private pumpTimer: unknown = undefined;

  /**
   * Maps composition ticks (what `composeBar`/`eventsByBar`/checkpoints all
   * speak) onto the renderer's own clock: `rendererTick = compositionTick -
   * transportOffsetTicks`. Zero while the renderer's clock and the
   * composition timeline are still aligned (always true until the first
   * `stop()`); `start()` recomputes it so a restart resumes the composition
   * in progress instead of realigning it to bar 0 of a fresh piece — see the
   * `Lime.start` JSDoc for the full contract.
   */
  private transportOffsetTicks = 0;
  /**
   * The composition tick the playhead was at the moment `stop()` last ran —
   * i.e. where playback should resume from on the next `start()`. Read via
   * `toCompositionTick`, so it already accounts for whatever offset was in
   * effect at that moment (relevant after two `stop()`s without an
   * intervening reset).
   */
  private compositionTickAtStop = 0;

  private readonly eventsByBar = new Map<number, NoteEvent[]>();
  private readonly tempoByBar = new Map<number, number>();
  private lastScheduledTempo: number;
  private lastComposedState: MusicalState;
  private lastCapture: BarCapture | undefined;
  private lastOrchestrationPlan: OrchestrationPlan | undefined;

  /**
   * Checkpoints captured before composing each not-yet-played bar, keyed by
   * that bar. Bounded to roughly `lookAheadBars + CHECKPOINT_MARGIN_BARS`
   * entries (see {@link pruneCheckpoints}) — only bars still ahead of the
   * playhead are ever worth rolling back to.
   */
  private readonly checkpoints = new Map<number, CompositionCheckpoint>();

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
      harmonyMotion: this.style.harmony?.harmonyMotion,
    });
    this.orchestrationDirector = new OrchestrationDirector(this.style.ensemble);
    this.orchestrator = new Orchestrator(this.rng.derive("orchestration"), undefined, {
      melody: this.style.melody,
      rhythm: this.style.rhythm,
      chordStyle: this.style.chordStyle,
      bassStyle: this.style.bassStyle,
      bassGroove: this.style.bassGroove,
      motion: this.style.motion,
    });
    this.humanizeRng = this.rng.derive("humanize");

    this.scheduler = new CompositionScheduler({
      meter: this.meter,
      lookAheadBars: this.lookAheadBars,
      // Composition-space, not raw renderer ticks — see `transportOffsetTicks`.
      now: () => (this.renderer ? this.toCompositionTick(this.renderer.now()) : 0),
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
    // stop() may have run while the renderer was starting; don't re-anchor,
    // reschedule into a stopped renderer, or leave a live pump timer behind.
    if (!this.running) return;
    // Re-anchor composition ticks onto the renderer's (possibly just-reset)
    // clock so the composition resumes exactly where `stop()` left it — see
    // the `Lime.start` JSDoc for the contract this implements.
    this.transportOffsetTicks = this.compositionTickAtStop - this.renderer.now();
    // The renderer's own schedule was wiped by `stop()` (e.g.
    // `Tone.Transport.cancel()`); re-send whatever was already composed but
    // not yet played before topping up the horizon below.
    this.rescheduleUnplayedHorizon();
    // Fill the initial horizon immediately so playback has material.
    this.scheduler.pump();
    if (this.pumpTimer === undefined) {
      this.pumpTimer = timers.setInterval(() => this.pump(), this.pumpIntervalMs);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pumpTimer !== undefined) {
      timers.clearInterval(this.pumpTimer);
      this.pumpTimer = undefined;
    }
    if (this.renderer) {
      this.compositionTickAtStop = this.toCompositionTick(this.renderer.now());
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
    this.captureCheckpoint(bar);
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
    // Orchestration intent for the bar: which roles are active, their depth and
    // focus, and a shared activity budget. Mutates the director's hysteresis, so
    // it must run once per bar in order — exactly as composeBar is called.
    const orchestration = this.orchestrationDirector.plan(state, phrasePlan, formState);
    this.lastOrchestrationPlan = orchestration;

    const barStartTick = bar * ticksPerBar(this.meter);
    const rawEvents = this.orchestrator.composeBar({
      bar,
      barStartTick,
      meter: this.meter,
      state,
      chord,
      nextChord,
      phrase,
      phrasePlan,
      orchestration,
    });

    // Humanize here, at the single point every composed bar passes through on
    // its way out of the engine — not inside individual generators. That way
    // a future generator can't forget to humanize its output: it physically
    // cannot bypass this chokepoint. Uses its own derived RNG stream (see
    // `humanizeRng` above) so humanization never perturbs the generators'
    // own RNG sequences, keeping seeded output reproducible either way.
    const events = humanizeBar(rawEvents, this.style.feel ?? DEFAULT_FEEL, {
      barStartTick,
      meter: this.meter,
      tempo: state.tempo,
      rng: this.humanizeRng.derive(String(bar)),
    });

    this.orchestrator.memory.expireCommitments(bar);
    this.lastCapture = { bar, state, chord, phrase, events };

    // Bookkeeping (bounded) for debug and playhead-aligned tempo.
    this.eventsByBar.set(bar, events);
    this.tempoByBar.set(bar, state.tempo);
    this.pruneMaps(bar);

    if (this.renderer) this.renderer.schedule(this.shiftToRenderer(events));
    return events;
  }

  setState(patch: MusicalStatePatch, options: StateChangeOptions = {}): void {
    const durationBars = options.duration?.bars ?? 0;
    if (options.urgent && this.applyUrgent(patch, durationBars)) return;
    const applyAtBar = this.resolveApplyBar(options.quantize ?? "nextBar");
    this.stateManager.request(patch, applyAtBar, durationBars);
  }

  transitionTo(patch: MusicalStatePatch, options: StateChangeOptions): void {
    const durationBars = options.duration?.bars ?? 4;
    if (options.urgent && this.applyUrgent(patch, durationBars)) return;
    const applyAtBar = this.resolveApplyBar(options.quantize ?? "nextBar");
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
      ? Math.floor(this.toCompositionTick(this.renderer.now()) / ticksPerBar(this.meter))
      : this.scheduler.composedThroughBar;
  }

  /** Composition tick (what `eventsByBar`/checkpoints use) for a renderer tick. */
  private toCompositionTick(rendererTick: number): number {
    return rendererTick + this.transportOffsetTicks;
  }

  /** Renderer tick for a composition tick — the inverse of {@link toCompositionTick}. */
  private toRendererTick(compositionTick: number): number {
    return compositionTick - this.transportOffsetTicks;
  }

  /**
   * Translate already-composed events (composition-space ticks) into
   * renderer-space ticks before handing them to `renderer.schedule`. A no-op
   * (and identity-preserving) until the first `stop()`/`start()` cycle
   * introduces a non-zero offset.
   */
  private shiftToRenderer(events: NoteEvent[]): NoteEvent[] {
    if (this.transportOffsetTicks === 0) return events;
    return events.map((e) => ({ ...e, time: this.toRendererTick(e.time) }));
  }

  /**
   * Re-send bars that were already composed (and previously scheduled) but
   * hadn't played yet when `stop()` ran. `stop()` wipes the renderer's own
   * schedule, but composition itself isn't rewound — `composedThroughBar`
   * doesn't move — so these bars won't be recomposed on their own and would
   * otherwise be silently lost.
   */
  private rescheduleUnplayedHorizon(): void {
    if (!this.renderer) return;
    const fromBar = Math.floor(this.compositionTickAtStop / ticksPerBar(this.meter));
    const events: NoteEvent[] = [];
    for (let bar = Math.max(0, fromBar); bar < this.scheduler.composedThroughBar; bar++) {
      const barEvents = this.eventsByBar.get(bar);
      // Skip notes of the stop bar that were already heard before stop(): they
      // would map to negative renderer ticks and could fire as a burst.
      if (barEvents) events.push(...barEvents.filter((e) => e.time >= this.compositionTickAtStop));
    }
    if (events.length > 0) this.renderer.schedule(this.shiftToRenderer(events));
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

  /**
   * The `urgent` fast path: roll composition back to the bar right after the
   * playhead, discard whatever was already composed (and scheduled) from
   * there on, and recompose it under `patch`. Returns false when urgent isn't
   * possible — headless, a renderer without `cancelFrom`, or no checkpoint
   * that far back — so the caller falls back to the normal quantized path.
   */
  private applyUrgent(patch: MusicalStatePatch, durationBars: number): boolean {
    // Headless: nothing is composed ahead of the frontier in any meaningful
    // sense — composeThrough/step drive the frontier exactly at the caller's
    // own pace — so there is nothing to discard. A renderer that can't cancel
    // scheduled notes can't safely support urgent either, for the same reason
    // MusicRenderer.cancelFrom documents: it would risk a discarded bar's
    // notes staying scheduled alongside its recomposed replacement.
    const renderer = this.renderer;
    if (!renderer?.cancelFrom) return false;

    const playhead = this.playheadBar();
    let target = Math.max(
      playhead,
      Math.min(playhead + 1, this.scheduler.composedThroughBar),
    );
    // Not enough lead before `target`'s own downbeat (see URGENT_LEAD_BEATS)
    // — push out one more bar rather than hand the renderer a replacement it
    // can no longer schedule in time, which would otherwise play as silence.
    // Both sides of this comparison must be in renderer-space (`renderer.now()`
    // already is); see `transportOffsetTicks`.
    const leadTicks = URGENT_LEAD_BEATS * ticksPerBeat(this.meter);
    if (this.toRendererTick(target * ticksPerBar(this.meter)) - renderer.now() < leadTicks) {
      target += 1;
    }

    if (target < this.scheduler.composedThroughBar) {
      const checkpoint = this.checkpoints.get(target);
      if (!checkpoint) return false; // rolled off the bounded checkpoint window

      this.restoreCheckpoint(checkpoint);
      renderer.cancelFrom(this.toRendererTick(target * ticksPerBar(this.meter)));
      this.scheduler.rewindTo(target);

      // Every request issued after the checkpoint (see
      // `StateManager.requestsSince`) must survive the rollback too — it is
      // the user's word, just not the latest one. This is NOT the same set as
      // "still pending after the checkpoint": a request made while later bars
      // kept composing ahead of it can already have been applied — shifted
      // out of `pending` by `advanceToBar` at some bar inside the window we
      // just discarded — so it has to be read from the log, not `pending`.
      const carryOver = [
        ...checkpoint.stateManager.pending,
        ...this.stateManager.requestsSince(checkpoint.stateManager.seq),
      ];
      const urgentKeys = Object.keys(patch) as (keyof MusicalStatePatch)[];

      // Re-anchor each to at least `target` (never earlier) but otherwise
      // keep its own quantization — a deliberately far-out request (e.g.
      // nextPhrase) still lands there. Urgent is the newest intent, so a
      // request still due *after* target has its conflicting keys stripped
      // (dropped if that empties it) instead of reverting them once it fires.
      type Replay = { patch: MusicalStatePatch; applyAtBar: number; durationBars: number; seq: number; isUrgent?: true };
      const replayList: Replay[] = [];
      for (const entry of carryOver) {
        const applyAtBar = Math.max(entry.applyAtBar, target);
        let p = entry.patch;
        if (applyAtBar > target) {
          p = { ...entry.patch };
          for (const key of urgentKeys) delete p[key];
          if (Object.keys(p).length === 0) continue;
        }
        replayList.push({ patch: p, applyAtBar, durationBars: entry.durationBars, seq: entry.seq });
      }
      // Urgent sorts last among ties at `target` (sentinel seq), so the
      // merge-onto-latest-pending-target chain (`request`/`replay`) carries
      // its values into every later entry's merged target, not the reverse.
      replayList.push({ patch, applyAtBar: target, durationBars, seq: Number.MAX_SAFE_INTEGER, isUrgent: true });
      replayList.sort((a, b) => a.applyAtBar - b.applyAtBar || a.seq - b.seq);

      this.stateManager.clearPending();
      for (const entry of replayList) {
        if (entry.isUrgent) this.stateManager.request(entry.patch, entry.applyAtBar, entry.durationBars);
        else this.stateManager.replay(entry.patch, entry.applyAtBar, entry.durationBars);
      }
    } else {
      // Nothing has been composed for `target` (or beyond) yet, so there is
      // nothing to roll back — queuing the change already lands it on the
      // very next bar to be composed.
      this.stateManager.request(patch, target, durationBars);
    }
    this.scheduler.pump();
    return true;
  }

  /** Capture a checkpoint for the state right before `bar` is composed. */
  private captureCheckpoint(bar: number): void {
    this.checkpoints.set(bar, {
      bar,
      stateManager: this.stateManager.snapshot(),
      harmony: this.harmony.snapshot(),
      orchestrator: this.orchestrator.snapshot(),
      orchestrationDirector: this.orchestrationDirector.snapshot(),
      lastComposedState: this.lastComposedState,
      lastCapture: this.lastCapture,
      lastOrchestrationPlan: this.lastOrchestrationPlan,
      lastScheduledTempo: this.lastScheduledTempo,
      eventsByBar: new Map(this.eventsByBar),
      tempoByBar: new Map(this.tempoByBar),
    });
    this.pruneCheckpoints(bar);
  }

  /**
   * Keep only checkpoints for bars not yet played, bounded by the look-ahead,
   * and prune `stateManager`'s request log to match: nothing behind the
   * oldest checkpoint still held can ever be replayed by an `urgent` rollback
   * (see `StateManager.requestsSince`/`pruneLogBefore`), so it's safe to drop.
   */
  private pruneCheckpoints(bar: number): void {
    const cutoff = bar - (this.lookAheadBars + CHECKPOINT_MARGIN_BARS);
    for (const key of this.checkpoints.keys()) {
      if (key < cutoff) this.checkpoints.delete(key);
    }
    let oldestSeq: number | undefined;
    for (const checkpoint of this.checkpoints.values()) {
      if (oldestSeq === undefined || checkpoint.stateManager.seq < oldestSeq) {
        oldestSeq = checkpoint.stateManager.seq;
      }
    }
    if (oldestSeq !== undefined) this.stateManager.pruneLogBefore(oldestSeq);
  }

  /** Restore every mutable composition component to a captured checkpoint. */
  private restoreCheckpoint(checkpoint: CompositionCheckpoint): void {
    this.stateManager.restore(checkpoint.stateManager);
    this.harmony.restore(checkpoint.harmony);
    this.orchestrator.restore(checkpoint.orchestrator);
    this.orchestrationDirector.restore(checkpoint.orchestrationDirector);
    this.lastComposedState = checkpoint.lastComposedState;
    this.lastCapture = checkpoint.lastCapture;
    this.lastOrchestrationPlan = checkpoint.lastOrchestrationPlan;
    this.lastScheduledTempo = checkpoint.lastScheduledTempo;
    this.eventsByBar.clear();
    for (const [bar, events] of checkpoint.eventsByBar) this.eventsByBar.set(bar, events);
    this.tempoByBar.clear();
    for (const [bar, tempo] of checkpoint.tempoByBar) this.tempoByBar.set(bar, tempo);
    // Checkpoints for the bars we are about to recompose describe a future
    // that no longer exists; drop them so a later urgent change can't roll
    // back into stale, pre-rollback state.
    for (const bar of this.checkpoints.keys()) {
      if (bar >= checkpoint.bar) this.checkpoints.delete(bar);
    }
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
    const nowTick = this.renderer
      ? this.toCompositionTick(this.renderer.now())
      : bar * ticksPerBar(this.meter);
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
      activeVoices: [...this.orchestrationDirector.activeVoices],
      orchestrationPlan: this.lastOrchestrationPlan ?? null,
      focus: this.lastOrchestrationPlan?.focus ?? null,
      activeRoles: this.lastOrchestrationPlan
        ? [...this.lastOrchestrationPlan.activeRoles]
        : [...this.orchestrationDirector.activeVoices].map((v) => ROLE_FOR_VOICE[v]),
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
