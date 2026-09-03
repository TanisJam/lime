import type { NoteEvent } from "../events/MusicalEvent.js";
import type { SeededRandom } from "../random/SeededRandom.js";
import { ticksPerBar } from "../time/MusicalTime.js";
import { clamp01 } from "../state/MusicalState.js";
import { degreePitch, triadDegrees } from "../harmony/Scale.js";
import type { BarContext } from "../orchestration/BarContext.js";
import type { ComposerMemory } from "../memory/ComposerMemory.js";
import type { Motif } from "../motif/Motif.js";
import { MotifGenerator } from "../motif/MotifGenerator.js";
import { augment, fragment, invert, transpose } from "../motif/MotifTransformer.js";
import type { MelodyStyle, MelodyScale } from "../style/StylePack.js";

/** Pitch-class offsets (from the tonic) of the pentatonic scales. */
const PENTATONIC: Record<Exclude<MelodyScale, "diatonic">, readonly number[]> = {
  "minor-pentatonic": [0, 3, 5, 7, 10],
  "major-pentatonic": [0, 2, 4, 7, 9],
};

/**
 * Snap a pitch to the nearest tone of a pentatonic scale in the key. Preserves
 * register (moves at most a whole step), so a diatonic contour becomes a
 * pentatonic riff without losing its shape.
 */
function snapToScale(pitch: number, keyPc: number, scale: MelodyScale): number {
  if (scale === "diatonic") return pitch;
  const set = PENTATONIC[scale];
  const pc = (((pitch - keyPc) % 12) + 12) % 12;
  if (set.includes(pc)) return pitch;
  for (const d of [-1, 1, -2, 2]) {
    if (set.includes((((pc + d) % 12) + 12) % 12)) return pitch + d;
  }
  return pitch;
}

const MELODY_OCTAVE = 5;
const TARGET_PITCH = 74;

/** A leap of this many semitones (a 4th or wider) invites resolution. */
const LEAP_SEMITONES = 5;
/** Default chance a leap resolves stepwise, when the style doesn't set one. */
const DEFAULT_LEAP_RESOLUTION = 0.7;

/**
 * Melody voice — derived from motifs, never freshly random every bar.
 *
 * Flow: pick/return/introduce a motif → adapt it to the current chord → apply a
 * role-appropriate variation → schedule. Density and energy gate whether melody
 * sounds at all; at low energy it deliberately falls silent for bars. Motif
 * recurrence gives the music a memory.
 */
export class MelodyGenerator {
  private readonly motifGen: MotifGenerator;
  private readonly leapResolution: number;
  private readonly scale: MelodyScale;
  private activeMotif: Motif | undefined;
  private lastPitch: number | undefined;

  constructor(rng: SeededRandom, melody?: MelodyStyle) {
    this.motifGen = new MotifGenerator(rng.derive("motif"), melody);
    this.leapResolution = melody?.leapResolution ?? DEFAULT_LEAP_RESOLUTION;
    this.scale = melody?.scale ?? "diatonic";
  }

