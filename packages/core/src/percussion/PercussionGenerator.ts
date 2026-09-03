import {
  type NoteEvent,
  type PercussionSound,
  PERCUSSION_MIDI,
} from "../events/MusicalEvent.js";
import { ticksPerBeat, ticksPerBar } from "../time/MusicalTime.js";
import { clamp01 } from "../state/MusicalState.js";
import type { BarContext } from "../orchestration/BarContext.js";
import type { RhythmStyle, GrooveStyle } from "../style/StylePack.js";

/**
 * Percussion voice — abstract kick/snare/hat from a small rhythmic grammar.
 *
 * Energy strongly drives density: below a threshold percussion disappears
 * entirely (valid for ambient/minimal). Complexity and instability add
 * syncopation and off-beat variation; density controls the hi-hat pulse.
 *
 * A corpus-derived {@link RhythmStyle} onset profile biases where hi-hats land,
 * so the groove follows the corpus. Without one, the built-in grammar is used.
 */
export class PercussionGenerator {
  private readonly onsetProfile: number[] | null;
  private readonly groove: GrooveStyle | null;

  constructor(rhythm?: RhythmStyle) {
    this.onsetProfile =
      rhythm?.onsetProfile && rhythm.onsetProfile.length === 16 ? rhythm.onsetProfile : null;
    this.groove = rhythm?.groove ?? null;
  }

  generateBar(ctx: BarContext): NoteEvent[] {
    const { state, phrasePlan, rng, meter, barStartTick } = ctx;

    // Phrase shape: the rhythm follows the phrase's energy arc, so a phrase
    // builds or thins across its bars instead of four statistically identical
    // ones. Loudness (velocity) stays on raw state — that is the dynamics step.
    const arc = phrasePlan.energy;
    // Loudness follows the phrase's velocity contour (the dynamics step).
    const dyn = phrasePlan.dynamics;

    // A named groove (rock/pop backbeat) locks a steady pattern instead of the
    // energy-driven ambient grammar.
    if (this.groove === "backbeat") return this.backbeat(ctx, arc, dyn);

    // Below this energy, percussion is silent.
    if (arc < 0.22) return [];

    const beat = ticksPerBeat(meter);
    const barLen = ticksPerBar(meter);
    const beats = meter.numerator;
    const events: NoteEvent[] = [];

    // Tension drives syncopation directly (realized immediately, per handoff).
    // Unease phrases lean into it a little harder.
    const uneaseBoost = phrasePlan.shape === "unease" ? 0.12 : 0;
    const syncopation = clamp01(
      0.25 * state.complexity + 0.35 * state.instability + 0.45 * state.tension + uneaseBoost,
    );
    const subdivision = arc > 0.7 && state.complexity > 0.5 ? 4 : 2; // per beat
    const hatDensity = clamp01(0.2 + 0.7 * state.density + 0.3 * arc);

    const hit = (
      time: number,
      sound: PercussionSound,
      velocity: number,
    ) => {
      events.push({
        type: "note",
        time: barStartTick + Math.round(time),
        duration: Math.round(beat / 4),
        pitch: PERCUSSION_MIDI[sound],
        velocity: clamp01(velocity + (rng.next() - 0.5) * 0.08),
        voice: "percussion",
        percussion: sound,
      });
    };

    // Kick: downbeat, plus beat 3 as the phrase grows, plus occasional syncopation.
    hit(0, "kick", 0.7 + 0.2 * dyn);
    if (arc > 0.4 && beats >= 4) {
      hit(beat * 2, "kick", 0.6 + 0.2 * dyn);
    }
    if (rng.bool(syncopation * 0.5)) {
      hit(beat * 2 + beat / 2, "kick", 0.45);
    }

    // Snare/backbeat: beats 2 and 4 (0-indexed 1 and 3) once there's drive.
    if (arc > 0.45) {
      hit(beat, "snare", 0.55 + 0.2 * dyn);
      if (beats >= 4) hit(beat * 3, "snare", 0.55 + 0.2 * dyn);
    }

    // Hats: subdivision pulse gated by density; accent on beats.
    const step = beat / subdivision;
    const steps = beats * subdivision;
    const cell = barLen / 16;
    for (let i = 0; i < steps; i++) {
      const onBeat = i % subdivision === 0;
      let p = onBeat ? Math.max(hatDensity, 0.5) : hatDensity * (1 - 0.4 * (1 - syncopation));
      // Bias toward the corpus groove: dampen positions the corpus rarely hits.
      if (this.onsetProfile) {
        const gridIdx = Math.round((step * i) / cell) % 16;
        p *= 0.3 + 0.7 * (this.onsetProfile[gridIdx] ?? 0);
      }
      if (rng.bool(p)) {
        const vel = onBeat ? 0.4 + 0.15 * dyn : 0.25 + 0.1 * dyn;
        hit(step * i, "hat", vel);
      }
    }

    // Rhythmic anticipation: tension pushes an accent onto the last off-beat,
    // just before the next downbeat, creating forward pull.
    if (rng.bool(state.tension * 0.6)) {
      hit(barLen - beat / 4, state.energy > 0.55 ? "snare" : "kick", 0.4 + 0.3 * state.tension);
    }

    return events;
  }

  /**
   * A steady rock/pop backbeat: kick on 1 & 3, snare on 2 & 4, straight driving
   * 8th hats. Deterministic and firm — no probabilistic syncopation — so the
   * genre's pulse reads clearly. Loudness rides the phrase dynamics; energy adds
   * only a little extra motion.
   */
  private backbeat(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    const { rng, meter, barStartTick } = ctx;
    if (arc < 0.15) return [];
    const beat = ticksPerBeat(meter);
    const beats = meter.numerator;
    const events: NoteEvent[] = [];
    const hit = (time: number, sound: PercussionSound, velocity: number) => {
      events.push({
        type: "note",
        time: barStartTick + Math.round(time),
        duration: Math.round(beat / 4),
        pitch: PERCUSSION_MIDI[sound],
        velocity: clamp01(velocity + (rng.next() - 0.5) * 0.06),
        voice: "percussion",
        percussion: sound,
      });
    };

    // Kick on 1 & 3 (plus an occasional push on the 'and' of 3 as it drives).
    hit(0, "kick", 0.78 + 0.18 * dyn);
    if (beats >= 4) hit(beat * 2, "kick", 0.72 + 0.18 * dyn);
    if (arc > 0.6 && rng.bool(0.35)) hit(beat * 2 + beat / 2, "kick", 0.5);

    // Snare backbeat on 2 & 4 — the defining hit, always present.
    hit(beat, "snare", 0.72 + 0.15 * dyn);
    if (beats >= 4) hit(beat * 3, "snare", 0.72 + 0.15 * dyn);

    // Straight 8th hats, driving and even.
    const step = beat / 2;
    const steps = beats * 2;
    const hatVel = 0.34 + 0.14 * dyn;
    for (let i = 0; i < steps; i++) {
      hit(step * i, "hat", i % 2 === 0 ? hatVel + 0.08 : hatVel * 0.82);
    }

    return events;
  }
}
