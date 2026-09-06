#!/usr/bin/env node
/**
 * Scores a BLIND judge run: does the model actually hear genre?
 *
 * Reads report-blind.json (produced by `judge.py --blind`), parses each clip's
 * "1. BEST GENRE" line, and compares it against the clip's true genre. In blind
 * mode the model is never told what a clip is meant to be, so a correct answer
 * is evidence of real discrimination rather than an echo of the prompt.
 *
 * The number that matters is accuracy vs. chance (1/N for N candidate genres).
 * Near chance means the judge cannot gate anything and the harness needs a
 * different verifier.
 *
 * Usage:
 *   node tools/judge/matrix.mjs [tools/judge/out/report-blind.json]
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const path = resolve(process.argv[2] ?? join(HERE, "out", "report-blind.json"));

let results;
try {
  results = JSON.parse(readFileSync(path, "utf8"));
} catch {
  console.error(
    `Cannot read ${path}. Run the blind judge first:\n` +
      `  /data/ai/judge/venv/bin/python tools/judge/judge.py tools/judge/out/manifest.json --blind`,
  );
  process.exit(1);
}

// A reference run carries its own ground truth ("truth") and its own label set;
// a LIME run is labelled by genre. Both reduce to the same comparison.
const truthOf = (r) => r.truth ?? r.genreName ?? r.genre;
const candidates = [...new Set(results.map(truthOf))].sort();

/**
 * Pull the model's committed answer off the "1. BEST GENRE: X" line. The model
 * does not always keep the exact numbering, so fall back to the first line that
 * mentions a candidate name.
 */
function parseBest(verdict) {
  const lines = verdict.split("\n").map((l) => l.trim()).filter(Boolean);

  const labelled = lines.find((l) => /best\s*(genre|match)/i.test(l));
  const scan = labelled ? [labelled] : lines;

  for (const line of scan) {
    // Longest names first so "Rock/Pop" wins over a bare "Pop" substring.
    const hit = [...candidates]
      .sort((a, b) => b.length - a.length)
      .find((g) => line.toLowerCase().includes(g.toLowerCase()));
    if (hit) return hit;

    // The model routinely ignores "copy the entry verbatim" and answers with the
    // head word alone ("happy" for "happy (high arousal, positive valence)").
    // Refusing to parse that would score the tool's strictness, not the model.
    const head = [...candidates]
      .map((c) => [c, c.split(/[\s(]/)[0]])
      .sort((a, b) => b[1].length - a[1].length)
      .find(([, w]) => new RegExp(`\\b${w}\\b`, "i").test(line));
    if (head) return head[0];
  }
  return null;
}

const rows = results.map((r) => {
  const truth = truthOf(r);
  const heard = parseBest(r.verdict ?? "");
  return { truth, heard, correct: heard === truth };
});

const parsed = rows.filter((r) => r.heard !== null);
const correct = rows.filter((r) => r.correct).length;
const chance = 1 / candidates.length;
const accuracy = correct / rows.length;

const pad = (s, n) => String(s).padEnd(n);
const width = Math.max(...rows.map((r) => r.truth.length), 8) + 2;

console.log("BLIND GENRE IDENTIFICATION\n");
console.log(`${pad("intended", width)}${pad("heard", width)}ok`);
console.log("-".repeat(width * 2 + 3));
for (const r of rows) {
  console.log(`${pad(r.truth, width)}${pad(r.heard ?? "(unparsed)", width)}${r.correct ? "OK" : ""}`);
}

console.log(`\nparsed     : ${parsed.length}/${rows.length}`);
console.log(`correct    : ${correct}/${rows.length}`);
console.log(`accuracy   : ${(accuracy * 100).toFixed(0)}%`);
console.log(`chance     : ${(chance * 100).toFixed(0)}%  (${candidates.length} candidates)`);

/**
 * Raw accuracy is misleading at this sample size: with 12 clips and 12
 * candidates, scoring 2 correct still happens a quarter of the time by pure
 * guessing. So report the exact binomial tail, P(X >= correct), and let that
 * decide the verdict instead of an eyeballed accuracy threshold.
 */
function binomialTail(k, n, p) {
  const logFact = (m) => {
    let s = 0;
    for (let i = 2; i <= m; i++) s += Math.log(i);
    return s;
  };
  let below = 0;
  for (let i = 0; i < k; i++) {
    const logP =
      logFact(n) - logFact(i) - logFact(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p);
    below += Math.exp(logP);
  }
  return 1 - below;
}

const pValue = binomialTail(correct, rows.length, chance);
console.log(`p-value    : ${pValue.toFixed(3)}  P(this many correct by pure guessing)`);

const verdict =
  pValue > 0.05
    ? "INDISTINGUISHABLE FROM GUESSING — do not use these scores as a gate."
    : accuracy < 0.5
      ? "ABOVE CHANCE but weak — not trustworthy on its own."
      : "DISCRIMINATES — usable as a signal.";
console.log(`verdict    : ${verdict}`);
