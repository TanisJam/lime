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
 * The thresholds below are a style *default*, not a universal truth: a
 * StylePack may override any voice's gate via {@link EnsembleStyle} (e.g. a
 * jazz trio's drummer is present at every dynamic, so jazz declares its own,
 * much lower, percussion gate). A voice the style doesn't override keeps the
 * default here.
 *
 * Decisions are taken once per bar (at the bar boundary), and the pad is always
 * present as the harmonic bed.
 */

import type { EnsembleStyle, VoiceGate } from "../style/StylePack.js";

export type ArrangementVoice = "pad" | "melody" | "bass" | "percussion";

const GATES: ReadonlyArray<readonly [Exclude<ArrangementVoice, "pad">, VoiceGate]> = [
  ["melody", { on: 0.2, off: 0.14 }],
  ["bass", { on: 0.38, off: 0.3 }],
  ["percussion", { on: 0.55, off: 0.44 }],
];

export class Arrangement {
  private readonly active = new Set<ArrangementVoice>(["pad"]);
  private readonly ensemble: EnsembleStyle | undefined;

  constructor(ensemble?: EnsembleStyle) {
    this.ensemble = ensemble;
  }

  /** Update the active voice set for a bar's energy and return it. */
  update(energy: number): ReadonlySet<ArrangementVoice> {
    for (const [voice, defaultGate] of GATES) {
      const gate = this.ensemble?.[voice] ?? defaultGate;
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
