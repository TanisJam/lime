/**
 * Per-genre General MIDI program map — the single source of truth for "which
 * instrument plays which voice in this genre".
 *
 * This module exists because the map used to live in **three** places at once and
 * they drifted, exactly as the tuning table did before `genreTuning.ts` absorbed
 * it:
 *
 *  - `tools/judge/genreTables.mjs` — what every offline render and every A/B
 *    listening test actually plays.
 *  - `apps/demo/src/fluidRenderer.ts` — the demo's live FluidSynth path.
 *  - `apps/demo/src/sampledGenre.ts` — the demo's sampled Tone path, which names
 *    its own local samples rather than GM programs.
 *
 * The drift was not cosmetic. Funk's melody was **GM 28 (Muted Electric Guitar)
 * in the judge table, pinned to the same patch as the pad**, while the live demo
 * played **GM 66 (Tenor Sax)** and the sampled path played a clean guitar. So Funk
 * has been listened to, judged and tuned through an instrument the demo never
 * plays — a short, percussive, palm-muted attack that a listener describes as
 * "too bright and chopped". Measured on the same script and soundfont, the judge's
 * Funk render carries a spectral centroid of ~2833–3010 Hz against ~1545 Hz for
 * Blues, which uses the *clean* guitar at GM 27.
 *
 * The aesthetic decision was already made and already correct — commit
 * `3d5372e` chose a warm clean guitar for the Funk melody (local
 * `electric_guitar_clean` samples, a 2800 Hz low-pass) and left the muted guitar
 * for the pad. That commit touched `sampledGenre.ts` and the Tone palettes and
 * could not reach the judge, because the judge renders from its own table. A
 * decision that lives in one consumer is not a decision.
 *
 * Both consumers import from here now, so this can drift again only by someone
 * deliberately re-adding a private copy. `test/gmPrograms.test.ts` guards the
 * contract that the drift violated.
 */

/**
 * GM program numbers used by LIME's genres, by name. Only the programs the
 * project actually assigns are listed; anything else renders as "program (GM n)".
 */
export const GM_PROGRAM_NAMES: Readonly<Record<number, string>> = {
  0: "Acoustic Grand Piano",
  4: "Electric Piano (Rhodes)",
  18: "Rock Organ",
  24: "Nylon Guitar",
  25: "Steel Guitar",
  27: "Clean Electric Guitar",
  28: "Muted Electric Guitar",
  29: "Overdriven Guitar",
  30: "Distortion Guitar",
  32: "Acoustic Bass",
  33: "Finger Electric Bass",
  38: "Synth Bass 1",
  40: "Violin",
  43: "Contrabass",
  48: "String Ensemble",
  56: "Trumpet",
  66: "Tenor Sax",
  73: "Flute",
  81: "Saw Lead",
  89: "Warm Pad",
};

/** The GM programs that behave as a plucked guitar, for interaction rules. */
export const GUITAR_PROGRAMS: readonly number[] = [24, 25, 27, 28, 29, 30];

/** One genre's instrument assignment, by voice. */
export interface GmProgramSet {
  readonly pad?: number;
  readonly bass?: number;
  readonly melody?: number;
  readonly motion?: number;
  /**
   * Cap the melody channel's brightness (MIDI CC74, 0–127) so a distorted lead
   * does not fizz on top. Only meaningful on the FluidSynth paths; the sampled
   * Tone path expresses the same idea as a low-pass cutoff.
   */
  readonly melodyCut?: number;
}

/**
 * The map. Keys are StylePack ids, matching `GENRE_PACKS` and the corpus-derived
 * `genre-rock-pop` pack.
 */
/**
 * Funk's melody is GM 27 (Clean Electric Guitar), not GM 28 (Muted).
 *
 * Two earlier decisions collided here and left the product with three different
 * melodies depending on the path:
 *
 *  - `5054d8a` (Sep 9) moved Funk's lead off GM 66 (Tenor Sax) because clips were
 *    "consistently heard as Jazz" — the sax-over-Rhodes combination is the
 *    jazz-quartet fingerprint. Its message says "mirrored in both tables", but it
 *    patched only `sampledGenre.ts` and this judge table; `fluidRenderer.ts` kept
 *    the sax from Sep 3, which is how the demo and the judge came to play
 *    different melodies for the same genre.
 *  - `3d5372e` (Sep 10) then replaced the *muted* guitar with a warm clean one on
 *    a listener's report that the muted patch was "too bright and strident", and
 *    that commit could not reach the judge either.
 *
 * The second decision is the later one and the only one made on the ear, so it
 * wins: clean guitar for the melody, muted guitar for the pad. GM 27 is also what
 * Blues uses, and Blues is one of the two classes that pass the judge's
 * per-class trust gates, so this is a timbre the project can actually measure.
 *
 * Note what that sweep did and did not establish. `31c79b1` reports that sweeping
 * eight lead programs for Funk "returns no winner at all", read as "Funk's problem
 * is not the lead timbre". That sweep scored candidates with the genre judge,
 * which `README.md` itself documents as scoring 25 % top-1 for Funk/R&B — an
 * instrument that cannot classify Funk cannot choose Funk's lead either. The
 * result is not evidence about how the lead *sounds* to a listener. This change is
 * therefore ear-led, and the A/B in `tools/judge/ab-listen.mjs` is what should
 * confirm it.
 */
export const GM_PROGRAMS: Readonly<Record<string, GmProgramSet>> = {
  "genre-classical": { melody: 40, pad: 48, bass: 43 },
  "genre-pop": { melody: 0, pad: 4, bass: 33, motion: 0 },
  "genre-rock-pop": { melody: 29, pad: 28, bass: 33, melodyCut: 66 },
  "genre-hiphop": { melody: 4, pad: 89, bass: 38, motion: 4 },
  "genre-jazz": { melody: 66, pad: 4, bass: 32, motion: 0 },
  "genre-blues": { melody: 27, pad: 4, bass: 33 },
  "genre-folk": { melody: 25, pad: 24, bass: 32 },
  "genre-latin": { melody: 56, pad: 0, bass: 33, motion: 24 },
  "genre-funk": { melody: 27, pad: 28, bass: 33, motion: 4 },
  "genre-metal": { melody: 30, pad: 30, bass: 33, melodyCut: 62 },
  "genre-electronic": { melody: 81, pad: 89, bass: 38, motion: 81 },
  "genre-ambient": { melody: 73, pad: 89 },
};

/** Human-readable name for a GM program number. */
export function gmProgramName(program: number | undefined): string | undefined {
  if (program === undefined) return undefined;
  return `${GM_PROGRAM_NAMES[program] ?? "program"} (GM ${program})`;
}
