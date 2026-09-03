import type { NoteEvent } from "../events/MusicalEvent.js";
import { ticksPerBar, ticksPerBeat } from "../time/MusicalTime.js";
import { chordRoot } from "../harmony/Chord.js";
import { degreePitch } from "../harmony/Scale.js";
import { clamp01 } from "../state/MusicalState.js";
import type { BarContext } from "../orchestration/BarContext.js";

const BASS_OCTAVE = 2;

/**
 * Bass voice — derived from the chord root.
 *
 * Low energy: a single sustained root. Higher energy adds a pulse, the fifth,
 * octaves, and a passing note that leads into the next chord (when complexity is
 * high). Deliberately conservative.
 */
export class BassGenerator {
  generateBar(ctx: BarContext): NoteEvent[] {
    const { chord, nextChord, state, phrasePlan, rng, meter, barStartTick } = ctx;
    const barLen = ticksPerBar(meter);
    const beat = ticksPerBeat(meter);
    // Phrase shape: the bass pattern follows the phrase's energy arc, so it
    // gathers motion through a build and settles into a cadence. Loudness stays
    // on raw state (that is the dynamics step).
    //
    // Bass/melody relationship: coordinate through the plan so the two voices
    // stay out of each other's way. When the melody is leading, the bass steps
    // back a tier to leave it room; when the melody is tacet, the bass may fill
    // the space a little. This keeps them from both being busy at once.
    let arc = phrasePlan.energy;
    if (phrasePlan.melodicActivity === "lead") arc *= 0.8;
    else if (phrasePlan.melodicActivity === "tacet") arc = clamp01(arc * 1.12);

    const root = chordRoot(chord, BASS_OCTAVE);
    // Diatonic fifth (chord tone), not a blind perfect fifth — the vii° / ii°
    // chords have a diminished fifth, so root+7 would leave the scale.
    const fifth = degreePitch(chord.degree + 4, chord.keyPc, chord.mode, BASS_OCTAVE);
    const octave = root + 12;
    const nextRoot = nextChord ? chordRoot(nextChord, BASS_OCTAVE) : root;

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

    if (arc < 0.3) {
      // One sustained root for the whole bar.
      push(0, barLen, root);
    } else if (arc < 0.55) {
      // Root then fifth, half notes.
      push(0, beat * 2, root);
      push(beat * 2, beat * 2, state.instability > 0.4 ? fifth : root);
    } else if (arc < 0.8) {
      // Quarter pulse: root, fifth, root, then anticipate the next root.
      const last = nextChord && state.complexity > 0.5 ? nextRoot : fifth;
      const pitches = [root, fifth, root, last];
      for (let i = 0; i < 4; i++) push(beat * i, beat, pitches[i]!);
    } else {
      // Eighth-ish movement with octaves; anticipate the next root on the last hit.
      const seq = [root, root, fifth, root, octave, fifth, root, nextRoot];
      const eighth = beat / 2;
      for (let i = 0; i < 8; i++) {
        // Skip some eighths at lower density to keep it musical, not busy.
        if (state.density < 0.5 && i % 2 === 1 && rng.bool(0.4)) continue;
        push(Math.round(eighth * i), Math.round(eighth), seq[i]!);
      }
    }

    return events;
  }
}
