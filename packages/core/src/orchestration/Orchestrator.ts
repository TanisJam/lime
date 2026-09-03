import type { NoteEvent } from "../events/MusicalEvent.js";
import type { SeededRandom } from "../random/SeededRandom.js";
import { compareEvents } from "../events/MusicalEvent.js";
import { ComposerMemory } from "../memory/ComposerMemory.js";
import { PadGenerator } from "../pad/PadGenerator.js";
import { BassGenerator } from "../bass/BassGenerator.js";
import { MelodyGenerator } from "../melody/MelodyGenerator.js";
import { PercussionGenerator } from "../percussion/PercussionGenerator.js";
import type { BarContext } from "./BarContext.js";
import { Arrangement } from "./Arrangement.js";
import type { MelodyStyle, RhythmStyle } from "../style/StylePack.js";

/** BarContext without the per-voice RNG (filled in per voice by the orchestrator). */
export type BarContextBase = Omit<BarContext, "rng">;

/** Optional corpus-derived generator hints. */
export interface OrchestratorHints {
  readonly melody?: MelodyStyle;
  readonly rhythm?: RhythmStyle;
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
  readonly arrangement = new Arrangement();

  private readonly pad = new PadGenerator();
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
    this.melody = new MelodyGenerator(rng.derive("melodyMotif"), hints?.melody);
    this.percussion = new PercussionGenerator(hints?.rhythm);
  }

  /** Compose all voices for one bar, returning time-ordered events. */
  composeBar(base: BarContextBase): NoteEvent[] {
    const key = String(base.bar);
    const events: NoteEvent[] = [];

    // Arrangement: energy decides which voices are present this bar, with
    // hysteresis so they build up and drop out gradually instead of flickering.
    const active = this.arrangement.update(base.state.energy);

    if (active.has("pad")) {
      events.push(...this.pad.generateBar({ ...base, rng: this.padRng.derive(key) }));
    }
    if (active.has("bass")) {
      events.push(...this.bass.generateBar({ ...base, rng: this.bassRng.derive(key) }));
    }
    if (active.has("melody")) {
      events.push(
        ...this.melody.generateBar({ ...base, rng: this.melodyRng.derive(key) }, this.memory),
      );
    }
    if (active.has("percussion")) {
      events.push(...this.percussion.generateBar({ ...base, rng: this.percRng.derive(key) }));
    }

    // Record the chord once, at its start bar, for memory/debug.
    if (base.bar === base.chord.bar) this.memory.recordChord(base.chord);

    return events.sort(compareEvents);
  }
}
