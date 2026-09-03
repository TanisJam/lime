/**
 * Arrangement — which voices are present, driven by energy.
 *
 * Orchestration builds up in bands: a very low passage is the pad alone, the
 * melody joins as it lifts, then the bass, then percussion once there's real
 * drive. Each voice has a higher turn-on threshold than its turn-off threshold
 * (hysteresis), so a voice doesn't flicker in and out when energy hovers around
 * an edge — once it commits to entering or leaving, it stays until energy moves
 * clearly the other way.
 *
 * Decisions are taken once per bar (at the bar boundary), and the pad is always
 * present as the harmonic bed.
 */

export type ArrangementVoice = "pad" | "melody" | "bass" | "percussion";

interface VoiceGate {
  /** Energy at or above which an absent voice enters. */
  readonly on: number;
  /** Energy below which a present voice drops out. `on > off` is the hysteresis. */
  readonly off: number;
}

const GATES: ReadonlyArray<readonly [Exclude<ArrangementVoice, "pad">, VoiceGate]> = [
  ["melody", { on: 0.2, off: 0.14 }],
  ["bass", { on: 0.38, off: 0.3 }],
  ["percussion", { on: 0.55, off: 0.44 }],
];

export class Arrangement {
  private readonly active = new Set<ArrangementVoice>(["pad"]);

  /** Update the active voice set for a bar's energy and return it. */
  update(energy: number): ReadonlySet<ArrangementVoice> {
    for (const [voice, gate] of GATES) {
      if (this.active.has(voice)) {
        if (energy < gate.off) this.active.delete(voice);
      } else if (energy >= gate.on) {
        this.active.add(voice);
      }
    }
    return this.active;
  }

  /** The voices currently in the arrangement (read-only view). */
  get current(): ReadonlySet<ArrangementVoice> {
    return this.active;
  }
}
