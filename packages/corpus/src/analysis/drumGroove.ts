import type { CorpusScore } from "../ir.js";

/**
 * Drum-groove analysis — read the channel-10 drum pattern the MIDI carries and
 * distil it into a per-voice 16-step groove template, plus backbeat and swing.
 *
 * This is what makes a genre *feel* like itself: rock's kick-1/3 snare-2/4
 * backbeat, jazz's swung ride, a four-on-the-floor dance kick. v0.2 had one
 * generic percussion grammar; per-genre grooves come from here. See GENRES.md §4.
 */

const GRID = 16; // sixteenth positions per 4/4 bar

/** Abstract drum voices the GM drum map collapses to. */
export type DrumVoice = "kick" | "snare" | "hat" | "tom" | "cymbal" | "perc";

/** Map a GM drum note (channel-10 pitch) to an abstract voice. */
export function drumVoiceOf(note: number): DrumVoice {
  switch (note) {
    case 35: case 36:
      return "kick";
    case 37: case 38: case 39: case 40: // rim, snares, clap
      return "snare";
    case 42: case 44: case 46: // closed / pedal / open hat
      return "hat";
    case 41: case 43: case 45: case 47: case 48: case 50: // toms
      return "tom";
    case 49: case 51: case 52: case 53: case 55: case 57: case 59: // crash/ride/china/splash
      return "cymbal";
    default:
      return "perc";
  }
}

export interface DrumGrooveModel {
  readonly grid: number;
  /** Onset likelihood per voice across the 16-step bar (normalized to max 1). */
  readonly voices: Partial<Record<DrumVoice, number[]>>;
  readonly avgHitsPerBar: number;
  /** Snare share landing on beats 2 & 4 (0..1) — backbeat strength. */
  readonly backbeat: number;
  /** Triplet-feel estimate (0 straight … 1 full swing). */
  readonly swing: number;
  /** Whether any drums were present at all. */
  readonly hasDrums: boolean;
  readonly sampleBars: number;
}

/** Accumulates a {@link DrumGrooveModel} across one or many scores. */
export class DrumGrooveBuilder {
  private readonly voices = new Map<DrumVoice, number[]>();
  private hits = 0;
  private bars = 0;
  private snareOn = 0;
  private snareBackbeat = 0;
  private swingSum = 0;
  private swingN = 0;

  add(score: CorpusScore): void {
    const beatTicks = (score.ppq * 4) / score.timeSignature.denominator;
    const barTicks = beatTicks * score.timeSignature.numerator;
    const cell = barTicks / GRID;
    if (cell <= 0) return;

    let maxTick = 0;
    for (const n of score.notes) {
      if (!n.isPercussion) continue;
      const voice = drumVoiceOf(n.pitch);
      const posInBar = ((n.start % barTicks) + barTicks) % barTicks;
      const idx = Math.round(posInBar / cell) % GRID;
      const arr = this.voices.get(voice) ?? new Array<number>(GRID).fill(0);
      arr[idx]!++;
      this.voices.set(voice, arr);
      this.hits++;
      maxTick = Math.max(maxTick, n.start);

      if (voice === "snare") {
        this.snareOn++;
        if (idx === 4 || idx === 12) this.snareBackbeat++; // beats 2 & 4
      }
      // Swing: how far the off-beat "and" is pushed toward the triplet (0.667).
      const posInBeat = ((n.start % beatTicks) + beatTicks) % beatTicks / beatTicks;
      if (posInBeat >= 0.4 && posInBeat <= 0.75) {
        this.swingSum += posInBeat;
        this.swingN++;
      }
    }
    this.bars += Math.max(1, Math.ceil((maxTick + 1) / barTicks));
  }

  build(): DrumGrooveModel {
    const voices: Partial<Record<DrumVoice, number[]>> = {};
    for (const [v, arr] of this.voices) {
      const max = Math.max(1, ...arr);
      voices[v] = arr.map((c) => c / max);
    }
    const avgSwingPos = this.swingN ? this.swingSum / this.swingN : 0.5;
    const swing = clamp01((avgSwingPos - 0.5) / (2 / 3 - 0.5));
    return {
      grid: GRID,
      voices,
      avgHitsPerBar: this.bars ? this.hits / this.bars : 0,
      backbeat: this.snareOn ? this.snareBackbeat / this.snareOn : 0,
      swing: this.swingN ? swing : 0,
      hasDrums: this.hits > 0,
      sampleBars: this.bars,
    };
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Convenience: the drum groove of a single score. */
export function drumGroove(score: CorpusScore): DrumGrooveModel {
  const b = new DrumGrooveBuilder();
  b.add(score);
  return b.build();
}
