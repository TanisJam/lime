import type { NoteEvent } from "../events/MusicalEvent.js";
import { ticksPerBar } from "../time/MusicalTime.js";
import { voiceLeadTriad } from "../harmony/Voicing.js";
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
  private previousTop: number | undefined;

  generateBar(ctx: BarContext): NoteEvent[] {
    const { chord, state, rng, meter, barStartTick } = ctx;
    const barLen = ticksPerBar(meter);

    const baseOctave = state.brightness < 0.35 ? 3 : 4;
    const targetTop = Math.round(60 + state.brightness * 12);
    let voicing = voiceLeadTriad(chord, baseOctave, this.previousTop, targetTop);
    this.previousTop = Math.max(...voicing);

    // Note count: thin out at low density, thicken (octave doubling) when strong.
    if (state.density < 0.25 && voicing.length > 2) {
      voicing = [voicing[0]!, voicing[voicing.length - 1]!];
    }
    if (state.energy > 0.6 && state.density > 0.5) {
      voicing = [...voicing, voicing[0]! + 12];
    }

    // Re-attacks per bar: pads stay smooth; more motion only when energetic.
    let reattacks: number;
    if (state.energy < 0.4) reattacks = 1;
    else if (state.energy < 0.75) reattacks = 2;
    else reattacks = state.complexity > 0.6 ? 4 : 2;

    const division = barLen / reattacks;
    const velocityBase = clamp01(0.26 + 0.26 * state.energy + 0.1 * state.valence);

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
