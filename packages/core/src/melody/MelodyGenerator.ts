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

/** Pitch-class offsets (from the tonic) of the snap scales. */
const SNAP_SCALES: Record<Exclude<MelodyScale, "diatonic">, readonly number[]> = {
  "minor-pentatonic": [0, 3, 5, 7, 10],
  "major-pentatonic": [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10], // minor pentatonic + ♭5
};

/**
 * Snap a pitch to the nearest tone of a scale in the key. Preserves register
 * (moves at most a whole step), so a diatonic contour becomes a pentatonic/blues
 * riff without losing its shape.
 */
function snapToScale(pitch: number, keyPc: number, scale: MelodyScale): number {
  if (scale === "diatonic") return pitch;
  const set = SNAP_SCALES[scale];
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
 * sounds at all; at low energy it deliberately falls silent for whole phrases
 * (`melodicActivity: "tacet"`). Above that, presence and rest are phrase-shaped
 * rather than a bar-by-bar coin flip: the line rests where a real phrase would
 * breathe — at a phrase's last bar, or the bar approaching a cadence — and
 * otherwise keeps going, so silence clusters at structural boundaries instead
 * of scattering uniformly. Motif recurrence gives the music a memory.
 */
export class MelodyGenerator {
  private readonly motifGen: MotifGenerator;
  private readonly leapResolution: number;
  private readonly scale: MelodyScale;
  private readonly motifDevelopment: number;
  private activeMotif: Motif | undefined;
  private lastPitch: number | undefined;

  constructor(rng: SeededRandom, melody?: MelodyStyle) {
    this.motifGen = new MotifGenerator(rng.derive("motif"), melody);
    this.leapResolution = melody?.leapResolution ?? DEFAULT_LEAP_RESOLUTION;
    this.scale = melody?.scale ?? "diatonic";
    // A style that says nothing about development still gets some: without it
    // the theme never reshapes and a new idea almost never arrives (both odds
    // below are scaled by this knob), so the line has nowhere to go across a
    // long piece. 0.3 is a light touch — noticeably more alive than 0, still
    // shy of a style that leans into heavy development on purpose.
    this.motifDevelopment = melody?.motifDevelopment ?? 0.3;
  }

  generateBar(ctx: BarContext, memory: ComposerMemory): NoteEvent[] {
    const { phrasePlan } = ctx;

    // 1. Restraint: how present should the melody be this bar? The phrase plan
    //    decides, so every voice agrees on the gesture. A `tacet` phrase simply
    //    doesn't play — the melody is allowed to sit out whole phrases.
    if (phrasePlan.melodicActivity === "tacet") return [];
    // Always state the theme at the top of a statement phrase (unless the whole
    // phrase is tacet): that downbeat is the "here is the idea" moment, so it
    // shouldn't be swallowed by a rest. Elsewhere the melody rests where a
    // phrase actually breathes, not on a coin flip (see shouldRest).
    const isThemeHead = ctx.phrase.isStart && ctx.phrase.role === "statement";
    if (!isThemeHead && this.shouldRest(ctx)) return [];

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
   * Whether the melody rests this bar — phrase-structured, not a per-bar coin
   * flip. A real line breathes at specific places: the last bar of a phrase
   * (the gesture is done, a new one is about to start) and the bar approaching
   * a cadence (stepping back so the resolution lands clean). Every other bar
   * inside a phrase keeps going, so rests cluster at those boundaries instead
   * of scattering uniformly across the piece — and because most bars are no
   * longer eligible to rest at all, the line is present far more often overall.
   */
  private shouldRest(ctx: BarContext): boolean {
    const { phrase, phrasePlan, rng } = ctx;
    const atBoundary = phrase.isLastBar || phrasePlan.cadenceIntent === "approaching";
    if (!atBoundary) return false;
    return rng.bool(this.restProbabilityAt(ctx));
  }

  /**
   * Chance of taking the breath once a bar is a phrase boundary (see
   * shouldRest). A `lead` phrase rides through its own boundary more often
   * than not; a `sparse` phrase usually takes it; and a cadence that is about
   * to resolve leans further still, so the harmony lands without the melody
   * stepping on it.
   */
  private restProbabilityAt(ctx: BarContext): number {
    const { phrasePlan } = ctx;
    let p = 0.4;
    if (phrasePlan.melodicActivity === "lead") p = 0.15;
    else if (phrasePlan.melodicActivity === "sparse") p = 0.6;
    if (phrasePlan.cadenceIntent === "resolving") p += 0.2;
    else if (phrasePlan.cadenceIntent === "approaching") p += 0.1;
    return clamp01(p);
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

    // Rarely introduce a brand-new motif mid-piece for future return; a higher
    // motifDevelopment brings fresh material in more often (default 0 = as before).
    if (rng.bool(0.05 * state.instability + 0.08 * this.motifDevelopment) && memory.motifs.length < 6) {
      const m = this.motifGen.create(state.complexity);
      memory.addMotif(m);
    }

    return this.activeMotif ?? memory.motifs[0]!;
  }

  private vary(base: Motif, ctx: BarContext): Motif {
    const { state, phrase, rng } = ctx;
    let m = base;
    const amount = 0.5 * state.complexity + 0.5 * state.instability;
    // motifDevelopment (default 0) lifts the reshape odds so the theme evolves
    // more as it develops. At 0 every probability below is byte-identical.
    const dev = this.motifDevelopment;

    switch (phrase.role) {
      case "statement":
        // Present the theme plainly — no transformation — so each return is
        // recognizably the same idea. Development is where it gets reshaped.
        break;
      case "variation":
        if (rng.bool(0.6 + 0.35 * dev)) m = transpose(m, rng.pick([-2, -1, 1, 2]));
        if (rng.bool(0.3 * amount + 0.4 * dev)) m = augment(m, rng.pick([1.5, 2]));
        break;
      case "development":
        if (rng.bool(0.5 + 0.4 * dev)) m = invert(m);
        if (rng.bool(0.5 + 0.35 * dev)) m = transpose(m, rng.pick([-3, -2, 2, 3]));
        if (rng.bool(0.4 * amount + 0.4 * dev) && m.intervals.length > 2) {
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

    // A busy development has more to say than a short cell repeated once:
    // sequence it — append the same shape a diatonic step away, the plain
    // developmental gesture — so building bars actually yield a longer line
    // instead of the same 3-4 notes at every activity level. This is where
    // motifDevelopment (see the constructor) has somewhere to go: it lifts
    // the odds here directly, on top of this bar's own share of the
    // orchestration's activity budget (not a flat constant), so a quiet
    // development barely extends and a driving one usually does. Reserved for
    // "development" alone — the statement must stay recognizably plain (see
    // its case above) and a cadence has just wound down — so this only ever
    // appends to what vary() already produced there, never reshapes it.
    const melodyShare = ctx.orchestration.activity["primary-melody"] ?? 0;
    const extendChance = clamp01(0.5 * melodyShare + 0.3 * this.motifDevelopment);
    if (phrase.role === "development" && m.intervals.length <= 4 && rng.bool(extendChance)) {
      const seq = transpose(m, rng.pick([-2, -1, 1, 2]));
      m = {
        id: `${m.id}^seq`,
        intervals: [...m.intervals, ...seq.intervals],
        rhythm: [...m.rhythm, ...seq.rhythm],
      };
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

    // How busy the line should read this bar: the orchestration's shared
    // activity budget (this role's own slice, when a value has been assigned)
    // folded with the phrase's energy — not a flat constant, so a lead line in
    // a busy passage fills out and a sparse one stays sparse.
    const activity = clamp01(
      0.6 * (ctx.orchestration.activity["primary-melody"] ?? ctx.phrasePlan.energy) +
        0.4 * ctx.phrasePlan.energy,
    );

    // Optional starting rest for breathing room. Sparse phrases lead with
    // silence more often, so the motif enters after a gap instead of on the
    // downbeat every time — but a busy, active bar leads with less of it, so
    // the extra room goes to notes instead of a longer silence.
    let cursor = 0;
    const leadInProb =
      (ctx.phrasePlan.melodicActivity === "sparse" ? 0.55 : state.density < 0.5 ? 0.35 : 0) *
      (1 - 0.7 * activity);
    if (leadInProb > 0 && rng.bool(leadInProb)) {
      cursor = Math.round(barLen / 4);
    }

    // Fit the motif into the room left in the bar. At low activity an overlong
    // motif is simply cut off, same as before — a sparse bar stays sparse. At
    // high activity the durations compress toward fitting the whole motif
    // instead of dropping its tail, so a busy phrase actually gets to finish
    // the idea it started rather than losing half of it to overflow.
    const totalDur = motif.rhythm.reduce((s, d) => s + d, 0);
    const room = barLen - cursor;
    const fitScale = totalDur > 0 && totalDur > room ? room / totalDur : 1;
    const compression = 1 - activity * (1 - fitScale);

    const velBase = clamp01(0.4 + 0.35 * ctx.phrasePlan.dynamics + 0.05 * state.valence);
    const events: NoteEvent[] = [];

    for (let i = 0; i < pitches.length; i++) {
      const rawDur = motif.rhythm[i] ?? 0;
      const dur = Math.max(40, Math.round(rawDur * compression));
      if (cursor >= barLen) break; // out of bar — remaining notes become silence
      const time = barStartTick + cursor;
      const clippedDur = Math.min(dur, barLen - cursor);
      // No timing jitter here: the Humanizer owns microtiming for every voice
      // now, so a second displacement at this level would stack on top of it —
      // and it would be the wrong shape anyway. This one was a fixed ±3 ticks,
      // which is a different amount of time at 90 and at 180 bpm; the feel
      // layer works in milliseconds and scales with the note's own duration.
      const accent = i === 0 ? 0.1 : 0;
      const pitch = pitches[i]!;
      events.push({
        type: "note",
        time,
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
