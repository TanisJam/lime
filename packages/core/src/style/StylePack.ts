import type { Mode } from "../harmony/Scale.js";
import type { TransitionTable } from "../harmony/HarmonyRules.js";
import type { VoiceId } from "../events/MusicalEvent.js";

/**
 * A StylePack configures the musical world: which modes are allowed, the key,
 * phrase length, tempo range, and instrumentation. v0.1 ships exactly one
 * ("ambient-minimal"); the shape is deliberately small but leaves room to grow
 * without becoming a plugin ecosystem yet.
 */

export type Waveform = "sine" | "triangle" | "sawtooth" | "square";

/** Plain-data description of a pitched synth voice. Renderer-agnostic. */
export interface SynthVoiceConfig {
  readonly oscillator: Waveform;
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
  /** Low-pass cutoff in Hz, if the renderer supports filtering. */
  readonly filterCutoff?: number;
  /** Linear gain 0–1. */
  readonly gain: number;
  /**
   * Stereo pan -1 (hard left) .. 1 (hard right). Optional; a renderer supplies a
   * sensible per-voice default when omitted. Plain data — renderer-agnostic.
   */
  readonly pan?: number;
  /**
   * Reverb send 0..1 for this voice, scaled by the global {@link InstrumentationConfig.reverbWet}.
   * Optional; the renderer applies a tasteful per-voice default when omitted.
   */
  readonly reverbSend?: number;
  /**
   * Delay send 0..1 for this voice, scaled by the global {@link InstrumentationConfig.delayWet}.
   * Optional; defaults to 0 for most voices (the renderer favours melody).
   */
  readonly delaySend?: number;
}

/** Instrumentation hints consumed by a renderer (never by core logic). */
export interface InstrumentationConfig {
  readonly reverbWet: number;
  readonly reverbDecay: number;
  readonly delayWet: number;
  readonly pad: SynthVoiceConfig;
  readonly bass: SynthVoiceConfig;
  readonly melody: SynthVoiceConfig;
  /** Overall percussion gain 0–1. */
  readonly percussionGain: number;
  /**
   * Global stereo-width scale 0..1 applied to per-voice panning (1 = full width,
   * 0 = mono). Optional; defaults to 1 so existing packs are unaffected.
   */
  readonly stereoWidth?: number;
  /**
   * Master output gain 0..1 applied before the final limiter. Optional; a
   * renderer supplies a safe default (≈0.9) when omitted.
   */
  readonly masterGain?: number;
  /**
   * Reverb send 0..1 for the percussion bus, scaled by {@link reverbWet}.
   * Optional; the renderer keeps percussion mostly dry by default.
   */
  readonly percussionReverbSend?: number;
}

/** Optional corpus-derived harmony configuration for a style. */
export interface HarmonyStyle {
  /** Weighted chord transitions extracted from a corpus (falls back to defaults). */
  readonly transitions?: TransitionTable;
  /**
   * How much the progression resists returning to the tonic, 0..1. Higher values
   * down-weight the pull back to degree 1 from non-tonic chords, so the harmony
   * travels further before resolving instead of circling home every chord.
   * Cadence phrases still resolve to tonic. Default 0 (unchanged behaviour).
   */
  readonly harmonyMotion?: number;
}

/** Scale the melody snaps to. `diatonic` is the default 7-note behaviour. */
export type MelodyScale = "diatonic" | "minor-pentatonic" | "major-pentatonic" | "blues";

/** Optional corpus-derived melodic configuration. */
export interface MelodyStyle {
  /** Diatonic step interval → weight, shaping generated motif contours. */
  readonly intervalWeights?: Record<number, number>;
  /** Note-value name → weight, shaping generated motif rhythms. */
  readonly durationWeights?: Record<string, number>;
  /**
   * Probability (0..1) that a wide melodic leap is followed by a stepwise move
   * in the opposite direction — classic leap resolution. Default 0.7. Lower it
   * for a more angular, disjunct melodic character.
   */
  readonly leapResolution?: number;
  /**
   * Scale the realized melody snaps to. `minor-pentatonic` is the rock/blues
   * riff sound (no 2nd/6th tension notes). Default `diatonic` (unchanged).
   */
  readonly scale?: MelodyScale;
  /**
   * How much motifs are reshaped as they develop, 0..1. Higher values transform
   * the theme more in variation/development/cadence phrases (transpose, invert,
   * augment, fragment) and introduce new material more readily, so the melody
   * evolves instead of restating the same shape. The theme's plain statements
   * stay intact for recognizability. Default 0 (unchanged behaviour).
   */
  readonly motifDevelopment?: number;
}

/** A named groove feel the percussion generator can lock to. */
export type GrooveStyle =
  | "backbeat" // rock/pop/metal: kick 1&3, snare 2&4, straight 8th hats
  | "four-on-floor" // dance: kick every beat, offbeat open hats
  | "shuffle" // blues: swung 8ths, backbeat
  | "swing" // jazz: swung ride pattern, brushes
  | "boom-bap" // hip-hop: half-time-ish, swung, sampled feel
  | "funk" // R&B/funk: syncopated 16ths, ghost notes
  | "clave" // latin: son-clave organized
  | "none"; // no drum kit (classical/folk/ambient)

