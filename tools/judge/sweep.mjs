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
// Composition knobs live in the StylePack, not the GM table. Sweeping those
// answers a different question than sweeping timbre: whether the genre is
// being COMPOSED wrong, once the sound has been ruled out.
const knob = arg("knob");
const values = (arg("values") ?? "").split(",").filter(Boolean);

/** Where each knob sits inside a StylePack. */
const KNOB_PATH = {
  groove: (style, v) => ({ ...style, rhythm: { ...style.rhythm, groove: v } }),
  bassStyle: (style, v) => ({ ...style, bassStyle: v }),
  chordStyle: (style, v) => ({ ...style, chordStyle: v }),
  melodyScale: (style, v) => ({ ...style, melody: { ...style.melody, scale: v } }),
  motion: (style, v) => ({ ...style, motion: v }),
  defaultMode: (style, v) => ({ ...style, defaultMode: v }),
};
const seeds = arg("seeds", "1,2,3,4").split(",").map(Number);
const seconds = Number(arg("seconds", "22"));

if (!genre || (!programs.length && !(knob && values.length))) {
  console.error(
    "Usage:\n" +
    "  --genre=genre-funk --voice=melody --programs=7,27,28\n" +
    "  --genre=genre-funk --knob=groove --values=funk,backbeat,boom-bap",
  );
  process.exit(2);
}
if (knob && !KNOB_PATH[knob]) {
  console.error(`Unknown knob "${knob}". Known: ${Object.keys(KNOB_PATH).join(", ")}`);
  process.exit(2);
}

/** Every genre label, so each variant is scored against the real alternatives. */
const CANDIDATES = Object.values(NAMES).sort();

mkdirSync(OUT, { recursive: true });

function renderVariant(program, knobValue) {
  const base = stylePack(genre);
  const style = knobValue !== undefined ? KNOB_PATH[knob](base, knobValue) : base;
  const state = STATE[genre];
  // Only override the program when sweeping programs. Writing `undefined` here
  // would drop the voice's GM program entirely and fall back to piano, so a
  // knob sweep would quietly be changing the timbre as well as the knob.
  const cfg = program !== undefined ? { ...GM[genre], [voice]: program } : { ...GM[genre] };
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

    const tag = knobValue !== undefined ? String(knobValue).replace(/[^a-z0-9-]/gi, "") : `p${program}`;
    const base = `${genre}_${tag}_seed${seed}`;
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

const sweepList = knob ? values : programs;
console.log(
  knob
    ? `Sweeping ${NAMES[genre]} · knob ${knob} · ${values.length} value(s) · seeds ${seeds.join(",")}`
    : `Sweeping ${NAMES[genre]} · ${voice} · ${programs.length} program(s) · seeds ${seeds.join(",")}`,
);
if (!knob) console.log(`Baseline ${voice}: ${GM[genre][voice]} (${gmName(GM[genre][voice])})`);
console.log(`Judged against ${CANDIDATES.length} candidates — chance ${(100 / CANDIDATES.length).toFixed(0)}%\n`);

const results = [];
for (const item of sweepList) {
  renderVariant(knob ? undefined : item, knob ? item : undefined);
  const { hits, total, heard } = judge();
  results.push({ item, hits, total, heard });
  const top = [...heard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k, v]) => `${k} x${v}`).join(", ");
  const label = knob ? String(item).padEnd(28) : `${String(item).padStart(3)} ${gmName(item).padEnd(24)}`;
  console.log(`  ${label} ${hits}/${total}   ${top}`);
}

const best = results.reduce((a, b) => (b.hits > a.hits ? b : a));
console.log(
  best.hits > 0
    ? `\nBest: ${knob ?? "program"} ${best.item} at ${best.hits}/${best.total}`
    : `\nNothing scored above zero. ${knob ? `${knob} is not what is wrong here.` : "The lead timbre is not what is wrong here."}`,
);
