import type { HarmonicEvent } from "./Chord.js";
import { chordPitches } from "./Chord.js";

/**
 * Chord voicing with light voice leading.
 *
 * Given the previous voicing's top note, choose the inversion + octave that
 * moves the least, so pads and harmony parts glide instead of jumping.
 */

/** All inversions of a triad within one octave span, plus ±12 shifts. */
function voicingCandidates(triad: number[]): number[][] {
  const [r, third, fifth] = triad as [number, number, number];
  const inversions: number[][] = [
    [r, third, fifth],
    [third, fifth, r + 12],
    [fifth, r + 12, third + 12],
  ];
  const out: number[][] = [];
  for (const inv of inversions) {
    for (const shift of [-12, 0, 12]) {
      out.push(inv.map((p) => p + shift));
    }
  }
  return out;
}

/** Top (highest) note of a voicing. */
function topNote(voicing: number[]): number {
  return Math.max(...voicing);
}

/**
 * Pick the triad voicing nearest a target top note (or the previous top note),
 * keeping the whole voicing within a sensible pad register.
 */
export function voiceLeadTriad(
  chord: HarmonicEvent,
  baseOctave: number,
  previousTopPitch: number | undefined,
  targetTop: number,
): number[] {
  const triad = chordPitches(chord, baseOctave);
  const target = previousTopPitch ?? targetTop;
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const cand of voicingCandidates(triad)) {
    const top = topNote(cand);
    const low = Math.min(...cand);
    // Prefer proximity to target top, penalize leaving a comfortable range.
    let cost = Math.abs(top - target);
    if (low < 36) cost += (36 - low) * 2;
    if (top > 84) cost += (top - 84) * 2;
    if (cost < bestCost) {
      bestCost = cost;
      best = cand;
    }
  }
  return (best ?? triad).slice().sort((a, b) => a - b);
}
