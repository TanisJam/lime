import type { NoteEvent } from "../events/MusicalEvent.js";
import { ticksPerBar, ticksPerBeat } from "../time/MusicalTime.js";
import { chordRoot, type HarmonicEvent } from "../harmony/Chord.js";
import { degreePitch } from "../harmony/Scale.js";
import { clamp01 } from "../state/MusicalState.js";
import type { BarContext } from "../orchestration/BarContext.js";
import type { BassStyle, BassGrooveStyle } from "../style/StylePack.js";
import {
  FUNK_KICK_SIXTEENTHS,
  BACKBEAT_KICK_SIXTEENTHS,
  BOOM_BAP_KICK_SIXTEENTHS,
  CLAVE_KICK_SIXTEENTHS,
} from "../percussion/grooveAnchors.js";

const BASS_OCTAVE = 2;

/**
 * Bass voice — grounded on the chord root, but not a metronome.
 *
 * The bass anchors the harmony, yet it earns its keep musically: it breathes
 * (letting the pad hold the harmony on some interior bars), it varies how it
 * enters a bar (not always the root on beat one), and it moves melodically with
 * diatonic approach notes into the next chord. Density follows the phrase arc,
 * loudness the dynamics contour, and it steps aside when the melody leads.
 */
export class BassGenerator {
  constructor(
    private readonly bassStyle: BassStyle = "default",
    private readonly bassGroove?: BassGrooveStyle,
  ) {}

