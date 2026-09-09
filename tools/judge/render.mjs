import { writeFileSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLime } from "../../packages/core/dist/index.js";
import { eventsToStandardMidiFile } from "../../packages/midi/dist/index.js";
import * as styles from "../../packages/styles/dist/index.js";

/**
 * LIME offline capture — render composed music to WAV for the audio judge.
 *
 * For each (genre, seed) it drives the pure-TS composer headlessly and emits
 * out/manifest.json for judge.py. The established browser/Tone offline renderer
 * is used for Hip-hop so its sampled palette matches the demo; all other genres
 * retain the FluidSynth MIDI path below. Hip-hop's sampled path requires the
 * built demo and headless Chromium (see render-tone.mjs).
 *
 * Usage:
 *   node tools/judge/render.mjs                       # all 12 genres, seed 1, 24s
 *   node tools/judge/render.mjs --genres=genre-metal,genre-rock-pop --seeds=1,2,3
 *   node tools/judge/render.mjs --seconds=20
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
const OUT = join(HERE, "out");
const SF2 = join(REPO, "apps/demo/public/soundfonts/GeneralUser-GS.sf2");

// Per-genre GM programs + lead-register folding — MIRROR of GM_PROGRAMS in
// apps/demo/src/fluidRenderer.ts. Keep in sync so the WAV matches the browser.
import { GM, STATE, GM_NAMES, NAMES, AUTHORED, STYLE_OVERRIDE, gmName, stylePack, TRACK_ORDER, foldMelody } from "./genreTables.mjs";


function emotionLabel(s) {
  const val = s.valence >= 0.55 ? "positive" : s.valence <= 0.45 ? "negative" : "neutral";
  const ar = s.energy >= 0.6 ? "high-arousal" : s.energy <= 0.4 ? "low-arousal" : "mid-arousal";
  return `${ar}, ${val} valence`;
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const genres = arg("genres", Object.keys(GM).join(",")).split(",").filter(Boolean);
const seeds = arg("seeds", "1").split(",").map(Number);
const seconds = Number(arg("seconds", "24"));

mkdirSync(OUT, { recursive: true });

// The demo's Hip-hop renderer is a Tone.js hybrid with local recorded samples.
// Reuse the repository's established headless browser path rather than trying to
// reproduce Tone Samplers in Node (which silently renders silence without a real
// window). The other genres intentionally stay on this script's FluidSynth path.
const sampledHipHop = new Map();
if (genres.includes("genre-hiphop")) {
  execFileSync(process.execPath, [
    join(HERE, "render-tone.mjs"),
    "--palette=sampled",
    "--genres=genre-hiphop",
    `--seeds=${seeds.join(",")}`,
    `--seconds=${seconds}`,
  ], { cwd: REPO, stdio: "inherit" });
  const sampledOut = join(OUT, "tone-sampled");
  const sampledManifest = JSON.parse(readFileSync(join(sampledOut, "manifest.json"), "utf8"));
  for (const clip of sampledManifest.clips ?? []) {
    sampledHipHop.set(clip.seed, join(sampledOut, clip.file));
  }
  for (const seed of seeds) {
    if (!sampledHipHop.has(seed)) throw new Error(`sampled Hip-hop render missing seed ${seed}`);
  }
}

const clips = [];

for (const genre of genres) {
  const style = stylePack(genre);
  if (!style) { console.warn(`skip unknown genre ${genre}`); continue; }
  const state = STATE[genre];
  const cfg = GM[genre];
  const bpm = state.tempo;
  const bars = Math.ceil(seconds / (240 / bpm));

  for (const seed of seeds) {
    const lime = createLime({ seed, style, initialState: state });
    const events = [];
    for (let bar = 0; bar < bars; bar++) {
      for (const e of lime.composeBar(bar)) {
        events.push(e.voice === "melody" && genre !== "genre-hiphop" ? { ...e, pitch: foldMelody(e.pitch, cfg) } : e);
      }
    }
    const programs = {};
    for (const v of ["pad", "bass", "melody", "motion"]) if (cfg[v] !== undefined) programs[v] = cfg[v];

    const base = `${genre}_seed${seed}`;
    const midPath = join(OUT, `${base}.mid`);
    const wavPath = join(OUT, `${base}.wav`);
    const bytes = eventsToStandardMidiFile(events, { tempo: bpm, ppq: 480, trackOrder: TRACK_ORDER, programs, name: `${NAMES[genre]} seed ${seed}` });
    writeFileSync(midPath, bytes);
    if (genre === "genre-hiphop") {
      // render-tone.mjs already rendered this exact composition through the
      // demo's sampled/hybrid palette; relocate it so existing judge commands
      // keep consuming this manifest unchanged.
      copyFileSync(sampledHipHop.get(seed), wavPath);
    } else {
      execFileSync("fluidsynth", ["-ni", "-g", "0.8", "-r", "44100", "-F", wavPath, SF2, midPath], { stdio: "ignore" });
    }

    const character = {
      instruments: {
        pad: gmName(cfg.pad), bass: gmName(cfg.bass),
        melody: gmName(cfg.melody), motion: gmName(cfg.motion),
      },
      chordStyle: style.chordStyle ?? "triad",
      bassStyle: style.bassStyle ?? "default",
      groove: style.rhythm?.groove ?? "none",
      melodyScale: style.melody?.scale ?? "diatonic",
      motion: style.motion ?? "none",
      tempoRange: style.tempoRange,
      mood: { energy: state.energy, valence: state.valence, tension: state.tension, density: state.density, brightness: state.brightness },
    };
    clips.push({ file: `${base}.wav`, genre, genreName: NAMES[genre], emotion: emotionLabel(state), seed, bpm, seconds, character });
    console.log(`rendered ${base}.wav  (${bars} bars @ ${bpm}bpm, ${events.length} notes)`);
  }
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ sampleRate: 44100, generatedAt: new Date().toISOString(), clips }, null, 2));
console.log(`\n${clips.length} clip(s) → ${OUT}/manifest.json`);
