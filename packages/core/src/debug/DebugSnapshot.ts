import type { MusicalState } from "../state/MusicalState.js";
import type { Mode } from "../harmony/Scale.js";
import type { NoteEvent } from "../events/MusicalEvent.js";
import type { PhraseInfo } from "../phrase/PhrasePlanner.js";
import type { PhrasePlan } from "../phrase/PhrasePlan.js";
import type { ArrangementVoice } from "../orchestration/Arrangement.js";
import type { OrchestrationPlan } from "../orchestration/OrchestrationPlan.js";
import type { MusicalRole } from "../orchestration/MusicalRole.js";
import type { FormSection } from "../phrase/FormDirector.js";

/** One planned chord, in a form convenient for a debug UI. */
export interface UpcomingChord {
  readonly bar: number;
  readonly durationBars: number;
  readonly degree: number;
  readonly roman: string;
  readonly label: string;
}

/**
 * A full inspectable picture of what the composer is doing right now. Returned
 * by `music.debug.snapshot()`; makes the demo debug panel (and future tooling)
 * possible.
 */
export interface DebugSnapshot {
  readonly bar: number;
  readonly beat: number;
  readonly bpm: number;

  readonly keyPc: number;
  readonly keyName: string;
  readonly mode: Mode;

  readonly chordRoman: string | null;
  readonly chordLabel: string | null;

  readonly phrase: PhraseInfo | null;
  /** The phrase-level gesture planned for the current bar (read-only view). */
  readonly phrasePlan: PhrasePlan | null;
  /** Voices currently in the arrangement (energy-driven, with hysteresis). */
  readonly activeVoices: readonly ArrangementVoice[];
  /**
   * The bar's orchestration intent (active roles, depth, focus, activity
   * budget). `null` before the first bar is composed. Internal machinery
   * surfaced read-only for the debug panel / perceptual harness.
   */
  readonly orchestrationPlan: OrchestrationPlan | null;
  /** The role the ear should follow this bar, or `null` before first compose. */
  readonly focus: MusicalRole | null;
  /** Active roles this bar (the role-level view of `activeVoices`). */
  readonly activeRoles: readonly MusicalRole[];

  readonly activeMotifId: string | null;
  readonly motifCount: number;

  readonly currentState: MusicalState;
  readonly targetState: MusicalState;
  /** Large-scale form: current section and its intensity envelope (0..1). */
  readonly formSection: FormSection;
  readonly formIntensity: number;

  readonly composedThroughBar: number;
  readonly upcomingHarmony: UpcomingChord[];
  readonly upcomingEvents: NoteEvent[];
}
