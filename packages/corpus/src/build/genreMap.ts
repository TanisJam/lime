/**
 * Genre labelling for the local ./midi collection.
 *
 * Genre is deterministic and comes from the path — composer/artist names in the
 * filename first (some folders mix Bach with Elton John), then folder rules,
 * then an honest `various` fallback for the numeric dumps that carry no signal.
 * `exclude` marks material to drop entirely (Black MIDI: pathological million-
 * note files that are not music to learn from).
 */

export type Genre =
  | "classical"
  | "rock-pop"
  | "pop"
  | "hyperpop"
  | "arabic"
  | "various"
  | "exclude";

/** Ordered rules; the first whose pattern hits the full relative path wins. */
const RULES: ReadonlyArray<readonly [RegExp, Genre]> = [
  [/black\s*midi/i, "exclude"],

  // Classical — composer names anywhere in the path, plus the piano-greats folder.
  [
    /bach|beethoven|mozart|chopin|liszt|schubert|brahms|handel|vivaldi|tchaikov|debussy|rachmanin|wagner|haydn|mendelssohn|schumann|grieg|satie|ravel|pachelbel|albeniz|scarlatti|yamaha 50 greats/i,
    "classical",
  ],

  // Arabic.
  [/arabic|amr\s*diab/i, "arabic"],

  // Hyperpop / PC Music (the MIDI Collection artists).
  [
    /midi collection|a\.?\s*g\.?\s*cook|gfoty|hannah diamond|danny l harle|easyfun|felicita|lil data|life sim|dux content|pc music/i,
    "hyperpop",
  ],

  // Rock / pop bands and artists.
  [/beatles|queen|\bgroups?\b|elton|dwight yoakam|elvis|abba|bee gees/i, "rock-pop"],

  // The A# folder: pop chord-progression studies, tagged "[pop]".
  [/(?:^|\/)A#(?:\/|\s)|\[pop\]/i, "pop"],
];

/** Genre for a path relative to the midi root. `exclude` = drop it. */
export function genreForPath(relPath: string): Genre {
  for (const [pattern, genre] of RULES) {
    if (pattern.test(relPath)) return genre;
  }
  return "various";
}
