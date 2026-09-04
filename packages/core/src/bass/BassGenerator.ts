import type { NoteEvent } from "../events/MusicalEvent.js";
import { ticksPerBar, ticksPerBeat } from "../time/MusicalTime.js";
import { chordRoot, type HarmonicEvent } from "../harmony/Chord.js";
import { degreePitch } from "../harmony/Scale.js";
import { clamp01 } from "../state/MusicalState.js";
import type { BarContext } from "../orchestration/BarContext.js";
import type { BassStyle } from "../style/StylePack.js";

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
  constructor(private readonly bassStyle: BassStyle = "default") {}

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
    // ballad intro doesn't pound eighths).
    if (this.bassStyle === "root-drive" && arc >= 0.4) {
      const eighth = beat / 2;
      const steps = meter.numerator * 2;
      for (let i = 0; i < steps; i++) {
        const isLast = i === steps - 1;
        let pitch = root;
        if (isLast && nextChord) pitch = approach;
        else if (i % 4 === 2) pitch = octave;
        if (!isLast && i % 2 === 1 && state.density < 0.45 && rng.bool(0.4)) continue;
        push(Math.round(eighth * i), Math.round(eighth), pitch);
      }
      return events;
    }

    // Jazz walking bass: a quarter-note line through chord tones into the next
    // root — root, then stepping through fifth/third and an approach note.
    if (this.bassStyle === "walking" && arc >= 0.3) {
      const third = degreePitch(chord.degree + 2, chord.keyPc, chord.mode, BASS_OCTAVE);
      const seq = [root, fifth, third, nextChord ? approach : fifth];
      for (let i = 0; i < 4; i++) push(beat * i, beat, seq[i]!);
      return events;
    }

    // Sub / 808: sparse sustained root, with an occasional syncopated push.
    if (this.bassStyle === "sub") {
      push(0, beat * 3, root);
      if (arc >= 0.4 && rng.bool(0.5)) push(beat * 2 + beat / 2, beat, root);
      return events;
    }

    // Funk: syncopated 16ths anchored on "the one", root with octave pops.
    if (this.bassStyle === "funk" && arc >= 0.4) {
      const s = beat / 4;
      const pat = [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0];
      for (let i = 0; i < 16; i++) {
        if (!pat[i]) continue;
        const pitch = i === 0 ? root : rng.bool(0.3) ? octave : root;
        push(Math.round(s * i), Math.round(s), pitch);
      }
      return events;
    }

    // Latin tumbao: anticipated bass — off the "and of 2" and beat 4, pulling
    // into the next chord ahead of the beat.
    if (this.bassStyle === "montuno" && arc >= 0.4) {
      push(beat + beat / 2, beat, root); // and of 2
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
      // Driving eighths with octaves, walking into the next root on the last hit.
      const seq = [root, root, fifth, root, octave, fifth, root, nextChord ? approach : nextRoot];
      const eighth = beat / 2;
      for (let i = 0; i < 8; i++) {
        // Skip some off-beat eighths at lower density to keep it musical, not busy.
        if (state.density < 0.5 && i % 2 === 1 && rng.bool(0.4)) continue;
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