/** Optional corpus-derived rhythmic configuration. */
export interface RhythmStyle {
  /** Onset likelihood at each of 16 sixteenth positions per bar (0–1). */
  readonly onsetProfile?: number[];
  /**
   * A named groove the percussion locks to instead of the ambient grammar.
   * `"backbeat"` = steady kick on 1 & 3, snare on 2 & 4, straight 8th hats
   * (rock/pop). Omit for the default energy-driven grammar.
   */
  readonly groove?: GrooveStyle;
  /**
   * How much the named groove varies bar to bar, 0..1. Higher values add ghost
   * snares, extra kick syncopations, hat accents and phrase-end fills instead of
   * repeating one identical loop. The core pulse (kick/snare placement) stays
   * intact so the groove still reads. Default 0 (unchanged behaviour).
   */
  readonly grooveVariation?: number;
}

/** How chords are realized into pitches. */
export type ChordStyle = "triad" | "power" | "seventh";

/** The motion layer's pattern (arpeggio / ostinato / offbeat stabs). */
export type MotionStyle = "arp" | "ostinato" | "stab";

/** How the bass moves. */
export type BassStyle =
  | "default"
  | "root-drive" // doubled chord root in straight 8ths (rock/pop)
  | "walking" // quarter-note walking line through chord tones (jazz)
  | "sub" // sparse sustained sub-bass on the root (hip-hop/electronic 808)
  | "funk" // syncopated 16th root/octave with ghosts (funk/R&B)
  | "montuno"; // anticipated tumbao (latin)

/**
 * Optional per-genre shaping for a bass `BassStyle`'s own grammar — the
 * counterpart to {@link RhythmStyle} for the bass voice. `bassStyle` alone
 * picks the *grammar* a genre's bass plays, but two genres that share a
 * grammar still want to sit differently against the kick: a jazz walking
 * line and a blues walking line are structurally the same shape, yet blues
 * wants the pocket locked tight and quiet while jazz wants it breathing more
 * between the anchors it still lands squarely on (GROOVE-CRITERIA.md).
 *
 * `bassKickLock` and `bassOffbeat` pull against each other — landing on the
 * kick means landing on a structural beat, which by definition lowers the
 * off-beat share — so both knobs are given together rather than one derived
 * from the other. A style that wants both high lock and real off-beat
 * motion at once (jazz) gets there by leaning its off-anchor motion onto the
 * shared groove anchors (grooveAnchors.ts / PercussionGenerator's own extra
 * kick pushes) instead of spreading it evenly through the bar.
 */
export interface BassGrooveStyle {
  /**
   * 0..1: how much extra motion the line adds between its structural
   * anchors — walking bass's eighth-note skips/chromatic approach/sixteenth
   * pickup, root-drive's off-anchor eighths. Higher = busier, more
   * syncopated. Each `bassStyle` branch keeps its own default rate when this
   * is omitted, so an unconfigured genre's grammar is unaffected.
   */
  readonly syncopation?: number;
  /**
   * 0..1: how strongly that extra motion (and the anchors themselves) are
   * pulled onto the positions the groove's own kick actually plays —
   * including the kick's probabilistic extra hits (a backbeat's "and of 3"
   * push, a swing groove's dropped bombs), not just its structural anchors
   * (grooveAnchors.ts) — instead of spreading evenly through the bar. Higher
   * = tighter bass/kick interlock: fewer rests on the structural anchors,
   * and the off-anchor motion doubles a kick position rather than filling
   * space against it. Each branch keeps its own default balance when
   * omitted.
   */
  readonly kickLock?: number;
}

/** Energy thresholds at which a voice enters and leaves the arrangement. */
export interface VoiceGate {
  /** Energy at or above which an absent voice enters. */
  readonly on: number;
  /** Energy below which a present voice drops out. `on > off` is the hysteresis. */
  readonly off: number;
}

/** Per-voice entry thresholds — which forces this style's ensemble carries. */
export interface EnsembleStyle {
  readonly melody?: VoiceGate;
  readonly bass?: VoiceGate;
  readonly percussion?: VoiceGate;
}

/**
 * One voice's humanization knobs.
 *
 * Both fields are in **milliseconds**, not ticks, because a tick is a
 * different amount of time at 90 bpm than at 180 bpm — a style should sound
 * equally "loose" regardless of tempo, and only milliseconds hold that
 * constant. The {@link Humanizer} converts to ticks per bar, from the bar's
 * actual tempo, right before it applies them.
 */
