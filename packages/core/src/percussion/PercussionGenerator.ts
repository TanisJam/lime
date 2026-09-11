import {
  type NoteEvent,
  type PercussionSound,
  PERCUSSION_MIDI,
} from "../events/MusicalEvent.js";
import { ticksPerBeat, ticksPerBar } from "../time/MusicalTime.js";
import { clamp01 } from "../state/MusicalState.js";
import type { BarContext } from "../orchestration/BarContext.js";
import type { RhythmStyle, GrooveStyle } from "../style/StylePack.js";
import {
  FUNK_KICK_SIXTEENTHS,
  BACKBEAT_KICK_SIXTEENTHS,
  FOUR_ON_FLOOR_KICK_SIXTEENTHS,
  SHUFFLE_KICK_SIXTEENTHS,
  SWING_KICK_SIXTEENTHS,
  BOOM_BAP_KICK_SIXTEENTHS,
  CLAVE_KICK_SIXTEENTHS,
} from "./grooveAnchors.js";

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

  /**
   * Rock/pop/metal: kick 1 & 3, snare 2 & 4, straight driving 8th hats.
   * `grooveVariation` above 1 (Pop only, see genres.ts) opts into an extra
   * density layer near the end of this method, without touching how loose
   * the backbeat itself is — see `looseness` below.
   */
  private backbeat(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.15) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const ev: NoteEvent[] = [];
    const gv = this.grooveVariation;
    // How loose the backbeat itself gets (fills, kick sync, ghost snares,
    // open-hat accent) — every line below except the density layer at the
    // bottom reads this, not `gv` directly. A `grooveVariation` above 1
    // (Pop) opts into that separate density layer while its fractional part
    // still carries this exact meaning, so Rock and Metal (whose gv never
    // crosses 1) see `looseness === gv`, byte-for-byte the value they always
    // had.
    const looseness = gv - Math.floor(gv);
    const s = beat / 4; // sixteenth
    const lastBeat = beats - 1;
    // grooveVariation: occasionally end a phrase with a tom/snare fill in the
    // last beat instead of the plain backbeat. gv=0 short-circuits (no rng draw).
    const fillBar = looseness > 0 && ctx.phrase.isLastBar && ctx.rng.bool(0.4 + 0.45 * looseness);

    this.hit(ev, ctx, s * BACKBEAT_KICK_SIXTEENTHS[0], "kick", 0.78 + 0.18 * dyn);
    if (beats >= 4) this.hit(ev, ctx, s * BACKBEAT_KICK_SIXTEENTHS[1], "kick", 0.72 + 0.18 * dyn);
    if (arc > 0.6 && ctx.rng.bool(0.35)) this.hit(ev, ctx, beat * 2 + beat / 2, "kick", 0.5);
    // Extra kick syncopation on the "and" of 3 for a less rigid pulse.
    if (looseness > 0 && !fillBar && ctx.rng.bool(looseness * 0.35)) this.hit(ev, ctx, beat * 2 + beat / 2, "kick", 0.5);

    this.hit(ev, ctx, beat, "snare", 0.72 + 0.15 * dyn);
    if (beats >= 4 && !fillBar) this.hit(ev, ctx, beat * 3, "snare", 0.72 + 0.15 * dyn);
    // Ghost snares: quiet 16ths clustered in front of and behind each backbeat
    // hit. This needs real density, not a token ornament — real rock's
    // measured backbeat share is 0.46 (GROOVE-CRITERIA.md), meaning over half
    // of a rock kit's snare hits are NOT on 2 & 4. Kept quiet (~0.14-0.18) so
    // they read as ghosts, not as a second backbeat.
    if (looseness > 0 && !fillBar) {
      for (const spot of [s * 2, s * 3, s * 5, s * 6]) {
        if (ctx.rng.bool(looseness * 0.5)) this.hit(ev, ctx, spot, "snare", 0.14 + 0.04 * ctx.rng.next());
      }
      if (beats >= 4) {
        for (const spot of [s * 10, s * 11, s * 13, s * 14]) {
          if (ctx.rng.bool(looseness * 0.5)) this.hit(ev, ctx, spot, "snare", 0.14 + 0.04 * ctx.rng.next());
        }
      }
    }

    const step = beat / 2;
    const hatVel = 0.34 + 0.14 * dyn;
    // On a fill bar the last beat is the fill, so stop the hats before it.
    const hatBeats = fillBar ? lastBeat : beats;
    for (let i = 0; i < hatBeats * 2; i++) {
      this.hit(ev, ctx, step * i, "hat", i % 2 === 0 ? hatVel + 0.08 : hatVel * 0.82);
    }
    // Open-hat accent on the "and" of the last beat (before the downbeat pull).
    if (looseness > 0 && !fillBar && ctx.rng.bool(looseness * 0.4)) {
      this.hit(ev, ctx, beat * lastBeat + beat / 2, "hat", hatVel + 0.2);
    }

    // Pop's extra density (`grooveVariation` > 1 — see genres.ts): a
    // tambourine-like shaker doubling the 8th-note pulse, plus a light 16th
    // hat ghost in between. Pop's measured density is far busier than
    // Rock's (21.7 vs 15.6 hits/bar, GROOVE-CRITERIA.md) yet its backbeat
    // share is the *tightest* of any genre (0.81) — so the extra motion has
    // to come from more texture, not a looser backbeat the way raising
    // `looseness` loosens Rock/Metal. That is why this is a separate layer
    // gated on the integer part of `gv` instead of just raising it for Pop.
    if (gv > 1 && !fillBar) {
      const shakerP = clamp01(0.5 + 0.3 * arc + 0.2 * dyn);
      for (let i = 0; i < hatBeats * 2; i++) {
        if (ctx.rng.bool(shakerP)) this.hit(ev, ctx, step * i, "shaker", 0.3 + 0.1 * dyn);
      }
      const hatGhostP = clamp01(0.2 + 0.2 * arc);
      for (let i = 0; i < hatBeats * 2; i++) {
        if (ctx.rng.bool(hatGhostP)) this.hit(ev, ctx, step * i + step / 2, "hat", hatVel * 0.55);
      }
    }

    // The fill itself: a 16th tom/snare run through the last beat.
    if (fillBar) {
      const start = beat * lastBeat;
      const run: PercussionSound[] = ["snare", "tom", "tom", "snare"];
      for (let i = 0; i < 4; i++) this.hit(ev, ctx, start + s * i, run[i]!, 0.5 + 0.08 * i + 0.1 * dyn);
    }
    return ev;
  }

  /**
   * Dance: kick on every beat, clap on 2 & 4, a continuous 16th-note hi-hat,
   * and a clap/shaker roll filling the rest of the grid.
   *
   * The grid-perfect four-on-the-floor kick IS the genre's discriminator
   * (GROOVE-CRITERIA.md), so it is never touched by `grooveVariation` — not
   * even under a high value. Density was the real defect here: real
   * electronic runs a constant 16th-note hat plus layered percussion, about
   * 30 hits/bar, against the 11.8 a bare kick-plus-one-offbeat-hat gave
   * (GROOVE-CRITERIA.md, the worst gap in the whole engine). Every added
   * layer below is gated by `arc`/density, not unconditional, so a quiet
   * breakdown still thins out instead of hammering regardless of the phrase.
   */
  private fourOnFloor(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.2) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const gv = this.grooveVariation;
    const density = ctx.state.density;
    const ev: NoteEvent[] = [];
    const s = beat / 4; // sixteenth
    const steps = beats * 4;

    // Kick: rigid quarter-note pulse (FOUR_ON_FLOOR_KICK_SIXTEENTHS). Deliberately independent of gv/rng.
    for (const pos of FOUR_ON_FLOOR_KICK_SIXTEENTHS) {
      if (pos < steps) this.hit(ev, ctx, s * pos, "kick", 0.78 + 0.15 * dyn);
    }

    // Clap, layered with the snare, on 2 & 4 — the genre's only fixed clap
    // hit. Real electronic measures the lowest backbeat share of any genre
    // (0.29, GROOVE-CRITERIA.md): most of its clap energy is NOT on 2 & 4,
    // which is exactly what the roll below supplies.
    this.hit(ev, ctx, beat, "snare", 0.55 + 0.15 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 3, "snare", 0.55 + 0.15 * dyn);

    // Continuous 16th-note hi-hat, with accent variation: the 8th-note
    // positions are the driving pulse (a house hat essentially never drops
    // an 8th, so these are unconditional — no rng draw, like the kick), the
    // in-between 16ths are a softer, density-gated ghost layer, and the
    // "and" of each beat opens up into a louder, longer stroke — the
    // classic house open-hat accent. Both extra layers are `grooveVariation`
    // gated (`gv > 0`) like every other groove's embellishments, so gv=0
    // still short-circuits to a fixed, silent-beyond-the-8ths pattern.
    const ghostP = clamp01(0.55 + 0.35 * arc + 0.25 * density);
    for (let i = 0; i < steps; i++) {
      const onEighth = i % 2 === 0;
      if (!onEighth && (gv <= 0 || !ctx.rng.bool(ghostP))) continue;
      const onOffbeat = i % 4 === 2; // the "and" of each beat
      const open = onOffbeat && gv > 0 && ctx.rng.bool(0.4 + 0.3 * gv);
      const vel = open ? 0.5 + 0.18 * dyn : onEighth ? 0.36 + 0.12 * dyn : 0.22 + 0.08 * dyn;
      this.hit(ev, ctx, s * i, "hat", vel);
    }

    // Clap roll and a light shaker fill, both on the "and" of each beat,
    // under the open hat above — this is the density real house/techno
    // percussion has that a bare kick+backbeat doesn't: near-constant
    // motion, not four kicks and a single offbeat tick. `grooveVariation`
    // scales how far it fills in, same as every other groove's roll.
    if (gv > 0) {
      const clapP = clamp01(gv * (0.7 + 0.35 * arc));
      const percP = clamp01(gv * (0.55 + 0.3 * arc + 0.2 * density));
      for (let b = 0; b < beats; b++) {
        if (ctx.rng.bool(clapP)) this.hit(ev, ctx, beat * b + beat / 2, "snare", 0.28 + 0.1 * dyn);
        if (ctx.rng.bool(percP)) this.hit(ev, ctx, beat * b + beat / 2, "shaker", 0.3 + 0.08 * dyn);
      }
    }

    return ev;
  }

  /**
   * Blues: kick 1 & 3, snare 2 & 4, triplet-swung hats.
   *
   * `grooveVariation` tucks ghost snares into the swing pocket between the
   * backbeat hits, occasionally pushes the kick onto the shuffle triplet, and
   * ends a phrase with a short triplet fill instead of just stopping.
   */
  private shuffle(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.2) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const gv = this.grooveVariation;
    const ev: NoteEvent[] = [];
    const s = beat / 4; // sixteenth
    const triplet = Math.round((beat * 2) / 3); // the swung 8th within the beat
    this.hit(ev, ctx, s * SHUFFLE_KICK_SIXTEENTHS[0], "kick", 0.76 + 0.16 * dyn); // beat 1
    if (beats >= 4) this.hit(ev, ctx, s * SHUFFLE_KICK_SIXTEENTHS[2], "kick", 0.7 + 0.16 * dyn); // beat 3
    // Feathered kick on beats 2 and 4 (SHUFFLE_KICK_SIXTEENTHS[1]/[3]): quiet,
    // just enough to keep the kick moving under the walking bass's full
    // quarter-note pulse instead of only marking the backbeat pair.
    if (beats >= 4) {
      this.hit(ev, ctx, s * SHUFFLE_KICK_SIXTEENTHS[1], "kick", 0.3 + 0.08 * dyn);
      this.hit(ev, ctx, s * SHUFFLE_KICK_SIXTEENTHS[3], "kick", 0.3 + 0.08 * dyn);
    }
    // Kick variation: a triplet push on the "and" of 1, a common shuffle feel.
    if (gv > 0 && ctx.rng.bool(gv * 0.3)) this.hit(ev, ctx, triplet, "kick", 0.45);

    this.hit(ev, ctx, beat, "snare", 0.7 + 0.15 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 3, "snare", 0.7 + 0.15 * dyn);
    // Ghost snares tucked into the swing pocket, on the straight or swung
    // position of every beat except the two that already carry the backbeat.
    if (gv > 0) {
      for (let b = 0; b < beats; b++) {
        const onBackbeat = b === 1 || (beats >= 4 && b === 3);
        if (!onBackbeat && ctx.rng.bool(gv * 0.45)) {
          this.hit(ev, ctx, beat * b, "snare", 0.14 + 0.06 * ctx.rng.next());
        }
        if (ctx.rng.bool(gv * 0.45)) {
          this.hit(ev, ctx, beat * b + triplet, "snare", 0.13 + 0.06 * ctx.rng.next());
        }
      }
    }

    for (let b = 0; b < beats; b++) {
      this.hit(ev, ctx, beat * b, "hat", 0.36 + 0.12 * dyn);
      this.hit(ev, ctx, beat * b + triplet, "hat", 0.28 + 0.1 * dyn);
    }
    // Phrase-end triplet fill through the last beat.
    if (gv > 0 && ctx.phrase.isLastBar && ctx.rng.bool(0.35 + 0.4 * gv)) {
      const start = beat * (beats - 1);
      const third = Math.round(beat / 3);
      this.hit(ev, ctx, start, "snare", 0.5 + 0.1 * dyn);
      this.hit(ev, ctx, start + third, "tom", 0.45 + 0.1 * dyn);
      this.hit(ev, ctx, start + third * 2, "snare", 0.55 + 0.1 * dyn);
    }
    return ev;
  }

  /**
   * Jazz: swung ride pattern, soft kick, brushed snare on 2 & 4.
   *
   * Jazz is the least pattern-locked groove of the set — a ride cymbal figure
   * that never varies reads as a drum machine, not a drummer listening to the
   * band. `grooveVariation` breathes the ride itself (dropped/displaced
   * strokes), adds "dropped bombs" (sparse off-beat kick accents, a bebop
   * drumming staple) and brushed ghost snares between the backbeat, and lets a
   * phrase end with a soft brushed roll instead of just stopping.
   */
  private swing(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.15) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const gv = this.grooveVariation;
    const ev: NoteEvent[] = [];
    for (let b = 0; b < beats; b++) {
      // Ride variation: occasionally drop the on-beat stroke, or nudge the
      // swung upbeat early/late — a ride pattern that never wavers is the
      // signature of a machine, not a drummer.
      const dropRide = gv > 0 && ctx.rng.bool(gv * 0.12);
      if (!dropRide) this.hit(ev, ctx, beat * b, "hat", 0.34 + 0.1 * dyn);
      if (b % 2 === 1) {
        let upbeat = beat * b + Math.round((beat * 2) / 3);
        if (gv > 0 && ctx.rng.bool(gv * 0.2)) {
          upbeat += Math.round(beat / 12) * (ctx.rng.bool() ? 1 : -1);
        }
        this.hit(ev, ctx, upbeat, "hat", 0.26 + 0.08 * dyn);
      }
    }
    const s = beat / 4; // sixteenth
    this.hit(ev, ctx, s * SWING_KICK_SIXTEENTHS[0], "kick", 0.5 + 0.12 * dyn); // beat 1
    // Feathered kick on beats 2, 3 and 4 (SWING_KICK_SIXTEENTHS[1..3]): real
    // acoustic jazz drummers keep the bass drum going continuously and softly
    // under the ride, reinforcing the walking bass's quarter-note pulse
    // rather than only marking "the one" — this is the anchor the walking
    // bass locks onto.
    if (beats >= 4) {
      this.hit(ev, ctx, s * SWING_KICK_SIXTEENTHS[1], "kick", 0.22 + 0.08 * dyn);
      this.hit(ev, ctx, s * SWING_KICK_SIXTEENTHS[2], "kick", 0.3 + 0.1 * dyn);
      this.hit(ev, ctx, s * SWING_KICK_SIXTEENTHS[3], "kick", 0.22 + 0.08 * dyn);
    }
    // Dropped bombs: a sparse off-beat kick accent, independent of the ride.
    if (gv > 0 && ctx.rng.bool(gv * 0.18)) {
      this.hit(ev, ctx, beat * 2 + beat / 2, "kick", 0.42 + 0.1 * dyn);
    }
    this.hit(ev, ctx, beat, "snare", 0.4 + 0.12 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 3, "snare", 0.4 + 0.12 * dyn);
    // Brush comping: quiet snare touches scattered across the bar's sixteenth
    // grid, everywhere but the backbeat itself. Jazz brushes are in near
    // continuous motion behind a soloist, not silent between 2 and 4 — this
    // is also why jazz measures the lowest backbeat share of any genre
    // (0.40, GROOVE-CRITERIA.md): most of the snare activity lives elsewhere.
    if (gv > 0 && beats >= 4) {
      const s = beat / 4;
      for (let i = 0; i < beats * 4; i++) {
        if (i === 4 || i === 12) continue; // the backbeat, already hit
        if (ctx.rng.bool(gv * 0.22)) this.hit(ev, ctx, s * i, "snare", 0.12 + 0.08 * ctx.rng.next());
      }
    }
    // Phrase-end fill: a soft brushed press roll instead of the plain pattern.
    if (gv > 0 && ctx.phrase.isLastBar && ctx.rng.bool(0.3 + 0.4 * gv)) {
      this.hit(ev, ctx, beat * (beats - 1) + beat / 2, "snare", 0.22 + 0.1 * dyn);
    }
    return ev;
  }

  /**
   * Hip-hop: half-time — kick on 1 (+ syncopation), snare on 3, swung hats.
   *
   * Boom-bap comes from chopped breakbeats, so `grooveVariation` adds a third,
   * syncopated kick hit, ghost snares around the one big backbeat, an
   * occasional dropped hat (a sampled loop's imperfections, not a machine
   * pulse), and a short pickup fill at the phrase end.
   */
  private boomBap(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.15) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const gv = this.grooveVariation;
    const s = beat / 4;
    const ev: NoteEvent[] = [];
    this.hit(ev, ctx, s * BOOM_BAP_KICK_SIXTEENTHS[0], "kick", 0.82 + 0.15 * dyn);
    this.hit(ev, ctx, s * BOOM_BAP_KICK_SIXTEENTHS[1], "kick", 0.6);
    // Kick placement variation: a third, syncopated hit — boom-bap breakbeats
    // rarely repeat the same two-kick skeleton bar after bar.
    if (gv > 0 && ctx.rng.bool(gv * 0.3)) {
      this.hit(ev, ctx, ctx.rng.bool() ? s * 3 : beat * 2 + s * 3, "kick", 0.42 + 0.1 * dyn);
    }

    if (beats >= 4) this.hit(ev, ctx, beat * 2, "snare", 0.75 + 0.15 * dyn);
    // Ghost snares around the one big backbeat hit.
    if (gv > 0 && beats >= 4) {
      if (ctx.rng.bool(gv * 0.25)) this.hit(ev, ctx, beat + s * 3, "snare", 0.15);
      if (ctx.rng.bool(gv * 0.2)) this.hit(ev, ctx, beat * 3 + s, "snare", 0.13);
    }

    for (let i = 0; i < beats * 2; i++) {
      // Occasional skipped hat — a chopped sample dropping a hit, not a
      // machine-perfect 8th pulse.
      if (gv > 0 && ctx.rng.bool(gv * 0.1)) continue;
      const t = i % 2 === 0 ? (beat / 2) * i : (beat / 2) * i + Math.round(beat * 0.08);
      this.hit(ev, ctx, t, "hat", i % 2 === 0 ? 0.34 : 0.24);
    }
    // Phrase-end fill: a short snare/tom pickup into the next phrase.
    if (gv > 0 && ctx.phrase.isLastBar && ctx.rng.bool(0.3 + 0.35 * gv)) {
      const start = beat * (beats - 1) + beat / 2;
      this.hit(ev, ctx, start, "snare", 0.4 + 0.1 * dyn);
      this.hit(ev, ctx, start + s, "tom", 0.42 + 0.1 * dyn);
    }
    return ev;
  }

  /**
   * Funk: kick on the one + syncopation, snare 2 & 4, busy 16th hats.
   *
   * This is the groove GROOVE-CRITERIA.md singles out: real funk drumming is
   * dense with ghost notes, and the reference corpus measures ~0 ghost
   * density only because it is a quantised MIDI transcription that flattened
   * them — that ~0 is a corpus artefact, not a target. `grooveVariation`
   * scatters quiet snare taps across the off-16ths (the genre's defining
   * texture), adds a displaced kick and hat accent/open variation. It never
   * touches `FUNK_KICK_SIXTEENTHS` — the bass locks its own pattern to those
   * exact positions (grooveAnchors.ts), so the kick anchors are only ever
   * added around, never moved or removed.
   */
  private funk(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.2) return [];
    const beat = ticksPerBeat(ctx.meter);
    const beats = ctx.meter.numerator;
    const s = beat / 4;
    const gv = this.grooveVariation;
    const ev: NoteEvent[] = [];
    const kickAnchors = new Set<number>(FUNK_KICK_SIXTEENTHS);
    this.hit(ev, ctx, Math.round(s * FUNK_KICK_SIXTEENTHS[0]), "kick", 0.82 + 0.15 * dyn);
    this.hit(ev, ctx, Math.round(s * FUNK_KICK_SIXTEENTHS[1]), "kick", 0.55);
    // Displaced kicks: a real funk kick rarely sits still at just two hits per bar,
    // and these are where the groove's sixteenth-note offbeats come from. Three of
    // the four spots (3, 9, 11) are ODD 16th steps, so they feed `drum16th` from the
    // KICK rather than from the snare. That is why the subdivision is bought here
    // and not with more ghosts: `backbeat` is a share over the snare alone —
    // 2 / (2 + ghosts) — so every ghost spent on subdivision lowers the backbeat
    // reading while the backbeat itself never moves. The kick has no such budget.
    if (gv > 0) {
      const spots = [3, 9, 11, 14].filter((p) => !kickAnchors.has(p));
      if (ctx.rng.bool(gv * 0.72)) {
        this.hit(ev, ctx, s * ctx.rng.pick(spots), "kick", 0.4 + 0.1 * dyn);
      }
      if (ctx.rng.bool(gv * 0.55)) {
        this.hit(ev, ctx, s * ctx.rng.pick(spots), "kick", 0.34 + 0.08 * dyn);
      }
      if (ctx.rng.bool(gv * 0.35)) {
        this.hit(ev, ctx, s * ctx.rng.pick(spots), "kick", 0.3 + 0.08 * dyn);
      }
    }

    this.hit(ev, ctx, beat, "snare", 0.7 + 0.15 * dyn);
    if (beats >= 4) this.hit(ev, ctx, beat * 3, "snare", 0.7 + 0.15 * dyn);
    // Ghost snares: funk's defining texture, and the sixteenth subdivision now that
    // the hats sit on eighths. ODD steps only — a ghost on an even step lands
    // exactly on top of a hat, so it adds density without adding subdivision, which
    // pushes `drum16th` DOWN while looking like more groove.
    //
    // Density is bounded by `backbeat` rather than chosen for feel: that metric is
    // 2 / (2 + ghosts), so the bar carries only ~1.9 ghosts before the backbeat
    // share leaves tolerance even though the backbeat itself never moves.
    // GROOVE-CRITERIA.md is equally clear that the reference corpus cannot set a
    // ghost target — it measures ~0.00 for every label including funk, because the
    // Lakh transcriptions flattened them.
    if (gv > 0) {
      for (let i = 0; i < beats * 4; i++) {
        if (i === 4 || i === 12) continue; // the backbeat itself
        if (kickAnchors.has(i % 16)) continue; // never crowd the kick anchors
        if (i % 2 === 1 && ctx.rng.bool(gv * 0.3)) {
          this.hit(ev, ctx, s * i, "snare", 0.2 + 0.1 * ctx.rng.next());
        }
      }
    }

    // Hats on eighths, accented on the beat.
    //
    // A full sixteenth grid put every subdivision at ~0.23 velocity: 75 % of the
    // percussion by count, the loudest voice in the mix, and the brightest thing in
    // the genre — dropping the hats alone takes a funk render's spectral centroid
    // from 2262 Hz to 1980 Hz, and dropping all percussion takes it to 1460 Hz.
    // Sixteenths measured `drumOffbeat` 0.65 against a 0.48 reference, because a
    // sixteenth grid scores 0.75 on that metric by construction. Eighths measure
    // 0.42, and they leave the subdivision to the displaced kicks and the ghosts.
    const hatVel = 0.34 + 0.1 * dyn;
    const ghostVel = 0.16 + 0.05 * dyn;
    for (let i = 0; i < beats * 2; i++) {
      const onBeat = i % 2 === 0;
      let vel = onBeat ? hatVel : ghostVel;
      // Occasionally open a hat on the "and" instead of keeping it closed, off the
      // beat only, so it colours the pulse rather than blurring it.
      if (gv > 0 && !onBeat && ctx.rng.bool(gv * 0.15)) vel = 0.3 + 0.08 * dyn;
      this.hit(ev, ctx, s * i * 2, "hat", vel);
    }
    return ev;
  }

    /**
  /**
   * Latin: 3-2 son clave on claves, a one-drum conga tumbao, a bombo kick and a
   * running shaker.
   *
   * The earlier version played the clave figure on the shaker — the softest
   * timbre in the kit — over a kick on 1 and 3, so what came out was a rock
   * backbeat with a decoration nobody could hear; classifiers read it as generic
   * pop. What actually identifies the style is the clave figure and the conga
   * tumbao, so both get real voices and sit on top, and the kick follows the
   * bombo instead of the backbeat.
   *
   * `grooveVariation` only ever touches the conga and shaker layers — the
   * clave figure itself and the bombo kick stay exactly as written, because
   * the clave IS the genre's identity and a varied one stops reading as latin.
   */
  private clave(ctx: BarContext, arc: number, dyn: number): NoteEvent[] {
    if (arc < 0.2) return [];
    const beat = ticksPerBeat(ctx.meter);
    const cell = (beat * ctx.meter.numerator) / 16;
    const barLen = beat * ctx.meter.numerator;
    const gv = this.grooveVariation;
    const ev: NoteEvent[] = [];
    // The pattern is written for a four-beat bar. In any other meter a position
    // can land past the barline, and a hit there would belong to the next bar,
    // so drop it rather than let the figure spill.
    const place = (time: number, sound: PercussionSound, velocity: number): void => {
      if (time < barLen) this.hit(ev, ctx, time, sound, velocity);
    };

    // The single most identifying figure in the style, so it is also the loudest.
    // Never varied by grooveVariation.
    for (const step of [0, 3, 6, 10, 12]) place(cell * step, "clave", 0.7 + 0.12 * dyn);

    // One-drum tumbao: muted heel strokes keep the pulse, the slap answers them,
    // and the two open tones at the end of the bar are what the ear recognizes.
    place(0, "congaLow", 0.35);
    place(cell * 8, "congaLow", 0.35);
    place(cell * 4, "conga", 0.45);
    place(cell * 12, "conga", 0.65 + 0.12 * dyn);
    place(cell * 14, "conga", 0.65 + 0.12 * dyn);
    // Tumbao ornament: an extra open-tone slap — a conguero fills the bar
    // differently take to take without breaking the underlying tumbao.
    if (gv > 0 && ctx.rng.bool(gv * 0.3)) {
      place(cell * ctx.rng.pick([2, 6, 10]), "conga", 0.4 + 0.1 * dyn);
    }

    // Bombo: a light anchor on the downbeat and the accent on the "and of 2"
    // (CLAVE_KICK_SIXTEENTHS). Never varied by grooveVariation.
    place(cell * CLAVE_KICK_SIXTEENTHS[0], "kick", 0.45);
    place(cell * CLAVE_KICK_SIXTEENTHS[1], "kick", 0.7 + 0.12 * dyn);

    // The cascara/guiro layer — a continuous eighth-note bed under everything.
    for (let i = 0; i < 8; i++) {
      // Occasional dropped shaker 8th and an accent on another, so the bed
      // breathes instead of running as a perfectly even machine pulse.
      if (gv > 0 && ctx.rng.bool(gv * 0.08)) continue;
      const accent = gv > 0 && ctx.rng.bool(gv * 0.15);
      place((beat / 2) * i, "shaker", accent ? 0.4 + 0.1 * dyn : 0.28 + 0.08 * dyn);
    }
    return ev;
  }
}
