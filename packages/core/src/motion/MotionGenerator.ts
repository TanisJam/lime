import type { NoteEvent } from "../events/MusicalEvent.js";
import { ticksPerBar, ticksPerBeat } from "../time/MusicalTime.js";
import { degreePitch, triadDegrees } from "../harmony/Scale.js";
import { clamp01 } from "../state/MusicalState.js";
import type { BarContext } from "../orchestration/BarContext.js";
import type { MotionStyle } from "../style/StylePack.js";

const MOTION_OCTAVE = 4;

/**
 * Motion voice — the internal-movement layer between the harmonic bed and the
 * melody: arpeggios (electronic/pop), an ostinato/montuno (latin), or offbeat
 * comping stabs (funk/jazz). It runs only when a StylePack asks for one, so most
 * genres are unaffected. Chord-tone based, so it always fits the harmony.
 */
export class MotionGenerator {
  constructor(private readonly style: MotionStyle) {}

  generateBar(ctx: BarContext): NoteEvent[] {
    const { chord, phrasePlan, rng, meter, barStartTick } = ctx;
    const arc = phrasePlan.energy;
    if (arc < 0.3) return [];

    const beat = ticksPerBeat(meter);
    const barLen = ticksPerBar(meter);
    const beats = meter.numerator;
    const [d1, d3, d5] = triadDegrees(chord.degree);
    const tone = (deg: number, oct = MOTION_OCTAVE) =>
      degreePitch(deg, chord.keyPc, chord.mode, oct);
    const tones = [tone(d1), tone(d3), tone(d5), tone(d1, MOTION_OCTAVE + 1)];
    const vel = clamp01(0.26 + 0.3 * phrasePlan.dynamics);

    const events: NoteEvent[] = [];
    const push = (time: number, duration: number, pitch: number, v = vel) => {
      if (time >= barLen) return;
      events.push({
        type: "note",
        time: barStartTick + Math.round(time),
        duration: Math.round(Math.min(duration, barLen - time)),
        pitch,
        velocity: clamp01(v + (rng.next() - 0.5) * 0.06),
        voice: "motion",
      });
    };

    if (this.style === "arp") {
      // Arpeggiate the chord tones: 8ths, or 16ths when the energy is up.
      const sub = arc > 0.6 ? 4 : 2;
      const step = beat / sub;
      for (let i = 0; i < beats * sub; i++) push(step * i, step, tones[i % tones.length]!);
    } else if (this.style === "ostinato") {
      // A montuno-ish repeated cell: low-high-top-high in straight 8ths.
      const seq = [tones[0]!, tones[2]!, tones[3]!, tones[2]!];
      const step = beat / 2;
      for (let i = 0; i < beats * 2; i++) push(step * i, step, seq[i % seq.length]!);
    } else {
      // Offbeat comping stabs: short chord hits on the "and" of each beat.
      for (let b = 0; b < beats; b++) {
        const t = beat * b + beat / 2;
        for (const p of [tones[0]!, tones[1]!, tones[2]!]) push(t, beat / 3, p, vel * 0.9);
      }
    }
    return events;
  }
}
