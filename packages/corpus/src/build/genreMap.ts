/**
 * Genre labelling for the local ./midi collection.
 *
 * Genre is deterministic and comes from the path — composer/artist names in the
 * filename first (some folders mix Bach with Elton John), then folder rules,
 * then an honest `various` fallback for the numeric dumps that carry no signal.
 * `exclude` marks material to drop entirely (Black MIDI: pathological million-
 * note files that are not music to learn from).
 *
 * The token lists are deliberately broad but name-based: a piece is only as
 * classifiable as its filename. Anonymous dumps (`0.mid`, `K275.MID`) stay
 * `various` — better an honest unknown than a confident wrong label.
 */

export type Genre =
  | "classical"
  | "screen"
  | "rock-pop"
  | "pop"
  | "hyperpop"
  | "arabic"
  | "various"
  | "exclude";

// Composer surnames — distinctive, so classical wins even inside mixed folders.
const CLASSICAL =
  /bach|beethoven|mozart|chopin|liszt|schubert|brahms|handel|vivaldi|tchaikov|debussy|rachmanin|wagner|haydn|mendelssohn|schumann|grieg|satie|ravel|pachelbel|albeniz|scarlatti|strauss|dvorak|sibelius|holst|elgar|faure|saint-?saens|bizet|verdi|puccini|rossini|telemann|purcell|prokofiev|shostakov|mahler|bruckner|mussorgsky|borodin|rimsky|paganini|clementi|czerny|gluck|monteverdi|yamaha 50 greats/i;

// Film/TV themes — the extracted tv/movie folders, plus well-known titles.
const SCREEN =
  /tv_moviemidis|\btv2|\bmovie|\bfilm\b|soundtrack|\btheme\b|disney|braveheart|batman|superman|\bstar\s?wars\b|godfather|indiana|jurassic|titanic|lion king|aladdin|toy\s?story|zhivago|grinch|rocky\b|ghostbuster|mission\s?impossible|pink panther|\bpanther\b|simpsons|x-?files|seinfeld|\bfriends\b|hogansheroes|green\s?acres|greenacres|amadeus|full monty|fullmonty|colorpurple|edelweiss/i;

const ARABIC = /arabic|amr\s*diab/i;

const HYPERPOP =
  /midi collection|a\.?\s*g\.?\s*cook|gfoty|hannah diamond|danny l harle|easyfun|felicita|lil data|life sim|dux content|pc music/i;

// Rock / pop bands and artists (broad), plus the GROUPS* folders.
const ROCK_POP =
  /beatles|queen|elton|dwight yoakam|elvis|\babba\b|bee gees|dylan|zeppelin|pink floyd|\bfloyd\b|rolling stones|hendrix|bowie|eagles|fleetwood|aerosmith|nirvana|metallica|\bu2\b|black sabbath|\bsabbath\b|deep purple|genesis|springsteen|madonna|michael jackson|\bprince\b|\bsting\b|\bpolice\b|clapton|santana|journey|\bstyx\b|\btoto\b|\bdoors\b|\bkinks\b|\bcream\b|emerson\s?lake|\btarkus\b|fanfare_for_the_common|phil collins|billy joel|rod stewart|\bwho\b|van halen|guns\s?n|bon jovi|\boasis\b|radiohead|coldplay|\bgroups?\d*/i;

// The A# folder: pop chord-progression studies, tagged "[pop]".
const POP = /(?:^|\/)A#(?:\/|\s)|\[pop\]/i;

/** Ordered rules; the first whose pattern hits the full relative path wins. */
const RULES: ReadonlyArray<readonly [RegExp, Genre]> = [
  [/black\s*midi/i, "exclude"],
  [CLASSICAL, "classical"],
  [SCREEN, "screen"],
  [ARABIC, "arabic"],
  [HYPERPOP, "hyperpop"],
  [ROCK_POP, "rock-pop"],
  [POP, "pop"],
];

/** Genre for a path relative to the midi root. `exclude` = drop it. */
export function genreForPath(relPath: string): Genre {
  for (const [pattern, genre] of RULES) {
    if (pattern.test(relPath)) return genre;
  }
  return "various";
}
