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
  private readonly grooveVariation: number;

  constructor(rhythm?: RhythmStyle) {
    this.onsetProfile =
      rhythm?.onsetProfile && rhythm.onsetProfile.length === 16 ? rhythm.onsetProfile : null;
    this.groove = rhythm?.groove ?? null;
    this.grooveVariation = rhythm?.grooveVariation ?? 0;
  }

  generateBar(ctx: BarContext): NoteEvent[] {
    const { state, phrasePlan, rng, meter, barStartTick } = ctx;

    // Phrase shape: the rhythm follows the phrase's energy arc, so a phrase
    // builds or thins across its bars instead of four statistically identical
    // ones. Loudness (velocity) stays on raw state — that is the dynamics step.
    const arc = phrasePlan.energy;
    // Loudness follows the phrase's velocity contour (the dynamics step).
    const dyn = phrasePlan.dynamics;

    // A named groove locks a genre pattern instead of the ambient grammar.
    if (this.groove) {
      switch (this.groove) {
        case "none": return [];
        case "backbeat": return this.backbeat(ctx, arc, dyn);
        case "four-on-floor": return this.fourOnFloor(ctx, arc, dyn);
        case "shuffle": return this.shuffle(ctx, arc, dyn);
        case "swing": return this.swing(ctx, arc, dyn);
        case "boom-bap": return this.boomBap(ctx, arc, dyn);
        case "funk": return this.funk(ctx, arc, dyn);
        case "clave": return this.clave(ctx, arc, dyn);
      }
    }

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
  /** Shared drum-hit emitter (absolute time within the bar). */
  private hit(
    ev: NoteEvent[],
    ctx: BarContext,
    time: number,
    sound: PercussionSound,
    velocity: number,
  ): void {
    const beat = ticksPerBeat(ctx.meter);
    ev.push({
      type: "note",
      time: ctx.barStartTick + Math.round(time),
      duration: Math.round(beat / 4),
      pitch: PERCUSSION_MIDI[sound],
      velocity: clamp01(velocity + (ctx.rng.next() - 0.5) * 0.06),
      voice: "percussion",
      percussion: sound,
    });
  }

  /** Rock/pop: kick 1 & 3, snare 2 & 4, straight driving 8th hats. */
  private backbeat(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.15) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const ev: NoteEvent[] = [];
    const gv = this.grooveVariation;
    const s = beat / 4; // sixteenth
    const lastBeat = beats - 1;
    // grooveVariation: occasionally end a phrase with a tom/snare fill in the
    // last beat instead of the plain backbeat. gv=0 short-circuits (no rng draw).
    const fillBar = gv > 0 && ctx.phrase.isLastBar && ctx.rng.bool(0.4 + 0.45 * gv);

    this.hit(ev, ctx, 0, "kick", 0.78 + 0.18 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 2, "kick", 0.72 + 0.18 * dyn);
    if (arc > 0.6 && ctx.rng.bool(0.35)) this.hit(ev, ctx, beat * 2 + beat / 2, "kick", 0.5);
    // Extra kick syncopation on the "and" of 3 for a less rigid pulse.
    if (gv > 0 && !fillBar && ctx.rng.bool(gv * 0.35)) this.hit(ev, ctx, beat * 2 + beat / 2, "kick", 0.5);

    this.hit(ev, ctx, beat, "snare", 0.72 + 0.15 * dyn);
    if (beats >= 4 && !fillBar) this.hit(ev, ctx, beat * 3, "snare", 0.72 + 0.15 * dyn);
    // Ghost snares: light off-beat 16ths that add feel without changing the pulse.
    if (gv > 0 && !fillBar) {
      if (ctx.rng.bool(gv * 0.3)) this.hit(ev, ctx, beat * 2 + s * 3, "snare", 0.16);
      if (ctx.rng.bool(gv * 0.25)) this.hit(ev, ctx, beat + s * 2, "snare", 0.14);
    }

    const step = beat / 2;
    const hatVel = 0.34 + 0.14 * dyn;
    // On a fill bar the last beat is the fill, so stop the hats before it.
    const hatBeats = fillBar ? lastBeat : beats;
    for (let i = 0; i < hatBeats * 2; i++) {
      this.hit(ev, ctx, step * i, "hat", i % 2 === 0 ? hatVel + 0.08 : hatVel * 0.82);
    }
    // Open-hat accent on the "and" of the last beat (before the downbeat pull).
    if (gv > 0 && !fillBar && ctx.rng.bool(gv * 0.4)) {
      this.hit(ev, ctx, beat * lastBeat + beat / 2, "hat", hatVel + 0.2);
    }

    // The fill itself: a 16th tom/snare run through the last beat.
    if (fillBar) {
      const start = beat * lastBeat;
      const run: PercussionSound[] = ["snare", "tom", "tom", "snare"];
      for (let i = 0; i < 4; i++) this.hit(ev, ctx, start + s * i, run[i]!, 0.5 + 0.08 * i + 0.1 * dyn);
    }
    return ev;
  }

  /** Dance: kick on every beat, snare 2 & 4, offbeat open hats. */
  private fourOnFloor(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.2) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const ev: NoteEvent[] = [];
    for (let b = 0; b < beats; b++) this.hit(ev, ctx, beat * b, "kick", 0.78 + 0.15 * dyn);
    this.hit(ev, ctx, beat, "snare", 0.55 + 0.15 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 3, "snare", 0.55 + 0.15 * dyn);
    for (let b = 0; b < beats; b++) this.hit(ev, ctx, beat * b + beat / 2, "hat", 0.4 + 0.12 * dyn);
    return ev;
  }

  /** Blues: kick 1 & 3, snare 2 & 4, triplet-swung hats. */
  private shuffle(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.2) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const ev: NoteEvent[] = [];
    this.hit(ev, ctx, 0, "kick", 0.76 + 0.16 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 2, "kick", 0.7 + 0.16 * dyn);
    this.hit(ev, ctx, beat, "snare", 0.7 + 0.15 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 3, "snare", 0.7 + 0.15 * dyn);
    for (let b = 0; b < beats; b++) {
      this.hit(ev, ctx, beat * b, "hat", 0.36 + 0.12 * dyn);
      this.hit(ev, ctx, beat * b + Math.round((beat * 2) / 3), "hat", 0.28 + 0.1 * dyn);
    }
    return ev;
  }

  /** Jazz: swung ride pattern, soft kick, brushed snare on 2 & 4. */
  private swing(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.15) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const ev: NoteEvent[] = [];
    for (let b = 0; b < beats; b++) {
      this.hit(ev, ctx, beat * b, "hat", 0.34 + 0.1 * dyn);
      if (b % 2 === 1) this.hit(ev, ctx, beat * b + Math.round((beat * 2) / 3), "hat", 0.26 + 0.08 * dyn);
    }
    this.hit(ev, ctx, 0, "kick", 0.5 + 0.12 * dyn);
    this.hit(ev, ctx, beat, "snare", 0.4 + 0.12 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 3, "snare", 0.4 + 0.12 * dyn);
    return ev;
  }

  /** Hip-hop: half-time — kick on 1 (+ syncopation), snare on 3, swung hats. */
  private boomBap(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.15) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const ev: NoteEvent[] = [];
    this.hit(ev, ctx, 0, "kick", 0.82 + 0.15 * dyn);
    this.hit(ev, ctx, beat + beat / 2, "kick", 0.6);
    if (beats >= 4) this.hit(ev, ctx, beat * 2, "snare", 0.75 + 0.15 * dyn);
    for (let i = 0; i < beats * 2; i++) {
      const t = i % 2 === 0 ? (beat / 2) * i : (beat / 2) * i + Math.round(beat * 0.08);
      this.hit(ev, ctx, t, "hat", i % 2 === 0 ? 0.34 : 0.24);
    }
    return ev;
  }

  /** Funk: kick on the one + syncopation, snare 2 & 4, busy 16th hats. */
  private funk(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.2) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const s = beat / 4;
    const ev: NoteEvent[] = [];
    this.hit(ev, ctx, 0, "kick", 0.82 + 0.15 * dyn);
    this.hit(ev, ctx, Math.round(s * 6), "kick", 0.55);
    this.hit(ev, ctx, beat, "snare", 0.7 + 0.15 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 3, "snare", 0.7 + 0.15 * dyn);
    for (let i = 0; i < beats * 4; i++) this.hit(ev, ctx, s * i, "hat", i % 2 === 0 ? 0.34 + 0.1 * dyn : 0.2);
    return ev;
  }

  /** Latin: son clave (3-2) on the shaker, supporting kick, straight hats. */
  private clave(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.2) return [];
    const beat = ticksPerBeat(ctx.meter);
    const cell = (beat * ctx.meter.numerator) / 16;
    const ev: NoteEvent[] = [];
    for (const step of [0, 3, 6, 10, 12]) this.hit(ev, ctx, cell * step, "shaker", 0.5 + 0.12 * dyn);
    this.hit(ev, ctx, 0, "kick", 0.6 + 0.12 * dyn);
    this.hit(ev, ctx, beat * 2, "kick", 0.55 + 0.12 * dyn);
    for (let b = 0; b < ctx.meter.numerator; b++) this.hit(ev, ctx, beat * b, "hat", 0.3 + 0.1 * dyn);
    return ev;
  }
}
