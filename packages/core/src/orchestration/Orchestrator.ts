import type { NoteEvent } from "../events/MusicalEvent.js";
import type { SeededRandom } from "../random/SeededRandom.js";
import { compareEvents } from "../events/MusicalEvent.js";
import { ComposerMemory } from "../memory/ComposerMemory.js";
import { PadGenerator } from "../pad/PadGenerator.js";
import { BassGenerator } from "../bass/BassGenerator.js";
import { MelodyGenerator } from "../melody/MelodyGenerator.js";
import { PercussionGenerator } from "../percussion/PercussionGenerator.js";
import type { BarContext } from "./BarContext.js";
import { ROLE_FOR_VOICE, type WiredVoice } from "./MusicalRole.js";
import type { MelodyStyle, RhythmStyle, ChordStyle } from "../style/StylePack.js";

/** BarContext without the per-voice RNG (filled in per voice by the orchestrator). */
export type BarContextBase = Omit<BarContext, "rng">;

/** Optional corpus-derived generator hints. */
export interface OrchestratorHints {
  readonly melody?: MelodyStyle;
  readonly rhythm?: RhythmStyle;
  /** How the pad realizes chords (triad vs power chords). */
  readonly chordStyle?: ChordStyle;
}

/**
 * Runs every voice generator for a bar and merges their events.
 *
 * Each voice gets its own hierarchical, bar-scoped RNG stream so that changing
 * one voice's logic does not perturb another's output (see RNG architecture in
 * the handoff). The shared {@link ComposerMemory} carries motifs and history.
 */
export class Orchestrator {
  readonly memory: ComposerMemory;

  private readonly pad: PadGenerator;
  private readonly bass = new BassGenerator();
  private readonly melody: MelodyGenerator;
  private readonly percussion: PercussionGenerator;

  private readonly padRng: SeededRandom;
  private readonly bassRng: SeededRandom;
  private readonly melodyRng: SeededRandom;
  private readonly percRng: SeededRandom;

  constructor(rng: SeededRandom, memory?: ComposerMemory, hints?: OrchestratorHints) {
    this.memory = memory ?? new ComposerMemory();
    this.padRng = rng.derive("pad");
    this.bassRng = rng.derive("bass");
    this.melodyRng = rng.derive("melodyBar");
    this.percRng = rng.derive("percussion");
    this.pad = new PadGenerator(hints?.chordStyle);
    this.melody = new MelodyGenerator(rng.derive("melodyMotif"), hints?.melody);
    this.percussion = new PercussionGenerator(hints?.rhythm);
  }

  /** Compose all voices for one bar, returning time-ordered events. */
  composeBar(base: BarContextBase): NoteEvent[] {
    const key = String(base.bar);
    const events: NoteEvent[] = [];

    // Which voices play is decided upstream by the OrchestrationDirector and
    // arrives as the active-role set on the plan; a voice runs when its role is
    // active. (The director still carries the energy-gated hysteresis, so the
    // set builds up and drops out gradually rather than flickering.)
    const roles = new Set(base.orchestration.activeRoles);
    const plays = (voice: WiredVoice): boolean => roles.has(ROLE_FOR_VOICE[voice]);

    if (plays("pad")) {
      events.push(...this.pad.generateBar({ ...base, rng: this.padRng.derive(key) }));
    }
    if (plays("bass")) {
      events.push(...this.bass.generateBar({ ...base, rng: this.bassRng.derive(key) }));
    }
    if (plays("melody")) {
      events.push(
        ...this.melody.generateBar({ ...base, rng: this.melodyRng.derive(key) }, this.memory),
      );
    }
    if (plays("percussion")) {
      events.push(...this.percussion.generateBar({ ...base, rng: this.percRng.derive(key) }));
    }

    // Record the chord once, at its start bar, for memory/debug.
    if (base.bar === base.chord.bar) this.memory.recordChord(base.chord);

    return events.sort(compareEvents);
  }
}
