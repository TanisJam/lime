import type { NoteEvent } from "../events/MusicalEvent.js";
import type { SeededRandom } from "../random/SeededRandom.js";
import type { Meter } from "../time/MusicalTime.js";
import { TICKS_PER_QUARTER, ticksPerBar, ticksPerBeat } from "../time/MusicalTime.js";
import { clamp01 } from "../state/MusicalState.js";
import type { FeelStyle } from "../style/StylePack.js";

/**
 * Humanization layer — the one place composed events stop being perfectly
 * quantised.
 *
 * Per GROOVE-CRITERIA.md, "more jitter is not better": the goal is NOT to
 * match the 9.6-19.2ms real recordings measure, it is to land near 40% of
 * that (Senn et al. 2016), with the loosening applied as three separate,
 * evidence-led components rather than one blob of noise:
 *
 *  1. Random microtiming jitter — a bounded, roughly-Gaussian draw, scaled by
 *     the note's own duration (a sixteenth drifts less than a whole note).
 *  2. A systematic per-voice offset ("laid-back" / "pushed") — the
 *     better-evidenced component; human timing has a lean, not just spread.
 *  3. A metrical velocity accent — downbeats read louder than offbeats,
 *     applied multiplicatively on top of the generator's own dynamics.
 *
 * Pure and deterministic: same events + same FeelStyle + same RNG state
 * always produce the same output. Callers are responsible for handing this a
 * dedicated RNG stream (see {@link LimeEngine}) so humanization never
 * perturbs the sequences the voice generators themselves consume.
 */

/** Everything the humanizer needs beyond the events and the feel. */
export interface HumanizeContext {
  /** First tick of the bar being humanized — onsets never move before it. */
  readonly barStartTick: number;
  readonly meter: Meter;
  /** Tempo in quarter-note bpm, used to convert ms offsets/jitter to ticks. */
  readonly tempo: number;
  /** Dedicated RNG stream for this bar's humanization pass. */
  readonly rng: SeededRandom;
}

/** IOI scaling reference: a quarter note is "1x" jitter. */
const REFERENCE_DURATION_TICKS = TICKS_PER_QUARTER;
/**
 * Clamp the IOI scale factor so a very short grace note or a whole-bar pad
 * chord don't get displaced absurdly little or absurdly much — the point is
 * proportionality, not an unbounded multiplier (Repp-line findings, per
 * GROOVE-CRITERIA.md, are directional, not a licence to extrapolate).
 */
const MIN_IOI_SCALE = 0.4;
const MAX_IOI_SCALE = 1.6;

/** Metrical accent tiers: downbeat strongest, offbeat subdivision weakest. */
const DOWNBEAT_ACCENT = 1;
const ON_BEAT_ACCENT = 0.75;
const OFFBEAT_ACCENT = 0.5;

/** Convert a millisecond quantity to ticks at the bar's own tempo. */
function msToTicks(ms: number, tempoBpm: number): number {
  return (ms * TICKS_PER_QUARTER * tempoBpm) / 60000;
}

/**
 * A bounded, roughly-Gaussian unit-variance draw: the sum of three centered
 * uniform samples (Irwin-Hall via the CLT), not a single uniform draw — real
 * timing deviation clusters near zero rather than spreading flat. A single
 * centered uniform[-0.5, 0.5) has variance 1/12, so three sum to variance
 * 1/4 (SD 0.5); dividing by that SD normalizes the result to unit variance.
 */
function unitJitter(rng: SeededRandom): number {
  const raw = rng.next() - 0.5 + (rng.next() - 0.5) + (rng.next() - 0.5);
  return raw / 0.5;
}

/** Scale factor for microtiming jitter: proportional to the note's own IOI. */
function ioiScale(durationTicks: number): number {
  const raw = durationTicks / REFERENCE_DURATION_TICKS;
  return Math.min(MAX_IOI_SCALE, Math.max(MIN_IOI_SCALE, raw));
}

/**
 * Velocity multiplier for a note's metrical position: strongest on the
 * downbeat, weaker on the bar's other beats, weakest on offbeat subdivisions.
 * `depth` blends between "no accent" (1 everywhere) and the full swing, so a
 * style can dial the effect down without special-casing it.
 */
function metricalAccent(timeTicks: number, ctx: HumanizeContext, depth: number): number {
  if (depth <= 0) return 1;
  const barLen = ticksPerBar(ctx.meter);
  const beatLen = ticksPerBeat(ctx.meter);
  const posInBar = (((timeTicks - ctx.barStartTick) % barLen) + barLen) % barLen;
  const beatIndex = Math.floor(posInBar / beatLen);
  const tickInBeat = posInBar - beatIndex * beatLen;
  const base =
    tickInBeat !== 0 ? OFFBEAT_ACCENT : beatIndex === 0 ? DOWNBEAT_ACCENT : ON_BEAT_ACCENT;
  return 1 + depth * (base - 1);
}

/**
 * Humanize one bar's already-composed events. Called from exactly one place,
 * {@link LimeEngine.composeBar} — see the comment there for why that
 * placement is deliberate.
 */
export function humanizeBar(
  events: readonly NoteEvent[],
  feel: FeelStyle,
  ctx: HumanizeContext,
): NoteEvent[] {
  // One RNG stream per voice, derived lazily.
  //
  // Drawing every voice's jitter from a single shared stream would couple the
  // voices to each other: the events arrive sorted by time, so adding one
  // melody note shifts how much of the stream is consumed before a given
  // percussion hit and silently moves that hit's jitter. Editing the melody
  // would then perturb the drums' timing — and an A/B of one voice would show
  // phantom noise in all the others. Per-voice streams make each voice's feel
  // depend only on its own notes, which is also what "the drummer has their
  // own feel" means musically.
  const streams = new Map<string, SeededRandom>();
  const streamFor = (voice: string): SeededRandom => {
    let stream = streams.get(voice);
    if (!stream) {
      stream = ctx.rng.derive(voice);
      streams.set(voice, stream);
    }
    return stream;
  };

  return events.map((event) => {
    const accent = metricalAccent(event.time, ctx, feel.accentDepth);
    const velocity = clamp01(event.velocity * accent);
    const voiceFeel = feel.voices[event.voice];

    if (!voiceFeel || (voiceFeel.jitterMs === 0 && voiceFeel.offsetMs === 0)) {
      return velocity === event.velocity ? event : { ...event, velocity };
    }

    const offsetTicks = msToTicks(voiceFeel.offsetMs, ctx.tempo);
    const jitterTicks =
      voiceFeel.jitterMs > 0
        ? msToTicks(voiceFeel.jitterMs * ioiScale(event.duration), ctx.tempo) *
          unitJitter(streamFor(event.voice))
        : 0;

    // Never let humanization move an onset before the bar starts (matches
    // MelodyGenerator's own jitter guard).
    const time = Math.max(ctx.barStartTick, Math.round(event.time + offsetTicks + jitterTicks));

    return { ...event, time, velocity };
  });
}
