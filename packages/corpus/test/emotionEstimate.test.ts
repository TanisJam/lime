import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CorpusNote, CorpusScore } from "../src/ir.js";
import { estimateEmotion, quadrantOf, emotionFeatures } from "../src/analysis/emotionEstimate.js";
import { parseScoreFile } from "../src/score/parseScore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EMOPIA_DIR = resolve(HERE, "../data/emopia/EMOPIA_1.0/midis");

type Quad = "Q1" | "Q2" | "Q3" | "Q4";

/** Build a minimal synthetic score for unit assertions. */
function makeScore(notes: Partial<CorpusNote>[], tempoBpm: number, ppq = 480): CorpusScore {
  return {
    id: "synthetic",
    ppq,
    tempoBpm,
    timeSignature: { numerator: 4, denominator: 4 },
    notes: notes.map((n) => ({
      start: n.start ?? 0,
      duration: n.duration ?? ppq,
      pitch: n.pitch ?? 60,
      velocity: n.velocity ?? 0.7,
      track: n.track ?? 0,
      isPercussion: n.isPercussion ?? false,
    })),
    meta: { source: "test", license: "test" },
  };
}

/** A C-major scale run, `bars` long, `perBar` notes per bar. */
function majorRun(bars: number, perBar: number, tempoBpm: number, velocity = 0.7): CorpusScore {
  const ppq = 480;
  const barTicks = ppq * 4;
  const scale = [60, 62, 64, 65, 67, 69, 71, 72]; // C major
  const notes: Partial<CorpusNote>[] = [];
  let step = 0;
  for (let b = 0; b < bars; b++) {
    for (let i = 0; i < perBar; i++) {
      notes.push({
        start: b * barTicks + Math.round((i * barTicks) / perBar),
        duration: Math.round(barTicks / perBar),
        // Advance through the scale every note (even at 1 note/bar), so the key
        // profile sees the whole scale rather than a single repeated pitch.
        pitch: scale[step++ % scale.length]!,
        velocity,
      });
    }
  }
  return makeScore(notes, tempoBpm);
}

/** A C natural-minor scale run. */
function minorRun(bars: number, perBar: number, tempoBpm: number, velocity = 0.7): CorpusScore {
  const s = majorRun(bars, perBar, tempoBpm, velocity);
  const minor = [60, 62, 63, 65, 67, 68, 70, 72]; // C natural minor
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  return { ...s, notes: s.notes.map((n) => ({ ...n, pitch: minor[scale.indexOf(n.pitch)] ?? n.pitch })) };
}

describe("estimateEmotion — sanity on synthetic scores", () => {
  it("fast + major reads as high arousal, positive valence (Q1)", () => {
    const e = estimateEmotion(majorRun(8, 8, 160, 0.85));
    expect(e.arousal).toBeGreaterThan(0);
    expect(e.valence).toBeGreaterThan(0);
    expect(e.quadrant).toBe<Quad>("Q1");
  });

  it("slow + minor reads as low arousal, negative valence (Q3)", () => {
    const e = estimateEmotion(minorRun(8, 1, 60, 0.4));
    expect(e.arousal).toBeLessThan(0);
    expect(e.valence).toBeLessThan(0);
    expect(e.quadrant).toBe<Quad>("Q3");
  });

  it("fast + minor reads as tense (Q2); slow + major reads as calm (Q4)", () => {
    expect(estimateEmotion(minorRun(8, 8, 165, 0.85)).quadrant).toBe<Quad>("Q2");
    expect(estimateEmotion(majorRun(8, 1, 62, 0.4)).quadrant).toBe<Quad>("Q4");
  });

  it("quadrantOf follows the Russell convention", () => {
    expect(quadrantOf(0.5, 0.5)).toBe("Q1");
    expect(quadrantOf(-0.5, 0.5)).toBe("Q2");
    expect(quadrantOf(-0.5, -0.5)).toBe("Q3");
    expect(quadrantOf(0.5, -0.5)).toBe("Q4");
  });

  it("an empty score is neutral, never throws", () => {
    const e = estimateEmotion(makeScore([], 120));
    expect(e.valence).toBe(0);
    expect(e.arousal).toBe(0);
  });
});

// --- Calibration against EMOPIA's human quadrant labels ----------------------
const hasEmopia = existsSync(EMOPIA_DIR);
const describeCal = hasEmopia ? describe : describe.skip;

describeCal("estimateEmotion — calibration against EMOPIA ground truth", () => {
  it("agrees with human quadrant labels well above chance", { timeout: 120_000 }, () => {
    const files = readdirSync(EMOPIA_DIR).filter((f) => /^Q[1-4]_/.test(f) && f.endsWith(".mid"));
    // Confusion matrix: truth (row) × predicted (col).
    const quads: Quad[] = ["Q1", "Q2", "Q3", "Q4"];
    const cm: Record<Quad, Record<Quad, number>> = {
      Q1: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      Q2: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      Q3: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      Q4: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
    };
    let n = 0;
    let quadHits = 0;
    let valHits = 0;
    let aroHits = 0;
    for (const file of files) {
      const truth = file.slice(0, 2) as Quad;
      let score: CorpusScore;
      try {
        score = parseScoreFile(join(EMOPIA_DIR, file), { source: "emopia", license: "cc" });
      } catch {
        continue;
      }
      if (emotionFeatures(score).noteCount < 8) continue;
      const pred = estimateEmotion(score);
      const predQ = pred.quadrant!;
      cm[truth][predQ]++;
      n++;
      if (predQ === truth) quadHits++;
      // Per-axis agreement (2-class): does the sign match the truth quadrant?
      const truthValPos = truth === "Q1" || truth === "Q4";
      const truthAroPos = truth === "Q1" || truth === "Q2";
      if (pred.valence >= 0 === truthValPos) valHits++;
      if (pred.arousal >= 0 === truthAroPos) aroHits++;
    }

    const pct = (x: number) => ((100 * x) / n).toFixed(1) + "%";
    const header = "truth\\pred   " + quads.map((q) => q.padStart(5)).join(" ");
    const rows = quads.map(
      (t) => `  ${t}       ` + quads.map((p) => String(cm[t][p]).padStart(5)).join(" "),
    );
    // eslint-disable-next-line no-console
    console.log(
      `\nEMOPIA calibration — ${n} files\n${header}\n${rows.join("\n")}\n` +
        `quadrant accuracy: ${pct(quadHits)}   valence-axis: ${pct(valHits)}   arousal-axis: ${pct(aroHits)}`,
    );

    // Real signal, not perfection: each axis must beat a coin flip clearly, and
    // 4-quadrant accuracy must beat the 25% chance baseline.
    expect(n).toBeGreaterThan(200);
    expect(valHits / n).toBeGreaterThan(0.55);
    expect(aroHits / n).toBeGreaterThan(0.55);
    expect(quadHits / n).toBeGreaterThan(0.3);
  });
});