export interface VoiceFeel {
  /**
   * Random microtiming jitter, as a standard deviation in ms, before the
   * humanizer scales it by the note's own duration (a sixteenth drifts less
   * than a whole note). `0` means perfectly quantised — the correct value for
   * a genre whose discriminator IS the grid (Electronic).
   */
  readonly jitterMs: number;
  /**
   * A signed, systematic bias in ms, applied before jitter. Positive = laid
   * back (behind the beat), negative = pushed (ahead of it). This is the
   * better-evidenced of the two timing components — human timing is not
   * white noise centered on the grid, it leans one way — which is why it is
   * a separate, deliberate constant rather than folded into the jitter.
   */
  readonly offsetMs: number;
}

/**
 * A genre's feel: per-voice microtiming plus how hard the metrical accent
 * bites. Lives on the StylePack, alongside groove/chordStyle/bassStyle,
 * because feel is a genre fact, not a generator implementation detail — the
 * same generator plays tight for Electronic and loose for Jazz purely by
 * being handed a different FeelStyle.
 */
export interface FeelStyle {
  /** Per-voice jitter/offset. A voice absent here is left unhumanized. */
  readonly voices: Partial<Record<VoiceId, VoiceFeel>>;
  /**
   * How strongly velocity follows metrical position, 0..1. `0` leaves the
   * generator's own dynamics untouched; `1` applies the full ~2:1
   * accented/unaccented swing (Räsänen et al. 2024). Applied multiplicatively
   * on top of whatever velocity the generator already chose, so a
   * generator's own dynamic decisions are shaped, not overwritten.
   */
  readonly accentDepth: number;
}

/**
 * The feel every style gets unless it declares its own — so humanization
 * improves every genre, not just the ones that opt in (GROOVE-CRITERIA.md).
 * Values sit around 40% of the real-human deviation the reference corpus
 * measures (≈5-7ms for melody/bass/pad, ≈4-6ms for percussion): Senn et al.
 * 2016 found perceived groove peaks near there and *falls* beyond roughly
 * 1.4-1.6x it, and Davies et al. 2013 found fully quantised versions rated
 * highest in most non-jazz genres. Deliberately well below the 9.6-19.2ms the
 * corpus itself shows — matching that magnitude was tried and the literature
 * says it would read as worse, not more human.
 */
export const DEFAULT_FEEL: FeelStyle = {
  voices: {
    pad: { jitterMs: 5, offsetMs: 0 },
    bass: { jitterMs: 6, offsetMs: 0 },
    melody: { jitterMs: 6, offsetMs: 0 },
    motion: { jitterMs: 6, offsetMs: 0 },
    percussion: { jitterMs: 5, offsetMs: 0 },
  },
  accentDepth: 0.6,
};

export interface StylePack {
  readonly id: string;
  /** Modes this style may use. */
  readonly modes: readonly Mode[];
  readonly defaultMode: Mode;
  /** Tonic pitch class 0–11. */
  readonly keyPc: number;
  readonly phraseLengthBars: 4 | 8;
  readonly tempoRange: readonly [number, number];
  readonly instrumentation: InstrumentationConfig;
  /** Optional corpus-derived harmony overrides. */
  readonly harmony?: HarmonyStyle;
  /** Optional corpus-derived melody overrides. */
  readonly melody?: MelodyStyle;
  /** Optional corpus-derived rhythm overrides. */
  readonly rhythm?: RhythmStyle;
  /**
   * How the harmonic bed realizes chords. `"power"` voices root+fifth(+octave)
   * power chords (rock/metal) instead of triads. Default `"triad"`.
   */
  readonly chordStyle?: ChordStyle;
  /**
   * How the bass moves. `"root-drive"` locks a driving straight-8th chord-root
   * pulse (rock, with the kick). Default `"default"` (the musical bass grammar).
   */
  readonly bassStyle?: BassStyle;
  /**
   * Per-genre shaping of that bass grammar's syncopation and kick-lock,
   * without changing `bassStyle` itself. Default (omitted) keeps the
   * grammar's own unconfigured behaviour.
   */
  readonly bassGroove?: BassGrooveStyle;
  /**
   * An extra motion layer — arpeggios (electronic/pop), ostinato/montuno (latin),
   * or offbeat comping stabs (funk/jazz). Omit for genres that don't want one.
   */
  readonly motion?: MotionStyle;
  /**
   * Which forces this style's ensemble carries: per-voice energy gates that
   * override the {@link Arrangement} default. A voice the style omits keeps the
   * default energy gate. Drum presence in particular is an ensemble fact — does
   * this genre's band have a drummer at all — not a loudness fact, which is why
   * it is declared here rather than derived from energy alone.
   */
  readonly ensemble?: EnsembleStyle;
  /**
   * Per-voice microtiming and velocity-accent humanization. Optional —
   * omitting it gets {@link DEFAULT_FEEL}, not silence, so every genre is
   * humanized by default. A style declares its own only to move away from
   * that default: looser (jazz/blues), tighter-with-drag (funk), or to
   * (near) zero, where zero is itself a genre decision (electronic).
   */
  readonly feel?: FeelStyle;
}
