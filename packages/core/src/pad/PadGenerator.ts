import type { NoteEvent } from "../events/MusicalEvent.js";
import { ticksPerBar } from "../time/MusicalTime.js";
import { voiceLeadChord } from "../harmony/Voicing.js";
import { ROLE_REGISTERS } from "../harmony/Registers.js";
import { clamp01 } from "../state/MusicalState.js";
import type { BarContext } from "../orchestration/BarContext.js";

/**
 * Pad voice — the harmonic bed.
 *
 * Long durations, low rhythmic density, smooth voice leading between chords.
 * State affects register (brightness), note count (density/energy), velocity,
 * and how often the chord re-attacks within a bar (energy/complexity).
 */
export class PadGenerator {
  private previousVoicing: number[] | undefined;

  generateBar(ctx: BarContext): NoteEvent[] {
    const { chord, state, rng, meter, barStartTick } = ctx;
    const barLen = ticksPerBar(meter);

    const baseOctave = state.brightness < 0.35 ? 3 : 4;
    // Keep the pad's top within its own register, below the melody's range, so
    // brightness moves it around the low-to-upper-mid without crowding the line.
    const targetTop = Math.round(58 + state.brightness * 13);
    // Voice-lead the harmonic core (the triad), then remember it as the anchor
    // for the next bar — before any density thinning/doubling below, so the
    // voice leading always compares like triad with like triad.
    let voicing = voiceLeadChord(chord, baseOctave, this.previousVoicing, targetTop);
    this.previousVoicing = voicing;

    // Note count: thin out at low density, thicken (octave doubling) when strong.
    if (state.density < 0.25 && voicing.length > 2) {
      voicing = [voicing[0]!, voicing[voicing.length - 1]!];
    }
    // Thicken with an octave doubling when strong — but only while it stays in
    // the pad's register, so the doubling never climbs into the melody's range.
    if (state.energy > 0.6 && state.density > 0.5) {
      const doubled = voicing[0]! + 12;
      if (doubled <= ROLE_REGISTERS.pad.hi) voicing = [...voicing, doubled];
    }

    // Re-attacks per bar: pads stay smooth; more motion only when energetic.
    // Driven by the phrase arc, so re-attacks pick up through a build and ease
    // off into a cadence rather than holding a flat rate across the phrase.
    const arc = ctx.phrasePlan.energy;
    let reattacks: number;
    if (arc < 0.4) reattacks = 1;
    else if (arc < 0.75) reattacks = 2;
    else reattacks = state.complexity > 0.6 ? 4 : 2;

    const division = barLen / reattacks;
    const velocityBase = clamp01(0.26 + 0.26 * ctx.phrasePlan.dynamics + 0.1 * state.valence);

    const events: NoteEvent[] = [];
    for (let i = 0; i < reattacks; i++) {
      const time = barStartTick + Math.round(i * division);
      // Legato: hold each attack for its full division.
      const duration = Math.round(division);
      for (const pitch of voicing) {
        const jitter = (rng.next() - 0.5) * 0.05;
        events.push({
          type: "note",
          time,
          duration,
          pitch,
          velocity: clamp01(velocityBase + jitter),
          voice: "pad",
        });
      }
    }
    return events;
  }
}
