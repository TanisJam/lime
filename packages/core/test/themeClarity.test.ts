import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";
import type { NoteEvent } from "../src/events/MusicalEvent.js";

// testStyle has 4-bar phrases and the grammar statement/variation/development/
// cadence, so statement phrases (the theme) start at bars 0, 16, 32, 48.
const STATEMENT_HEADS = [0, 16, 32, 48];

function melodyPerBar(): NoteEvent[][] {
  const engine = new LimeEngine({
    seed: "theme-clarity",
    style: testStyle,
    initialState: { energy: 0.6, tension: 0.3, density: 0.5, complexity: 0.4, tempo: 84 },
  });
  const perBar: NoteEvent[][] = [];
  for (let b = 0; b < 64; b++) {
    perBar[b] = engine.composeBar(b).filter((e) => e.voice === "melody");
  }
  return perBar;
}

describe("theme clarity", () => {
  it("always states the theme at the head of a statement phrase", () => {
    const perBar = melodyPerBar();
    for (const head of STATEMENT_HEADS) {
      expect(perBar[head]!.length, `statement head bar ${head} should sound`).toBeGreaterThan(0);
    }
  });

  it("is deterministic", () => {
    const a = melodyPerBar().map((b) => b.map((e) => e.pitch));
    const b = melodyPerBar().map((x) => x.map((e) => e.pitch));
    expect(a).toEqual(b);
  });
});
