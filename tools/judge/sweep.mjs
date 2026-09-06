#!/usr/bin/env node
/**
 * Sweeps one voice's General MIDI program for one genre and measures each
 * variant with the ear.
 *
 * This exists because guessing does not work. Jazz and funk shared a tenor sax
 * lead, funk came back as jazz every time, and swapping the sax looked like a
 * fix until the full candidate set showed it had only moved the confusion. The
 * knob space is small — a dozen plausible programs per voice — so it can simply
 * be walked, and a walk does not have taste or a hypothesis to defend.
 *
 * Every variant is judged against ALL twelve genre labels, declared in the
 * manifest. Judging a genre against itself alone returns a perfect score by
 * construction; the scorer now refuses that, and this never asks for it.
 *
 * Usage:
 *   node tools/judge/sweep.mjs --genre=genre-funk --voice=melody --programs=7,27,28,17
 *   node tools/judge/sweep.mjs --genre=genre-pop --voice=melody --programs=52,54,73,65 --seeds=1,2,3,4
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLime } from "../../packages/core/dist/index.js";
import { eventsToStandardMidiFile } from "../../packages/midi/dist/index.js";
import { GM, STATE, NAMES, stylePack, TRACK_ORDER, foldMelody, gmName } from "./genreTables.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const SF2 = join(REPO, "apps/demo/public/soundfonts/GeneralUser-GS.sf2");
const OUT = join(HERE, "out", "sweep");
const EAR = "/data/ai/ear/venv/bin/python";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;

const genre = arg("genre");
const voice = arg("voice", "melody");
const programs = (arg("programs") ?? "").split(",").filter(Boolean).map(Number);
const seeds = arg("seeds", "1,2,3,4").split(",").map(Number);
const seconds = Number(arg("seconds", "22"));

if (!genre || !programs.length) {
  console.error("Usage: --genre=genre-funk --voice=melody --programs=7,27,28");
  process.exit(2);
}

/** Every genre label, so each variant is scored against the real alternatives. */
const CANDIDATES = Object.values(NAMES).sort();

mkdirSync(OUT, { recursive: true });

function renderVariant(program) {
  const style = stylePack(genre);
  const state = STATE[genre];
  const cfg = { ...GM[genre], [voice]: program };
  const bpm = state.tempo;
  const bars = Math.ceil(seconds / (240 / bpm));
  const clips = [];

  for (const seed of seeds) {
    const lime = createLime({ seed, style, initialState: state });
    const events = [];
    for (let bar = 0; bar < bars; bar++) {
      for (const e of lime.composeBar(bar)) {
        events.push(e.voice === "melody" ? { ...e, pitch: foldMelody(e.pitch, cfg) } : e);
      }
    }
    const programs_ = {};
    for (const v of ["pad", "bass", "melody", "motion"]) if (cfg[v] !== undefined) programs_[v] = cfg[v];

    const base = `${genre}_p${program}_seed${seed}`;
    const mid = join(OUT, `${base}.mid`);
    const wav = join(OUT, `${base}.wav`);
    writeFileSync(mid, eventsToStandardMidiFile(events, {
      tempo: bpm, ppq: 480, trackOrder: TRACK_ORDER, programs: programs_, name: base,
    }));
    execFileSync("fluidsynth", ["-ni", "-g", "0.8", "-r", "44100", "-F", wav, SF2, mid], { stdio: "ignore" });
    rmSync(mid, { force: true });
    clips.push({ file: `${base}.wav`, genre, genreName: NAMES[genre], truth: NAMES[genre], seed, seconds });
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
    sampleRate: 44100, task: "genre", candidates: CANDIDATES, clips,
  }, null, 2));
}

function judge() {
  execFileSync(EAR, [join(HERE, "../ear/tag.py"), join(OUT, "manifest.json")], { stdio: "ignore" });
  const rows = JSON.parse(readFileSync(join(OUT, "report-ear.json"), "utf8"));
  const truth = NAMES[genre];
  let hits = 0;
  const heard = new Map();
  for (const r of rows) {
    const best = Object.entries(r.scores).sort((a, b) => b[1] - a[1])[0][0];
    if (best === truth) hits++;
    heard.set(best, (heard.get(best) ?? 0) + 1);
  }
  return { hits, total: rows.length, heard };
}

console.log(`Sweeping ${NAMES[genre]} · ${voice} · ${programs.length} program(s) · seeds ${seeds.join(",")}`);
console.log(`Baseline ${voice}: ${GM[genre][voice]} (${gmName(GM[genre][voice])})`);
console.log(`Judged against ${CANDIDATES.length} candidates — chance ${(100 / CANDIDATES.length).toFixed(0)}%\n`);

const results = [];
for (const p of programs) {
  renderVariant(p);
  const { hits, total, heard } = judge();
  results.push({ program: p, hits, total, heard });
  const top = [...heard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k, v]) => `${k} x${v}`).join(", ");
  console.log(`  ${String(p).padStart(3)} ${gmName(p).padEnd(24)} ${hits}/${total}   ${top}`);
}

const best = results.reduce((a, b) => (b.hits > a.hits ? b : a));
console.log(
  best.hits > 0
    ? `\nBest: program ${best.program} (${gmName(best.program)}) at ${best.hits}/${best.total}`
    : `\nNo program scored above zero. The lead timbre is not what is wrong here.`,
);
