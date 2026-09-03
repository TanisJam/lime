import type { HarmonicEvent } from "./Chord.js";
import { chordPitches } from "./Chord.js";
import { ROLE_REGISTERS } from "./Registers.js";

/**
 * Chord voicing with real voice leading.
 *
 * Given the previous chord's voicing, choose the inversion + octave placement
 * that moves the fewest semitones overall, holds common tones, avoids large
 * single-voice leaps, and stays inside a comfortable pad register — the way a
 * keyboard player keeps their hand still and lets shared notes ring. Voices are
 * matched rank-for-rank on the sorted lines, so a candidate can never cross a
 * voice past its neighbour. Deterministic: no RNG, ties broken by candidate
 * order.
 */

/** Comfortable pad register; notes outside it are penalized back in. */
const PAD_LOW = ROLE_REGISTERS.pad.lo;
const PAD_HIGH = ROLE_REGISTERS.pad.hi;
/** A single voice moving more than a 5th reads as a leap, not a glide. */
const LEAP_LIMIT = 7;
/** Reward per held (common) tone — biases toward letting shared notes ring. */
const COMMON_TONE_BONUS = 1.5;
/** Mild pull of the top voice toward the brightness-implied target register. */
const BRIGHTNESS_WEIGHT = 0.5;

/** All inversions of a triad within an octave, each shifted ±12, sorted low→high. */
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
      out.push(inv.map((p) => p + shift).sort((a, b) => a - b));
    }
  }
  return out;
}

/**
 * Cost of moving to `candidate` (sorted low→high) from `previousVoicing`.
 * Lower is smoother. With no previous voicing, only register and the target-top
 * attraction apply, so the first chord simply sits in a sensible place.
 */
export function voicingCost(
  candidate: number[],
  previousVoicing: number[] | undefined,
  targetTop: number,
): number {
  const low = candidate[0]!;
  const top = candidate[candidate.length - 1]!;

  let cost = 0;
  if (low < PAD_LOW) cost += (PAD_LOW - low) * 2;
  if (top > PAD_HIGH) cost += (top - PAD_HIGH) * 2;

  if (!previousVoicing || previousVoicing.length === 0) {
    return cost + Math.abs(top - targetTop);
  }

  const n = Math.min(candidate.length, previousVoicing.length);
  let movement = 0;
  let common = 0;
  for (let i = 0; i < n; i++) {
    const delta = Math.abs(candidate[i]! - previousVoicing[i]!);
    movement += delta;
    if (delta === 0) common++;
    if (delta > LEAP_LIMIT) cost += (delta - LEAP_LIMIT) * 2;
  }
  return cost + movement - common * COMMON_TONE_BONUS + BRIGHTNESS_WEIGHT * Math.abs(top - targetTop);
}

/**
 * Choose the smoothest voicing of `chord` given the previous voicing, keeping a
 * gentle drift toward `targetTop` so the pad still follows brightness over time.
 * Returns the voicing sorted low→high.
 */
export function voiceLeadChord(
  chord: HarmonicEvent,
  baseOctave: number,
  previousVoicing: number[] | undefined,
  targetTop: number,
): number[] {
  const triad = chordPitches(chord, baseOctave);
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const cand of voicingCandidates(triad)) {
    const cost = voicingCost(cand, previousVoicing, targetTop);
    if (cost < bestCost) {
      bestCost = cost;
      best = cand;
    }
  }
  return (best ?? triad).slice().sort((a, b) => a - b);
}