  generateBar(ctx: BarContext, memory: ComposerMemory): NoteEvent[] {
    const { phrasePlan, rng } = ctx;

    // 1. Restraint: how present should the melody be this bar? The phrase plan
    //    decides, so every voice agrees on the gesture. A `tacet` phrase simply
    //    doesn't play — the melody is allowed to sit out whole phrases — while
    //    even a `lead` line never plays every bar, so it keeps breathing.
    if (phrasePlan.melodicActivity === "tacet") return [];
    // Always state the theme at the top of a statement phrase (unless the whole
    // phrase is tacet): that downbeat is the "here is the idea" moment, so it
    // shouldn't be swallowed by a rest. Elsewhere the melody breathes as before.
    const isThemeHead = ctx.phrase.isStart && ctx.phrase.role === "statement";
    if (!isThemeHead && !rng.bool(this.playProbability(ctx))) return [];

    // 2. Choose the motif for this bar.
    const base = this.selectMotif(ctx, memory);
    memory.markMotifUsed(base.id);

    // 3. Vary it according to phrase role and complexity/instability.
    const motif = this.vary(base, ctx);

    // 4. Adapt to the current chord: anchor on a chord tone near the last pitch.
    //    Tension adds dissonance: some notes are displaced to a neighboring
    //    scale tone (a suspension/appoggiatura against the chord), realized
    //    immediately from current state and kept diatonic (still in scale).
    const anchorDegree = this.chooseAnchor(ctx);
    // Keep a statement of the theme clean so it stays recognizable; the theme's
    // head is fully clean, and tension colours the developing and unsettled
    // phrases instead.
    const dissonanceProb = isThemeHead
      ? 0
      : ctx.state.tension * 0.45 * (ctx.phrasePlan.shape === "statement" ? 0.3 : 1);
    const degrees = motif.intervals.map((step, i) => {
      let degree = anchorDegree + step;
      if (i > 0 && ctx.rng.bool(dissonanceProb)) {
        degree += ctx.rng.bool() ? 1 : -1;
      }
      return degree;
    });
    this.resolveLeaps(degrees, ctx);
    const pitches = degrees.map((degree) => {
      const p = degreePitch(degree, ctx.chord.keyPc, ctx.chord.mode, MELODY_OCTAVE);
      // Rock/blues riffs live in the pentatonic; snap there when the style asks.
      return snapToScale(p, ctx.chord.keyPc, this.scale);
    });

    // 5. Schedule within the bar.
    return this.schedule(motif, pitches, ctx, memory);
  }

  /**
   * Chance the melody sounds at all this bar. Shaped off the phrase-arc energy
   * (not raw state) so the line swells and settles with the phrase; sparse
   * phrases thin out further, and the chance is capped below 1 so even at full
   * energy some bars fall silent — the melody always has room to breathe.
   */
  private playProbability(ctx: BarContext): number {
    const { state, phrase, phrasePlan } = ctx;
    let p = -0.05 + 0.85 * phrasePlan.energy + 0.5 * state.density;
    if (phrase.role === "statement") p += 0.15;
    if (phrasePlan.melodicActivity === "sparse") p *= 0.55;
    const ceiling = phrasePlan.melodicActivity === "lead" ? 0.9 : 0.7;
    return Math.min(clamp01(p), ceiling);
  }

  private selectMotif(ctx: BarContext, memory: ComposerMemory): Motif {
    const { state, phrase, rng } = ctx;

    if (memory.motifs.length === 0) {
      const m = this.motifGen.create(state.complexity);
      memory.addMotif(m);
      this.activeMotif = m;
      return m;
    }

    if (phrase.isStart) {
      if (phrase.role === "statement") {
        // The primary theme (the very first motif) returns on every statement.
        // Presenting the same idea plainly, again and again, is what lets the
        // ear recognize it — the recurrence that makes the piece feel composed.
        this.activeMotif = memory.motifs[0]!;
      } else if (rng.bool(0.3 * state.instability)) {
        // Bring back an older motif for recurrence.
        this.activeMotif = rng.pick(memory.motifs);
      }
    }

    // Rarely introduce a brand-new motif mid-piece for future return.
    if (rng.bool(0.05 * state.instability) && memory.motifs.length < 6) {
      const m = this.motifGen.create(state.complexity);
      memory.addMotif(m);
    }

    return this.activeMotif ?? memory.motifs[0]!;
  }

  private vary(base: Motif, ctx: BarContext): Motif {
    const { state, phrase, rng } = ctx;
    let m = base;
    const amount = 0.5 * state.complexity + 0.5 * state.instability;

    switch (phrase.role) {
      case "statement":
        // Present the theme plainly — no transformation — so each return is
        // recognizably the same idea. Development is where it gets reshaped.
        break;
      case "variation":
        if (rng.bool(0.6)) m = transpose(m, rng.pick([-2, -1, 1, 2]));
        if (rng.bool(0.3 * amount)) m = augment(m, rng.pick([1.5, 2]));
        break;
      case "development":
        if (rng.bool(0.5)) m = invert(m);
        if (rng.bool(0.5)) m = transpose(m, rng.pick([-3, -2, 2, 3]));
        if (rng.bool(0.4 * amount) && m.intervals.length > 2) {
          m = fragment(m, m.intervals.length - 1);
        }
        break;
      case "cadence":
        // Wind down: shorten and slow.
        if (m.intervals.length > 2 && rng.bool(0.6)) {
          m = fragment(m, Math.max(2, m.intervals.length - 1));
        }
        if (rng.bool(0.4)) m = augment(m, 1.5);
        break;
    }
    return m;
  }

