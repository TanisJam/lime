import { describe, it, expect } from "vitest";
import { createLime, type MusicalState } from "@lime/core";
import { applyGenreTuning, popPack } from "../src/index.js";

/**
 * Pop's bass was retuned against corrected reference targets (GROOVE-CRITERIA.md,
 * fourth measurement trap). `@lime/core`'s own bass tests can only exercise a
 * hand-copied mirror of `popPack.bassGroove`, because core cannot depend on this
 * package — so a change to the shipped pack alone would slip past them. This
 * suite renders the pack itself, end to end, the way the demo and the judge do.
 */

// Pop's demo state (apps/demo/src/main.ts), so the bass reaches the energy at
// which its root-drive grammar actually plays.
const POP_STATE: MusicalState = {
  energy: 0.7, valence: 0.72, tension: 0.3, density: 0.55, complexity: 0.35,
  instability: 0.25, brightness: 0.6, tempo: 118,
};
const BAR_TICKS = 1920;
const SIXTEENTH = BAR_TICKS / 16;

/** Share of bass onsets that do not land on a quarter-note step. */
function bassOffbeatShare(seeds: readonly number[], bars: number): number {
  const style = applyGenreTuning(popPack);
  let onQuarter = 0;
  let offQuarter = 0;
  for (const seed of seeds) {
    const lime = createLime({ seed, style, initialState: POP_STATE });
    for (let bar = 0; bar < bars; bar++) {
      for (const e of lime.composeBar(bar)) {
        if (e.voice !== "bass") continue;
        const inBar = (((e.time - bar * BAR_TICKS) % BAR_TICKS) + BAR_TICKS) % BAR_TICKS;
        const step = Math.round(inBar / SIXTEENTH) % 16;
        if (step % 4 === 0) onQuarter++;
        else offQuarter++;
      }
    }
  }
  return offQuarter / (onQuarter + offQuarter);
}

describe("popPack's shipped bass groove", () => {
  it("puts its off-beat share in a band around the corrected target (0.29)", () => {
    // Measured on this path: the shipped tuning reads 0.28–0.33 per seed, the
    // original tuning (syncopation 0.07, kickLock 0.165) — fitted to a
    // contaminated 0.16 target — reads 0.10–0.18. The band separates them
    // without pinning the corpus median to the decimal.
    const share = bassOffbeatShare([1, 2], 64);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.45);
  });
});
