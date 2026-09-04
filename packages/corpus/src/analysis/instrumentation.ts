import type { CorpusScore } from "../ir.js";

/**
 * Instrumentation analysis — read the General MIDI `program` per note to learn
 * *which instruments* an arrangement uses. This is the genre signal the MIDI
 * carries beyond the notes: classical is strings/winds/brass with no kit, rock
 * is distorted guitar + bass + drums, jazz is piano/upright/sax.
 *
 * The audio is not in the MIDI — GM program 30 is the *label* "distortion
 * guitar", not its sound — but the label tells the renderer what timbre to use
 * and the composer which roles are active. See GENRES.md §1.
 */

/** The 16 General MIDI instrument families (8 programs each). */
export type GmFamily =
  | "piano" | "chromatic-perc" | "organ" | "guitar" | "bass" | "strings"
  | "ensemble" | "brass" | "reed" | "pipe" | "synth-lead" | "synth-pad"
  | "synth-fx" | "ethnic" | "percussive" | "sfx";

const FAMILIES: readonly GmFamily[] = [
  "piano", "chromatic-perc", "organ", "guitar", "bass", "strings",
  "ensemble", "brass", "reed", "pipe", "synth-lead", "synth-pad",
  "synth-fx", "ethnic", "percussive", "sfx",
];

/** GM family for a program number (0–127). */
export function gmFamily(program: number): GmFamily {
  const p = program < 0 ? 0 : program > 127 ? 127 : program;
  return FAMILIES[Math.floor(p / 8)]!;
}

/**
 * Finer, genre-relevant instrument labels — the distinctions that change how a
 * genre sounds (a distorted vs a clean guitar; an upright vs a synth bass). Maps
 * to the renderer's timbre palette.
 */
export type GmInstrument =
  | "acoustic-piano" | "electric-piano" | "organ"
  | "acoustic-guitar" | "clean-guitar" | "distorted-guitar"
  | "acoustic-bass" | "electric-bass" | "slap-bass" | "synth-bass"
  | "strings" | "ensemble" | "brass" | "reed" | "pipe"
  | "synth-lead" | "synth-pad" | "ethnic" | "other";

/** A genre-relevant instrument label for a GM program. */
export function gmInstrument(program: number): GmInstrument {
  const p = program < 0 ? 0 : program > 127 ? 127 : program;
  if (p <= 3) return "acoustic-piano"; // 0–3 pianos
  if (p <= 7) return "electric-piano"; // 4–5 EP, 6 harpsichord, 7 clav
  if (p <= 15) return "other"; // chromatic percussion (mallets)
  if (p <= 23) return "organ";
  if (p <= 31) {
    if (p <= 25) return "acoustic-guitar";
    if (p <= 28) return "clean-guitar";
    return "distorted-guitar"; // 29 muted, 30 overdriven, 31 distortion
  }
  if (p <= 39) {
    if (p === 32) return "acoustic-bass";
    if (p === 36 || p === 37) return "slap-bass";
    if (p >= 38) return "synth-bass";
    return "electric-bass"; // 33 fingered, 34 picked, 35 fretless
  }
  if (p <= 47) return "strings";
  if (p <= 55) return "ensemble";
  if (p <= 63) return "brass";
  if (p <= 71) return "reed";
  if (p <= 79) return "pipe";
  if (p <= 87) return "synth-lead";
  if (p <= 95) return "synth-pad";
  if (p <= 103) return "synth-lead";
  if (p <= 111) return "ethnic";
  return "other";
}

export interface InstrumentationProfile {
  /** Fraction of pitched notes per GM family (sums to ~1 over families). */
  readonly familyShare: Partial<Record<GmFamily, number>>;
  /** Fraction of pitched notes per genre-relevant instrument label. */
  readonly instrumentShare: Partial<Record<GmInstrument, number>>;
  /** Drum (channel-10) notes as a fraction of all notes. */
  readonly drumShare: number;
  readonly hasDrums: boolean;
  readonly pitchedNotes: number;
  /** Families by descending share. */
  readonly dominant: GmFamily[];
}

/** Accumulates an instrumentation profile across one or many scores. */
export class InstrumentationBuilder {
  private readonly fam = new Map<GmFamily, number>();
  private readonly inst = new Map<GmInstrument, number>();
  private pitched = 0;
  private drums = 0;

  add(score: CorpusScore): void {
    for (const n of score.notes) {
      if (n.isPercussion) {
        this.drums++;
        continue;
      }
      const prog = n.program ?? 0;
      const f = gmFamily(prog);
      const i = gmInstrument(prog);
      this.fam.set(f, (this.fam.get(f) ?? 0) + 1);
      this.inst.set(i, (this.inst.get(i) ?? 0) + 1);
      this.pitched++;
    }
  }

  build(): InstrumentationProfile {
    const total = this.pitched;
    const familyShare: Partial<Record<GmFamily, number>> = {};
    for (const [f, c] of this.fam) familyShare[f] = total ? c / total : 0;
    const instrumentShare: Partial<Record<GmInstrument, number>> = {};
    for (const [i, c] of this.inst) instrumentShare[i] = total ? c / total : 0;
    const all = total + this.drums;
    const dominant = [...this.fam.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
    return {
      familyShare,
      instrumentShare,
      drumShare: all ? this.drums / all : 0,
      hasDrums: this.drums > 0,
      pitchedNotes: total,
      dominant,
    };
  }
}

/** Convenience: the instrumentation profile of a single score. */
export function instrumentationProfile(score: CorpusScore): InstrumentationProfile {
  const b = new InstrumentationBuilder();
  b.add(score);
  return b.build();
}
