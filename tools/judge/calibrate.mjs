#!/usr/bin/env node
/**
 * Judge calibration harness.
 *
 * The judge is the measuring instrument for every genre LIME generates, so
 * before trusting a verdict we have to prove the instrument can FAIL a clip.
 * A judge that scores everything 4/5 cannot certify anything.
 *
 * Method: paired mislabelling. The SAME audio is judged twice — once under its
 * true genre/emotion, once under a deliberately distant one. The judge is only
 * told the intent, never the knob values, so the two runs differ in nothing but
 * the label.
 *
 *   true label  → expect a high GENRE MATCH
 *   wrong label → expect a low GENRE MATCH
 *
 * If both come back the same, the judge is rubber-stamping and its scores are
 * worthless as a gate. That is the result this harness exists to detect.
 *
 * Usage:
 *   node tools/judge/render.mjs --seeds=1 --seconds=22     # produce the clips
 *   node tools/judge/calibrate.mjs                          # build the paired manifest
 *   source /data/ai/judge/env.sh
 *   /data/ai/judge/venv/bin/python tools/judge/judge.py \
 *     tools/judge/out/calib/manifest.json
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const CALIB = join(OUT, "calib");

/**
 * Pairs chosen to be maximally distant, so a judge with any discrimination at
 * all should notice. Each key's audio gets relabelled as its partner.
 */
const SWAPS = [
  ["genre-ambient", "genre-metal"],
  ["genre-metal", "genre-ambient"],
  ["genre-classical", "genre-hiphop"],
  ["genre-hiphop", "genre-classical"],
];

const manifestPath = join(OUT, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  console.error(
    `Cannot read ${manifestPath}. Render the clips first:\n` +
      `  node tools/judge/render.mjs --seeds=1 --seconds=22`,
  );
  process.exit(1);
}

const byGenre = new Map(manifest.clips.map((c) => [c.genre, c]));

const missing = [...new Set(SWAPS.flat())].filter((g) => !byGenre.has(g));
if (missing.length) {
  console.error(`Missing clips for: ${missing.join(", ")}. Render all genres first.`);
  process.exit(1);
}

mkdirSync(CALIB, { recursive: true });

const clips = [];
for (const [trueGenre, wrongGenre] of SWAPS) {
  const real = byGenre.get(trueGenre);
  const lie = byGenre.get(wrongGenre);

  copyFileSync(join(OUT, real.file), join(CALIB, real.file));

  // Control: the honest label.
  clips.push({ ...real, calibration: "control", trueGenre });

  // Probe: same audio, the partner's genre and emotion. Only the intent moves;
  // `character` is never shown to the judge, so it is left alone deliberately.
  clips.push({
    ...real,
    genre: lie.genre,
    genreName: lie.genreName,
    emotion: lie.emotion,
    calibration: "mislabelled",
    trueGenre,
  });
}

const out = {
  ...manifest,
  generatedAt: new Date().toISOString(),
  calibration: true,
  clips,
};

const outPath = join(CALIB, "manifest.json");
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`${clips.length} clip(s) (${SWAPS.length} control + ${SWAPS.length} mislabelled)`);
for (const [t, w] of SWAPS) {
  console.log(`  ${t}  →  also judged as ${byGenre.get(w).genreName}`);
}
console.log(`\n→ ${resolve(outPath)}`);