  generateBar(ctx: BarContext): NoteEvent[] {
    const { chord, nextChord, state, phrasePlan, phrase, rng, meter, barStartTick } = ctx;
    const barLen = ticksPerBar(meter);
    const beat = ticksPerBeat(meter);

    // Bass/melody relationship: step back a tier while the melody leads, fill a
    // little when it rests, so the two voices stay out of each other's way.
    let arc = phrasePlan.energy;
    if (phrasePlan.melodicActivity === "lead") arc *= 0.8;
    else if (phrasePlan.melodicActivity === "tacet") arc = clamp01(arc * 1.12);

    // Breathing: on interior bars the bass may drop out and let the pad hold the
    // harmony, so it isn't a constant presence. Never on a phrase's first bar
    // (the harmony wants grounding there), and rarer as energy climbs.
    if (!phrase.isStart && rng.bool(clamp01(0.4 * (1 - arc)))) return [];

    const root = chordRoot(chord, BASS_OCTAVE);
    // Diatonic fifth (chord tone), not a blind perfect fifth — the vii° / ii°
    // chords have a diminished fifth, so root+7 would leave the scale.
    const fifth = degreePitch(chord.degree + 4, chord.keyPc, chord.mode, BASS_OCTAVE);
    const octave = root + 12;
    const nextRoot = nextChord ? chordRoot(nextChord, BASS_OCTAVE) : root;
    // A diatonic step below the next root — a smooth approach that pulls the ear
    // into the coming chord instead of just restating roots.
    const approach = nextChord ? this.approachTone(nextChord) : fifth;

    const velBase = clamp01(0.42 + 0.3 * phrasePlan.dynamics);
    const events: NoteEvent[] = [];

    const push = (time: number, duration: number, pitch: number) => {
      const jitter = (rng.next() - 0.5) * 0.06;
      events.push({
        type: "note",
        time: barStartTick + time,
        duration,
        pitch,
        velocity: clamp01(velBase + jitter),
        voice: "bass",
      });
    };

    // Rock: a driving straight-8th pulse doubling the chord root, locked with the
    // kick — mostly root, an octave lift mid-beat, walking into the next root on
    // the last eighth. Below arc 0.4 it relaxes to the calm grammar below (a rock
    // ballad intro doesn't pound eighths). The two eighths that fall on
    // BACKBEAT_KICK_SIXTEENTHS (beats 1 and 3, where the backbeat kick always
    // lands) are never thinned — the rest of the pulse is, more aggressively at
    // low density, so the bass locks hardest exactly where the kick does instead
    // of spreading evenly across all eight eighths.
    if (this.bassStyle === "root-drive" && arc >= 0.4) {
      const eighth = beat / 2;
      const steps = meter.numerator * 2;
      const kickAnchors = new Set<number>(BACKBEAT_KICK_SIXTEENTHS);
      const groove = this.bassGroove;
      for (let i = 0; i < steps; i++) {
        const isLast = i === steps - 1;
        const pos = i * 2;
        const onAnchor = kickAnchors.has(pos);
        // Position 10 ("and" of the last beat) is handled separately below,
        // as its own kick-locked dyad, when a groove config is present.
        if (groove && pos === 10) continue;
        let pitch = root;
        if (isLast && nextChord) pitch = approach;
        else if (i % 4 === 2) pitch = octave;
        if (!onAnchor) {
          let keepChance: number;
          if (groove) {
            const sync = groove.syncopation ?? 0.5;
            const lock = groove.kickLock ?? 0;
            // On-beat filler (steps 4/12 — doubling a beat the anchors
            // already cover) is only worth playing when the line ISN'T
            // already locked onto position 10 below; genuinely off-beat
            // filler (steps 2/6/14, plus the walk into the next root on the
            // last eighth) tracks `syncopation` directly.
            keepChance = pos % 4 === 0 ? (1 - lock) / 2 : sync;
          } else if (isLast) {
            keepChance = 1; // unconfigured: always walk into the next root
          } else {
            keepChance = state.density < 0.45 ? 0.35 : 0.52;
          }
          if (!rng.bool(keepChance)) continue;
        }
        push(Math.round(eighth * i), Math.round(eighth), pitch);
      }
      if (groove) {
        const lock = groove.kickLock ?? 0;
        // Position 10 is the one off-anchor spot the backbeat kick itself
        // sometimes plays, beyond its two structural anchors
        // (PercussionGenerator.backbeat's own `beat*2+beat/2` sync push).
        // Two independent draws (expected count 0..2, root then an octave
        // pop) let a highly locked line double the kick there instead of
        // spreading its motion evenly across the bar — the same device
        // walking bass uses for its own kick-locked pickup below.
        if (rng.bool(lock)) push(eighth * 5, eighth, root);
        if (rng.bool(lock)) push(eighth * 5, eighth, octave);
      }
      return events;
    }

    // Jazz/blues walking bass: real walking lines are never four flat quarters
    // — they move with eighth-note skips, chromatic approach notes, the odd
    // rest, and the odd held note. Every beat sits on WALKING_KICK_SIXTEENTHS
    // (SWING_KICK_SIXTEENTHS / SHUFFLE_KICK_SIXTEENTHS, both [0, 4, 8, 12]):
    // jazz/blues drummers feather the kick on all four beats to reinforce
    // exactly this pulse. So the anchor is the four quarter-note downbeats,
    // and the motion that makes a line feel walked — skips, chromatic
    // approaches, the sixteenth-note pickup — happens strictly *around* those
    // downbeats, never instead of them: a walking line that wanders off the
    // kick is worse than a rigid one, not more human.
    if (this.bassStyle === "walking" && arc >= 0.3) {
      const eighth = beat / 2;
      const sixteenth = beat / 4;
      const third = degreePitch(chord.degree + 2, chord.keyPc, chord.mode, BASS_OCTAVE);
      const chromaticApproach = approach - 1; // half-step below the diatonic approach tone
      const beatPitch = [root, rng.pick([fifth, third, octave]), rng.bool(0.6) ? root : fifth, approach];
      const groove = this.bassGroove;
      // Unconfigured defaults reproduce today's fixed rates exactly.
      const restChance = groove ? 0.12 * (1 - (groove.kickLock ?? 0)) : 0.12;
      const ornamentChance = groove ? (groove.syncopation ?? 0.4) : 0.4;
      const chromaticChance = groove ? (groove.syncopation ?? 0.45) : 0.45;
      const pickupChance = groove ? (groove.syncopation ?? 0.4) * 0.5 : 0.2;
      const kickLock = groove?.kickLock ?? 0;

      for (let b = 0; b < 4; b++) {
        const isLast = b === 3;
        // Let the previous note ring through this beat instead of restating
        // it — never on beat 1 (the line's home) or beat 4 (needs to resolve
        // into the next chord). `kickLock` shrinks this toward zero: a
        // tightly-locked line never drops a beat the kick is counting on.
        if (b > 0 && !isLast && rng.bool(restChance)) continue;
        if ((b === 1 || b === 2) && rng.bool(ornamentChance)) {
          // Eighth-note skip leading into beats 2 or 3 — off-anchor motion
          // that still lands its target squarely on the anchor tick.
          push(beat * b - eighth, eighth, beatPitch[b]! - 3);
          push(beat * b, eighth, beatPitch[b]!);
        } else if (isLast && rng.bool(chromaticChance)) {
          // Chromatic double-approach into the next bar's downbeat — a
          // classic walking-bass lead-in. The first note still lands on the
          // anchor; the chromatic passing tone is the off-anchor half.
          push(beat * 3, eighth, third);
          push(beat * 3 + eighth, eighth, chromaticApproach);
        } else {
          push(beat * b, beat, beatPitch[b]!);
        }
      }

      // An occasional sixteenth-note pickup into beat 3 — the small rhythmic
      // wrinkle a real walking line has and a machine-quantised one doesn't
      // (bass16th, GROOVE-CRITERIA.md).
      if (rng.bool(pickupChance)) push(beat * 2 - sixteenth, sixteenth, root - 1);

      // `kickLock`: an extra pickup on the "and" of beat 3 (`beat*2+eighth`)
      // — the exact spot PercussionGenerator.swing()'s "dropped bombs" land
      // on (a bebop kick staple). Two independent draws (expected count
      // 0..2, root then a fifth-below-the-octave color note) let a highly
      // locked line double the kick there instead of spreading its motion
      // evenly — GROOVE-CRITERIA.md: jazz wants both high lock and more
      // off-beat motion at once, which only works if part of that motion
      // itself sits on the kick's own extra hit, not despite it.
      if (kickLock > 0) {
        if (rng.bool(kickLock)) push(beat * 2 + eighth, eighth, fifth);
        if (rng.bool(kickLock)) push(beat * 2 + eighth, eighth, octave);
      }

      return events;
    }

    // Sub / 808. Hip-hop and electronic share this style, but they should
    // not share its shape: house/techno basslines are "simple, repetitive
    // one- or two-note riffs on straight 8th-note rhythms, often layered
    // with a sub-bass drone" (GROOVE-CRITERIA.md, medium confidence) — a
    // drone alone measured 0.88 onsets/bar against a real 5.23, the sparsest
    // voice in the whole engine. Hip-hop's boom-bap 808 stays a genuine
    // drone; electronic gets the riff. The two tempo ranges never overlap
    // (hip-hop 82-96 bpm, electronic 120-130 bpm — see genres.ts), so tempo
    // is a safe, ambient way to tell them apart without a new StylePack
    // field or a bass-side groove parameter.
    if (this.bassStyle === "sub") {
      if (state.tempo >= 110) {
        // House/techno riff: mostly on the "and" of each beat — electronic
        // is the one genre whose bass deliberately does NOT lock to the
        // kick (measured bassKickLock 0.31, the lowest of any genre); it
        // plays *between* the four-on-the-floor kicks, only occasionally
        // touching them, rather than doubling them the way root-drive does.
        if (arc >= 0.2) {
          const eighth = beat / 2;
          const steps = meter.numerator * 2;
          for (let i = 0; i < steps; i++) {
            const onKick = i % 2 === 0; // coincides with the quarter-note kick
            if (!rng.bool(onKick ? 0.35 : 0.85)) continue;
            const pitch = !onKick && rng.bool(0.35) ? octave : root;
            push(Math.round(eighth * i), Math.round(eighth), pitch);
          }
        }
        return events;
      }
      // Hip-hop 808: sparse sustained root, with an occasional syncopated
      // push. The downbeat root lands on boom-bap's own kick (beat 1). The
      // syncopated push lands on BOOM_BAP_KICK_SIXTEENTHS[1] (the "and of
      // 2") about half the time it fires — hip-hop's second kick anchor —
      // and off it the rest of the time, so the lock is meaningful without
      // becoming rigid.
      push(0, beat * 3, root);
      if (arc >= 0.4 && rng.bool(0.5)) {
        const s = beat / 4;
        const onAnchor = rng.bool(0.5);
        push(onAnchor ? s * BOOM_BAP_KICK_SIXTEENTHS[1] : beat * 2 + beat / 2, beat, root);
      }
      return events;
    }

    // Funk: syncopated 16ths anchored on "the one", root with octave pops. The
    // pattern includes every position in FUNK_KICK_SIXTEENTHS so the bass locks
    // with the kick — real funk rhythm sections interlock, not just share a
    // downbeat — and adds a couple of pushed off-kick 16ths (3 and 10) for the
    // syncopated character.
    if (this.bassStyle === "funk" && arc >= 0.4) {
      const s = beat / 4;
      // The anchor kicks and the two core pushes are the line's identity and
      // never move: dropping any of them would break the interlock this branch
      // exists to provide. Everything else is drawn per bar.
      //
      // `syncopation` used to be a *threshold* here — `>= 0.6` selected one of two
      // hardcoded finishes — so the shipped funk configuration (syncopation 0.3)
      // picked the grounded finish before any random draw and kept it forever
      // after: one identical bar, in every seed, for the whole session. No
      // positional metric in the groove tables could see it, because every share
      // stayed on target. It is a continuous probability here now, exactly as it
      // already was in the walking and root-drive branches.
      const sync = this.bassGroove?.syncopation ?? 1;
      const onsets = new Set<number>([...FUNK_KICK_SIXTEENTHS, 3, 10]);

      // Finish: pushed out on the off-quarter 16th, or grounded on the quarters.
      // Both readings are ones the ear already accepted; which one a bar takes is
      // now a per-bar draw rather than a per-style constant.
      //
      // Adding a lead-in sixteenth *around* these onsets was tried and rejected:
      // it dilutes `bassKickLock`, which is a share over the line's own onsets, and
      // an extra onset that the kick itself does not play lowers that share without
      // the line leaving the kick at all (GROOVE-CRITERIA.md, third measurement
      // trap). Variety has to come from recombining the line's real hits.
      if (rng.bool(sync)) {
        onsets.add(13);
      } else {
        onsets.add(8);
        onsets.add(12);
      }
      for (let i = 0; i < 16; i++) {
        if (!onsets.has(i)) continue;
        const pitch = i === 0 ? root : rng.bool(0.3) ? octave : root;
        push(Math.round(s * i), Math.round(s), pitch);
      }
      return events;
    }

    // Latin tumbao: anticipated bass — a downbeat touch, then off the "and of
    // 2" and beat 4, pulling into the next chord ahead of the beat. The
    // downbeat and the "and of 2" both sit on CLAVE_KICK_SIXTEENTHS (the
    // bombo's own two hits), so the tumbao and the bombo interlock instead of
    // the tumbao's anticipatory phrasing simply floating past the kick.
    if (this.bassStyle === "montuno" && arc >= 0.4) {
      const s = beat / 4;
      push(s * CLAVE_KICK_SIXTEENTHS[0], beat / 2, root); // downbeat touch
      push(s * CLAVE_KICK_SIXTEENTHS[1], beat, root); // and of 2
      push(beat * 3, beat / 2, fifth); // beat 4
      push(beat * 3 + beat / 2, beat / 2, nextChord ? nextRoot : root); // anticipation
      return events;
    }

    if (arc < 0.3) {
      // Calm: a sustained root, but now and then lift to the fifth for the
      // second half so a long quiet passage isn't one endlessly held pitch.
      if (rng.bool(0.3)) {
        push(0, beat * 2, root);
        push(beat * 2, beat * 2, fifth);
      } else {
        push(0, barLen, root);
      }
    } else if (arc < 0.55) {
      // Two half notes. The second is a fifth, an approach into the next chord,
      // or the root — chosen so consecutive bars don't repeat the same shape.
      push(0, beat * 2, root);
      const second =
        nextChord && rng.bool(0.4) ? approach : state.instability > 0.4 ? fifth : root;
      push(beat * 2, beat * 2, second);
    } else if (arc < 0.8) {
      // A quarter-note line. Occasionally rest beat one for a syncopated lift,
      // and walk into the next root through the approach note.
      const last = nextChord ? approach : fifth;
      const syncopate = !phrase.isStart && rng.bool(0.25);
      const pitches = [root, fifth, root, last];
      for (let i = 0; i < 4; i++) {
        if (syncopate && i === 0) continue; // let the downbeat breathe
        push(beat * i, beat, pitches[i]!);
      }
    } else {
      // Driving eighths with octaves, walking into the next root on the last
      // hit. This is the fallback grammar any style reaches at high energy
      // (including bassStyle "default" — e.g. Rock's corpus-derived pack),
      // so it thins off-anchor eighths the same way `root-drive` does: beats
      // 1 and 3 (BACKBEAT_KICK_SIXTEENTHS) are where a driving kick most
      // commonly lands, so the bass locks hardest there instead of spreading
      // evenly across all eight eighths.
      const seq = [root, root, fifth, root, octave, fifth, root, nextChord ? approach : nextRoot];
      const eighth = beat / 2;
      const kickAnchors = new Set<number>(BACKBEAT_KICK_SIXTEENTHS);
      for (let i = 0; i < 8; i++) {
        const isLast = i === 7;
        const onAnchor = kickAnchors.has(i * 2);
        // Skip some off-beat eighths at lower density to keep it musical, not
        // busy; skip off-anchor eighths a bit more often regardless of
        // density so the anchor beats dominate the bar's onset count.
        if (!isLast && !onAnchor) {
          if (state.density < 0.5 && i % 2 === 1 && rng.bool(0.4)) continue;
          if (rng.bool(0.4)) continue;
        }
        push(Math.round(eighth * i), Math.round(eighth), seq[i]!);
      }
    }

    return events;
  }

  /** A diatonic scale tone a step below the next chord's root — an approach note. */
  private approachTone(nextChord: HarmonicEvent): number {
    return degreePitch(nextChord.degree - 1, nextChord.keyPc, nextChord.mode, BASS_OCTAVE);
  }
}
