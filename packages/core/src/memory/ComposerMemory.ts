import type { Motif } from "../motif/Motif.js";
import type { HarmonicEvent } from "../harmony/Chord.js";
import type { HarmonicFunction } from "../harmony/Scale.js";

/**
 * A musical commitment: something the composer has implied and should not
 * casually violate. v0.1 uses harmonic-resolution commitments to give the
 * music inertia — new intent influences *uncommitted* future first.
 */
export interface MusicalCommitment {
  readonly type: "harmonic-resolution";
  readonly expectedFunctions: HarmonicFunction[];
  readonly expiresAtBar: number;
}

/**
 * The composer's short-term memory: what it has played and implied.
 *
 * Purpose is to avoid "random music forever" and instead achieve
 * introduce → remember → vary → return → develop.
 */
export class ComposerMemory {
  readonly motifs: Motif[] = [];
  readonly recentMotifIds: string[] = [];
  readonly pitchHistogram = new Map<number, number>();
  readonly recentChords: HarmonicEvent[] = [];
  readonly unresolvedCommitments: MusicalCommitment[] = [];
  /** Chronological log of every motif use (base id). Used by analysis. */
  readonly usageLog: string[] = [];

  private readonly maxRecentMotifs = 8;
  private readonly maxRecentChords = 16;
  private readonly maxUsageLog = 1024;

  addMotif(motif: Motif): void {
    this.motifs.push(motif);
  }

  getMotif(id: string): Motif | undefined {
    return this.motifs.find((m) => m.id === id);
  }

  markMotifUsed(id: string): void {
    const idx = this.recentMotifIds.indexOf(id);
    if (idx >= 0) this.recentMotifIds.splice(idx, 1);
    this.recentMotifIds.push(id);
    while (this.recentMotifIds.length > this.maxRecentMotifs) {
      this.recentMotifIds.shift();
    }
    this.usageLog.push(id);
    if (this.usageLog.length > this.maxUsageLog) this.usageLog.shift();
  }

  /** How many bars ago (roughly) a motif was last used; large = stale. */
  recencyRank(id: string): number {
    const idx = this.recentMotifIds.indexOf(id);
    return idx < 0 ? Infinity : this.recentMotifIds.length - idx;
  }

  recordPitch(pitch: number): void {
    this.pitchHistogram.set(pitch, (this.pitchHistogram.get(pitch) ?? 0) + 1);
  }

  recordChord(chord: HarmonicEvent): void {
    this.recentChords.push(chord);
    while (this.recentChords.length > this.maxRecentChords) {
      this.recentChords.shift();
    }
  }

  addCommitment(c: MusicalCommitment): void {
    this.unresolvedCommitments.push(c);
  }

  /** Drop commitments that have expired by `bar`. */
  expireCommitments(bar: number): void {
    for (let i = this.unresolvedCommitments.length - 1; i >= 0; i--) {
      if (this.unresolvedCommitments[i]!.expiresAtBar <= bar) {
        this.unresolvedCommitments.splice(i, 1);
      }
    }
  }
}
