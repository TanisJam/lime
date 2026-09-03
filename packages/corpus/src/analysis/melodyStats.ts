import { MODE_INTERVALS, type Mode, type DurationName } from "@lime/core";
import type { CorpusNote, CorpusScore } from "../ir.js";

/**
 * Melodic statistics extracted from a corpus: the distribution of diatonic step
 * intervals in the melody (skyline) and of note durations. These feed the motif
 * generator so procedurally-created motifs match the corpus's melodic character.
 */
export interface MelodyModel {
  /** Diatonic step (…−2,−1,1,2…) → weight. Excludes 0 (repeats). */
  readonly intervalWeights: Record<number, number>;
  /** Note-value name → weight. */
  readonly durationWeights: Record<string, number>;
  /** Average melodic notes per bar (guides motif length). */
  readonly avgNotesPerBar: number;
  readonly sampleCount: number;
}

/** Note-value candidates (name → length in quarters), for duration bucketing. */
const DUR_TABLE: [DurationName, number][] = [
  ["sixteenth", 0.25],
  ["eighth", 0.5],
  ["dottedEighth", 0.75],
  ["quarter", 1],
  ["dottedQuarter", 1.5],
  ["half", 2],
  ["whole", 4],
];

/** Nearest scale-degree index for a pitch in a key (chromatic snaps to nearest). */
function scalePosition(pitch: number, tonicPc: number, mode: Mode): number {
  const intervals = MODE_INTERVALS[mode];
  const rel = pitch - tonicPc;
  const octave = Math.floor(rel / 12);
  const within = ((rel % 12) + 12) % 12;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < intervals.length; i++) {
    const d = Math.abs((intervals[i] as number) - within);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return octave * 7 + bestIdx;
}

function nearestDuration(quarters: number): DurationName {
  let best: DurationName = "quarter";
  let bestDist = Infinity;
  for (const [name, q] of DUR_TABLE) {
    const d = Math.abs(q - quarters);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

export interface MelodyLineNote {
  readonly start: number;
  readonly pitch: number;
  readonly duration: number;
}

/**
 * Extract a single melodic line from a (possibly polyphonic) score.
 *
 * Better than a global skyline: pick the most melody-like *track* — monophonic,
 * upper-mid register, reasonably active — then take its top-per-onset line. This
 * isolates the tune instead of bouncing between melody and high accompaniment.
 * Falls back to a global top line when no track qualifies.
 */
export function extractMelodyLine(score: CorpusScore): MelodyLineNote[] {
  const byTrack = new Map<number, CorpusNote[]>();
  for (const n of score.notes) {
    if (n.isPercussion) continue;
    let list = byTrack.get(n.track);
    if (!list) {
      list = [];
      byTrack.set(n.track, list);
    }
    list.push(n);
  }
  if (byTrack.size === 0) return [];

  let best: CorpusNote[] | null = null;
  let bestScore = -Infinity;
  for (const notes of byTrack.values()) {
    if (notes.length < 4) continue;
    const onsets = new Set<number>();
    let sumPitch = 0;
    for (const n of notes) {
      onsets.add(n.start);
      sumPitch += n.pitch;
    }
    const avgChordSize = notes.length / onsets.size; // 1 = monophonic
    const meanPitch = sumPitch / notes.length;
    const monophony = 1 / avgChordSize;
    const register = Math.max(0.1, Math.min(1.2, (meanPitch - 48) / 36)); // prefer upper voices
    const activity = Math.min(1, notes.length / 8);
    // Monophony dominates (it's the strongest melody signal).
    const s = monophony * monophony * register * activity;
    if (s > bestScore) {
      bestScore = s;
      best = notes;
    }
  }

  const source = best ?? score.notes.filter((n) => !n.isPercussion);

  // Top note per onset within the chosen voice.
  const top = new Map<number, MelodyLineNote>();
  for (const n of source) {
    const cur = top.get(n.start);
    if (!cur || n.pitch > cur.pitch) top.set(n.start, { start: n.start, pitch: n.pitch, duration: n.duration });
  }
  return [...top.values()].sort((a, b) => a.start - b.start);
}

/** Accumulates a {@link MelodyModel} across many scores. */
export class MelodyModelBuilder {
  private readonly intervals = new Map<number, number>();
  private readonly durations = new Map<string, number>();
  private totalNotes = 0;
  private totalBars = 0;
  private pieces = 0;

  add(score: CorpusScore, key: { tonicPc: number; mode: Mode }): void {
    const line = extractMelodyLine(score);
    if (line.length < 2) return;

    const beatTicks = (score.ppq * 4) / score.timeSignature.denominator;
    const barTicks = beatTicks * score.timeSignature.numerator;

    let prevPos: number | null = null;
    for (const note of line) {
      const pos = scalePosition(note.pitch, key.tonicPc, key.mode);
      if (prevPos !== null) {
        const step = pos - prevPos;
        // Count only melodic steps within an octave; larger jumps are usually
        // voice-crossing between the true melody and high accompaniment notes,
        // not melodic motion. Ignore repeats (step 0).
        if (step !== 0 && Math.abs(step) <= 6) {
          this.intervals.set(step, (this.intervals.get(step) ?? 0) + 1);
        }
      }
      prevPos = pos;
      const q = note.duration / score.ppq;
      const name = nearestDuration(q);
      this.durations.set(name, (this.durations.get(name) ?? 0) + 1);
    }

    this.totalNotes += line.length;
    const lastOnset = line[line.length - 1]!.start;
    this.totalBars += Math.max(1, Math.ceil((lastOnset + 1) / barTicks));
    this.pieces++;
  }

  build(): MelodyModel {
    return {
      intervalWeights: Object.fromEntries(this.intervals),
      durationWeights: Object.fromEntries(this.durations),
      avgNotesPerBar: this.totalBars > 0 ? this.totalNotes / this.totalBars : 0,
      sampleCount: this.totalNotes,
    };
  }
}
