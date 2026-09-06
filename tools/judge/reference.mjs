#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * EMOPIA reference set — positive control for the audio-LLM judge.
 *
 * The judge scored LIME's own clips at chance level. Before blaming LIME's
 * output, we need proof the judge can hear ANYTHING through this exact audio
 * chain. EMOPIA is solo-piano MIDI with human-annotated emotion-quadrant
 * labels baked into the filename prefix (Q1..Q4). We render a sample through
 * the SAME fluidsynth/ffmpeg chain as tools/judge/render.mjs and emit a
 * manifest judge.py can consume directly, with `truth` set to the exact
 * candidate string for equality-based scoring.
 *
 * Quadrants (Russell's circumplex):
 *   Q1 = high arousal, positive valence → happy
 *   Q2 = high arousal, negative valence → tense
 *   Q3 = low  arousal, negative valence → sad
 *   Q4 = low  arousal, positive valence → calm
 *
 * If the judge also fails on this human-composed, correctly-labelled corpus,
 * the model is deaf through the pipeline and cannot gate anything. If it
 * succeeds here, LIME's output is the problem instead.
 *
 * Usage:
 *   node tools/judge/reference.mjs                          # 12/quadrant, 22s
 *   node tools/judge/reference.mjs --per-quadrant=20 --seconds=15
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
const OUT = join(HERE, "out/reference");
const SF2 = join(REPO, "apps/demo/public/soundfonts/GeneralUser-GS.sf2");
const EMOPIA_DIR =
  process.env.EMOPIA_DIR ??
  "/media/tanisjam/5f0fc2f4-f1ba-4a2c-b98b-ca0eed561390/tanisjam/projects/personal/lime/packages/corpus/data/emopia";

const QUADRANTS = {
  Q1: "happy (high arousal, positive valence)",
  Q2: "tense (high arousal, negative valence)",
  Q3: "sad (low arousal, negative valence)",
  Q4: "calm (low arousal, positive valence)",
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const perQuadrant = Number(arg("per-quadrant", "12"));
const seconds = Number(arg("seconds", "22"));

if (!existsSync(EMOPIA_DIR)) {
  console.error(`EMOPIA_DIR not found: ${EMOPIA_DIR}`);
  console.error("Set EMOPIA_DIR to the corpus location, or check the media mount.");
  process.exit(1);
}

// Recursively list .mid/.midi files under a directory.
function listMidiFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMidiFiles(full));
    else if (/\.(mid|midi)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

// Deterministic selection: sort candidates, then take an even stride across
// the sorted list. No PRNG, no Math.random — same inputs always pick the same
// files, so the run is reproducible.
function pickEvenStride(paths, n) {
  const sorted = [...paths].sort();
  if (sorted.length <= n) return sorted;
  const stride = sorted.length / n;
  const picks = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(Math.floor(i * stride + stride / 2), sorted.length - 1);
    picks.push(sorted[idx]);
  }
  return picks;
}

const allMidi = listMidiFiles(EMOPIA_DIR);
console.log(`Found ${allMidi.length} MIDI file(s) under ${EMOPIA_DIR}`);

const byQuadrant = { Q1: [], Q2: [], Q3: [], Q4: [] };
for (const path of allMidi) {
  const base = path.split("/").pop();
  const q = Object.keys(QUADRANTS).find((k) => base.startsWith(`${k}_`));
  if (q) byQuadrant[q].push(path);
}

mkdirSync(OUT, { recursive: true });

const clips = [];
const rendered = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };

for (const quadrant of Object.keys(QUADRANTS)) {
  const candidates = byQuadrant[quadrant];
  const selected = pickEvenStride(candidates, perQuadrant);

  for (const midPath of selected) {
    const base = midPath.split("/").pop().replace(/\.(mid|midi)$/i, "");
    const wavPath = join(OUT, `${base}.wav`);
    const rawWavPath = join(OUT, `${base}.raw.wav`);

    try {
      execFileSync("fluidsynth", ["-ni", "-g", "0.8", "-r", "44100", "-F", rawWavPath, SF2, midPath], {
        stdio: "ignore",
      });
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rawWavPath, "-t", String(seconds), wavPath], {
        stdio: "ignore",
      });
    } catch (err) {
      console.warn(`skip ${base}: render failed (${err.message.split("\n")[0]})`);
      continue;
    } finally {
      // Best-effort cleanup of the untrimmed intermediate.
      try {
        execFileSync("rm", ["-f", rawWavPath]);
      } catch {
        // ignore
      }
    }

    clips.push({
      file: `${base}.wav`,
      truth: QUADRANTS[quadrant],
      quadrant,
      source: "emopia",
      seconds,
    });
    rendered[quadrant] += 1;
    console.log(`rendered ${base}.wav  (${quadrant})`);
  }
}

if (clips.length === 0) {
  console.error("Nothing rendered. Check fluidsynth/ffmpeg and the EMOPIA_DIR contents.");
  process.exit(1);
}

const manifestPath = join(OUT, "manifest.json");
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      sampleRate: 44100,
      generatedAt: new Date().toISOString(),
      reference: true,
      task: "emotion",
      candidates: Object.values(QUADRANTS),
      clips,
    },
    null,
    2,
  ),
);

console.log("\nRendered per quadrant:");
for (const q of Object.keys(QUADRANTS)) console.log(`  ${q}: ${rendered[q]}`);
console.log(`\n${clips.length} clip(s) → ${manifestPath}`);
