import type { NoteEvent } from "../events/MusicalEvent.js";
import { ticksPerBar } from "../time/MusicalTime.js";
import { voiceLeadChord, powerChordVoicing } from "../harmony/Voicing.js";
import { ROLE_REGISTERS } from "../harmony/Registers.js";
import { clamp01 } from "../state/MusicalState.js";
import type { BarContext } from "../orchestration/BarContext.js";
import type { ChordStyle } from "../style/StylePack.js";

/**
 * Pad voice — the harmonic bed.
 *
 * Long durations, low rhythmic density, smooth voice leading between chords.
 * State affects register (brightness), note count (density/energy), velocity,
 * and how often the chord re-attacks within a bar (energy/complexity).
 *
 * v0.3: the pad reads its role — the harmonic bed — in the orchestration plan.
 * When the bed is the focus (typically while the melody rests) it blooms
 * forward; when it sits in the background under a busy melody it thins and
 * quiets to leave room. The common case (melody leading, bed in back) is
 * unchanged from v0.2, so the orchestration only ever adds contrast.
 */
export class PadGenerator {
  private previousVoicing: number[] | undefined;

  constructor(private readonly chordStyle: ChordStyle = "triad") {}

  generateBar(ctx: BarContext): NoteEvent[] {
    const { chord, state, rng, meter, barStartTick, orchestration } = ctx;
    const barLen = ticksPerBar(meter);

    // Where the harmonic bed sits in the arrangement this bar.
    const depth = orchestration.depth["harmonic-bed"] ?? "background";
    const bedActivity = orchestration.activity["harmonic-bed"] ?? 0.2;
    const isFocus = orchestration.focus === "harmonic-bed";

    const baseOctave = state.brightness < 0.35 ? 3 : 4;
    // Keep the pad's top within its own register, below the melody's range, so
    // brightness moves it around the low-to-upper-mid without crowding the line.
    const targetTop = Math.round(58 + state.brightness * 13);
    // Voice-lead the harmonic core (the triad), then remember it as the anchor
    // for the next bar — before any density thinning/doubling below, so the
    // voice leading always compares like triad with like triad.
    let voicing: number[];
    if (this.chordStyle === "power") {
      // Power chords: root + fifth + octave, no third — the open rock/metal bed
      // that sits cleanly under distortion. No triad thinning/doubling; the bare
      // shape is the point.
      voicing = powerChordVoicing(chord, baseOctave, this.previousVoicing, targetTop);
      this.previousVoicing = voicing;
    } else {
      voicing = voiceLeadChord(chord, baseOctave, this.previousVoicing, targetTop);
      this.previousVoicing = voicing;

      // Note count: thin out at low density — but never thin the bed while it is
      // the foreground of the phrase; it should stay full when it carries the music.
      if (state.density < 0.25 && voicing.length > 2 && depth !== "foreground") {
        voicing = [voicing[0]!, voicing[voicing.length - 1]!];
      }
      // Octave doubling when strong — and, when the bed leads, a touch more
      // readily, so a bed-led swell has some bloom without needing high energy.
      // Only while it stays in the pad's register, so it never climbs into the melody.
      const doubleWhenStrong = state.energy > 0.6 && state.density > 0.5;
      const doubleWhenLeading = isFocus && state.energy > 0.4;
      if (doubleWhenStrong || doubleWhenLeading) {
        const doubled = voicing[0]! + 12;
        if (doubled <= ROLE_REGISTERS.pad.hi) voicing = [...voicing, doubled];
      }
    }

    // Re-attacks per bar: pads stay smooth; more motion only when energetic.
    // Driven by the phrase arc, so re-attacks pick up through a build and ease
    // off into a cadence rather than holding a flat rate across the phrase.
    const arc = ctx.phrasePlan.energy;
    let reattacks: number;
    if (arc < 0.4) reattacks = 1;
    else if (arc < 0.75) reattacks = 2;
    else reattacks = state.complexity > 0.6 ? 4 : 2;
    // Then shaped by the bed's place in the arrangement: a little motion when it
    // leads a calm phrase, and it gives ground — staying still — when the budget
    // says the melody is carrying the activity, so the two never clutter.
    if (isFocus && reattacks < 2) reattacks = 2;
    if (depth === "background" && bedActivity < 0.15) reattacks = Math.min(reattacks, 2);

    const division = barLen / reattacks;
    // Depth sets how present the bed sits: gently forward in front, at rest in back.
    const depthGain = depth === "foreground" ? 1.12 : depth === "midground" ? 1.05 : 1.0;
    const velocityBase = clamp01(
      (0.26 + 0.26 * ctx.phrasePlan.dynamics + 0.1 * state.valence) * depthGain,
    );

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
