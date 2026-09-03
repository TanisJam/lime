#!/usr/bin/env node
/**
 * LIME composition analyzer CLI.
 *
 * Generates a stretch of adaptive music (headless, deterministic) while sweeping
 * through the demo moods, then prints the musical analysis report.
 *
 *   node tools/analyze.mjs [bars] [seed]
 *
 * Requires a build first: `pnpm build`.
 */
import { LimeEngine, analyzeComposition, formatReport } from "../packages/core/dist/index.js";
import { ambientMinimal } from "../packages/styles/dist/index.js";

const bars = Number(process.argv[2] ?? 128);
const seed = process.argv[3] ?? "demo-forest-1";

const MOODS = [
  { name: "Calm", energy: 0.15, tension: 0.1, valence: 0.7, density: 0.2, complexity: 0.2, instability: 0.1, tempo: 68 },
  { name: "Explore", energy: 0.42, tension: 0.32, valence: 0.55, density: 0.42, complexity: 0.42, instability: 0.38, tempo: 78 },
  { name: "Unease", energy: 0.48, tension: 0.62, valence: 0.32, density: 0.42, complexity: 0.48, instability: 0.55, tempo: 82 },
  { name: "Danger", energy: 0.88, tension: 0.92, valence: 0.2, density: 0.72, complexity: 0.62, instability: 0.58, tempo: 98 },
  { name: "Resolve", energy: 0.4, tension: 0.15, valence: 0.78, density: 0.34, complexity: 0.3, instability: 0.2, tempo: 74 },
];

const engine = new LimeEngine({ seed, style: ambientMinimal, initialState: MOODS[0] });
const seg = Math.max(1, Math.floor(bars / MOODS.length));
const collected = [];
let moodIdx = 0;
const timeline = [];

for (let bar = 0; bar < bars; bar++) {
  if (bar > 0 && bar % seg === 0 && moodIdx < MOODS.length - 1) {
    moodIdx++;
    const { name, ...state } = MOODS[moodIdx];
    engine.transitionTo(state, { duration: { bars: 4 } });
    timeline.push(`  bar ${bar}: → ${name}`);
  }
  collected.push(engine.step());
}

const capture = engine.buildCapture(collected);
const report = analyzeComposition(capture);

console.log(`\nseed="${seed}"  style=${ambientMinimal.id}  bars=${bars}`);
console.log("mood sweep:");
console.log(`  bar 0: Calm`);
console.log(timeline.join("\n"));
console.log("");
console.log(formatReport(report));