  /**
   * Leap resolution, on the diatonic degree line so every note stays in scale.
   * After a wide leap (a 4th or more, measured in semitones), the following note
   * tends to step back in the opposite direction — the classic "leap, then
   * recover" gesture that keeps a melody singable. Probabilistic and
   * style-controlled, eased off as complexity rises so busy, unstable passages
   * keep some angularity. Covers the leap into the bar from the previous note
   * too, not only leaps between notes within the bar.
   */
  private resolveLeaps(degrees: number[], ctx: BarContext): void {
    const p = this.leapResolution * (1 - 0.4 * ctx.state.complexity);
    if (p <= 0 || degrees.length < 2) return;
    const pitchOf = (d: number): number =>
      degreePitch(d, ctx.chord.keyPc, ctx.chord.mode, MELODY_OCTAVE);

    // Leap carried across the bar line: last bar's pitch → this bar's first note.
    // Resolve the second note back toward it.
    if (this.lastPitch !== undefined) {
      const inLeap = pitchOf(degrees[0]!) - this.lastPitch;
      if (Math.abs(inLeap) >= LEAP_SEMITONES && ctx.rng.bool(p)) {
        degrees[1] = degrees[0]! - Math.sign(inLeap);
      }
    }

    // Leaps between notes within the bar: resolve the note after each one.
    for (let i = 1; i < degrees.length - 1; i++) {
      const leap = pitchOf(degrees[i]!) - pitchOf(degrees[i - 1]!);
      if (Math.abs(leap) >= LEAP_SEMITONES && ctx.rng.bool(p)) {
        degrees[i + 1] = degrees[i]! - Math.sign(leap);
      }
    }
  }

  private chooseAnchor(ctx: BarContext): number {
    const target = this.lastPitch ?? TARGET_PITCH;
    const [d1, d3, d5] = triadDegrees(ctx.chord.degree);
    let best = d1;
    let bestCost = Infinity;
    for (const deg of [d1, d3, d5]) {
      const pitch = degreePitch(deg, ctx.chord.keyPc, ctx.chord.mode, MELODY_OCTAVE);
      const cost = Math.abs(pitch - target);
      if (cost < bestCost) {
        bestCost = cost;
        best = deg;
      }
    }
    return best;
  }

  private schedule(
    motif: Motif,
    pitches: number[],
    ctx: BarContext,
    memory: ComposerMemory,
  ): NoteEvent[] {
    const { state, rng, meter, barStartTick } = ctx;
    const barLen = ticksPerBar(meter);

    // Optional starting rest for breathing room. Sparse phrases lead with
    // silence more often, so the motif enters after a gap instead of on the
    // downbeat every time.
    let cursor = 0;
    const restProb =
      ctx.phrasePlan.melodicActivity === "sparse" ? 0.55 : state.density < 0.5 ? 0.35 : 0;
    if (restProb > 0 && rng.bool(restProb)) {
      cursor = Math.round(barLen / 4);
    }

    const velBase = clamp01(0.4 + 0.35 * ctx.phrasePlan.dynamics + 0.05 * state.valence);
    const events: NoteEvent[] = [];

    for (let i = 0; i < pitches.length; i++) {
      const dur = motif.rhythm[i] ?? 0;
      if (cursor >= barLen) break; // out of bar — remaining notes become silence
      const time = barStartTick + cursor;
      const clippedDur = Math.min(dur, barLen - cursor);
      const timingJitter = Math.round((rng.next() - 0.5) * 6);
      const accent = i === 0 ? 0.1 : 0;
      const pitch = pitches[i]!;
      events.push({
        type: "note",
        time: Math.max(barStartTick, time + timingJitter),
        duration: Math.max(1, clippedDur),
        pitch,
        velocity: clamp01(velBase + accent + (rng.next() - 0.5) * 0.08),
        voice: "melody",
      });
      memory.recordPitch(pitch);
      this.lastPitch = pitch;
      cursor += dur;
    }

    return events;
  }
}
