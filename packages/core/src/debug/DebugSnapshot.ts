import type { MusicalState } from "../state/MusicalState.js";
import type { Mode } from "../harmony/Scale.js";
import type { NoteEvent } from "../events/MusicalEvent.js";
import type { PhraseInfo } from "../phrase/PhrasePlanner.js";
import type { PhrasePlan } from "../phrase/PhrasePlan.js";

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

  readonly activeMotifId: string | null;
  readonly motifCount: number;

  readonly currentState: MusicalState;
  readonly targetState: MusicalState;

  readonly composedThroughBar: number;
  readonly upcomingHarmony: UpcomingChord[];
  readonly upcomingEvents: NoteEvent[];
}
