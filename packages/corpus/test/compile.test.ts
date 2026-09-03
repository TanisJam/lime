import { describe, it, expect } from "vitest";
import { LimeEngine, analyzeComposition } from "@lime/core";
import { HarmonyModelBuilder } from "../src/analysis/harmonyStats.js";
import { compileStylePack } from "../src/style/compileStylePack.js";
import { emotionToState, quadrantToEmotion } from "../src/style/emotionMapping.js";

/** Build a harmony model from explicit degree sequences (a synthetic corpus). */
function modelFrom(sequences: number[][]) {
  const b = new HarmonyModelBuilder();
  for (const seq of sequences) b.add(seq);
  return b.build();
}

describe("emotion mapping", () => {
  it("maps calm (Q4) to low energy, high valence", () => {
    const s = emotionToState(quadrantToEmotion("Q4"));
    expect(s.energy!).toBeLessThan(0.4);
    expect(s.valence!).toBeGreaterThan(0.6);
  });

  it("maps the tense corner (Q2) to high tension", () => {
    const s = emotionToState(quadrantToEmotion("Q2"));
    expect(s.tension!).toBeGreaterThan(0.6);
    expect(s.energy!).toBeGreaterThan(0.6);
  });

  it("places tempo within the given range by arousal", () => {
    const low = emotionToState({ valence: 0, arousal: -1 }, [60, 100]);
    const high = emotionToState({ valence: 0, arousal: 1 }, [60, 100]);
    expect(low.tempo!).toBeCloseTo(60, 0);
    expect(high.tempo!).toBeCloseTo(100, 0);
  });
});

describe("compile StylePack from corpus stats", () => {
  const model = modelFrom([
    [1, 4, 5, 1],
    [1, 6, 4, 5, 1],
    [1, 4, 1, 5, 1],
    [2, 5, 1],
    [1, 5, 6, 4, 1],
  ]);

  it("carries the corpus transitions into the style", () => {
    const { style } = compileStylePack(model, { id: "corpus-major", keyPc: 0, mode: "major" });
    expect(style.harmony?.transitions?.[1]!.length).toBeGreaterThan(0);
    // 1→4 and 1→5 both appeared in the corpus.
    const fromTonic = style.harmony!.transitions![1]!.map((t) => t.degree);
    expect(fromTonic).toContain(4);
    expect(fromTonic).toContain(5);
  });

  it("produces musical, in-scale output when used to generate", () => {
    const { style } = compileStylePack(model, { id: "corpus-major", keyPc: 0, mode: "major" });
    const engine = new LimeEngine({ seed: "corpus-gen", style, initialState: { energy: 0.4, tension: 0.3 } });
    const report = analyzeComposition(engine.captureComposition(64));
    expect(report.melody.metrics.inScale!.value).toBeGreaterThan(0.999);
    expect(report.harmony.score).toBeGreaterThan(0.7);
    expect(report.overall).toBeGreaterThan(0.7);
  });

  it("lets a constrained corpus actually control the harmony", () => {
    // A corpus that only ever alternates I↔V should dominate generated degrees.
    const narrow = modelFrom([[1, 5, 1, 5, 1, 5, 1]]);
    const { style } = compileStylePack(narrow, { id: "i-v-only", keyPc: 0, mode: "major" });
    const engine = new LimeEngine({ seed: "narrow-gen", style, initialState: { energy: 0.3, tension: 0.2 } });
    const capture = engine.captureComposition(64);
    // Count distinct chords and how many are degree 1 or 5.
    const chords = [];
    let last = -1;
    for (const b of capture.bars) {
      if (b.chord.bar !== last) {
        chords.push(b.chord.degree);
        last = b.chord.bar;
      }
    }
    const iOrV = chords.filter((d) => d === 1 || d === 5).length;
    expect(iOrV / chords.length).toBeGreaterThan(0.85);
  });
});
