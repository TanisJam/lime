/**
 * Phrase structure.
 *
 * Musical time is hierarchical: note < beat < bar < phrase < section. A phrase
 * is 4 or 8 bars and carries a role. Roles cycle through a simple grammar so the
 * structure keeps evolving instead of looping every few bars — recurrence of
 * *material* is handled by motif memory, not by repeating phrase shapes.
 */

export type PhraseRole = "statement" | "variation" | "development" | "cadence";

/** The grammar cycle. After a cadence, material returns transformed. */
export const PHRASE_GRAMMAR: readonly PhraseRole[] = [
  "statement",
  "variation",
  "development",
  "cadence",
];

export interface PhraseInfo {
  /** 0-based phrase index from the origin. */
  readonly phraseIndex: number;
  readonly role: PhraseRole;
  /** Absolute bar where the phrase starts. */
  readonly startBar: number;
  readonly lengthBars: number;
  /** 0-based position of the queried bar within the phrase. */
  readonly barInPhrase: number;
  /** True on the phrase's first bar. */
  readonly isStart: boolean;
  /** True on the phrase's last bar. */
  readonly isLastBar: boolean;
  /** True when this is a cadence phrase (harmony should resolve). */
  readonly isCadencePhrase: boolean;
}

export interface PhrasePlannerOptions {
  /** Bars per phrase. v0.1 supports 4 or 8. Default 4. */
  phraseLengthBars?: number;
}

export class PhrasePlanner {
  readonly phraseLengthBars: number;

  constructor(options: PhrasePlannerOptions = {}) {
    const len = options.phraseLengthBars ?? 4;
    if (len !== 4 && len !== 8) {
      throw new Error(`PhrasePlanner: phraseLengthBars must be 4 or 8, got ${len}`);
    }
    this.phraseLengthBars = len;
  }

  /** Phrase information for an absolute bar. */
  at(bar: number): PhraseInfo {
    const len = this.phraseLengthBars;
    const phraseIndex = Math.floor(bar / len);
    const startBar = phraseIndex * len;
    const barInPhrase = bar - startBar;
    const role = PHRASE_GRAMMAR[
      ((phraseIndex % PHRASE_GRAMMAR.length) + PHRASE_GRAMMAR.length) %
        PHRASE_GRAMMAR.length
    ] as PhraseRole;
    return {
      phraseIndex,
      role,
      startBar,
      lengthBars: len,
      barInPhrase,
      isStart: barInPhrase === 0,
      isLastBar: barInPhrase === len - 1,
      isCadencePhrase: role === "cadence",
    };
  }
}
