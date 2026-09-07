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
const EAR_ESSENTIA = "/data/ai/ear/venv-essentia/bin/python";
const EAR_MODELS = "/data/ai/ear/models";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;

const genre = arg("genre");
const voice = arg("voice", "melody");
const programs = (arg("programs") ?? "").split(",").filter(Boolean).map(Number);
// Composition knobs live in the StylePack, not the GM table. Sweeping those
// answers a different question than sweeping timbre: whether the genre is
// being COMPOSED wrong, once the sound has been ruled out.
const knob = arg("knob");
const values = (arg("values") ?? "").split(",").filter(Boolean);
// A second knob, swept as a full cross product with the first. Single-knob
// sweeps came back empty for funk, latin and pop, which leaves the possibility
// that a genre needs two things changed together — a groove is not funk
// without the bass line that goes with it.
const knob2 = arg("knob2");
const values2 = (arg("values2") ?? "").split(",").filter(Boolean);

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

function renderVariant(program, knobValue, knobValue2) {
  let style = stylePack(genre);
  if (knobValue !== undefined) style = KNOB_PATH[knob](style, knobValue);
  if (knobValue2 !== undefined) style = KNOB_PATH[knob2](style, knobValue2);
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

    const tag = knobValue !== undefined
      ? [knobValue, knobValue2].filter((v) => v !== undefined).join("-").replace(/[^a-z0-9-]/gi, "")
      : `p${program}`;
    const base = `${genre}_${tag}_seed${seed}`;
    const mid = join(OUT, `${base}.mid`);
    const wav = join(OUT, `${base}.wav`);
    writeFileSync(mid, eventsToStandardMidiFile(events, {
      tempo: bpm, ppq: 480, trackOrder: TRACK_ORDER, programs: programs_, name: base,
    }));
    execFileSync("fluidsynth", ["-ni", "-g", "0.8", "-r", "44100", "-F", wav, SF2, mid], { stdio: "ignore" });
    rmSync(mid, { force: true });
    clips.push({
      file: `${base}.wav`, genre, genreName: NAMES[genre], truth: NAMES[genre],
      seed, seconds, variant: tag,
    });
  }

  return clips;
}

/**
 * Judges every variant at once, with every ear, and fuses them.
 *
 * One manifest for the whole sweep instead of one per variant: each clip is
 * scored independently against the same twelve candidates either way, and
 * batching turns dozens of model loads into three. It also lets the ears be
 * calibrated across the batch, which is what makes their columns comparable.
 *
 * MuQ-MuLan alone is no longer enough. LIME's timbres and grooves were chosen
 * by sweeping against it, so it is the one ear that cannot referee its own
 * tuning; the two Essentia ears have never been in that loop. See
 * tools/judge/README.md.
 */
function judgeAll(clips) {
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
    sampleRate: 44100, task: "genre", candidates: CANDIDATES, clips,
  }, null, 2));
  const manifest = join(OUT, "manifest.json");
  const quiet = { stdio: "ignore", env: { ...process.env, HF_HOME: EAR_MODELS } };

  execFileSync(EAR, [join(HERE, "../ear/tag.py"), manifest], quiet);
  for (const backend of ["effnet", "maest"]) {
    execFileSync(EAR_ESSENTIA, [join(HERE, "../ear/tag-essentia.py"), manifest, `--backend=${backend}`], quiet);
  }
  execFileSync("python3", [join(HERE, "../ear/fuse.py"), OUT], quiet);

  const rows = JSON.parse(readFileSync(join(OUT, "report-fused.json"), "utf8"));
  const truth = NAMES[genre];
  const byVariant = new Map();
  for (const r of rows) {
    const order = Object.entries(r.scores).sort((a, b) => b[1] - a[1]);
    // The rank of the true label is the signal that survives a 0/4. Latin was
    // "broken" at zero hits while sitting second by a hair, and only the rank
    // said so.
    const rank = order.findIndex(([c]) => c === truth) + 1;
    const v = byVariant.get(r.variant) ?? { hits: 0, total: 0, ranks: [], gaps: [], heard: new Map() };
    v.total++;
    if (order[0][0] === truth) v.hits++;
    v.ranks.push(rank);
    v.gaps.push(order[0][1] - r.scores[truth]);
    v.heard.set(order[0][0], (v.heard.get(order[0][0]) ?? 0) + 1);
    byVariant.set(r.variant, v);
  }
  return byVariant;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const sweepList = knob ? values : programs;
console.log(
  knob
    ? `Sweeping ${NAMES[genre]} · knob ${knob} · ${values.length} value(s) · seeds ${seeds.join(",")}`
    : `Sweeping ${NAMES[genre]} · ${voice} · ${programs.length} program(s) · seeds ${seeds.join(",")}`,
);
if (!knob) console.log(`Baseline ${voice}: ${GM[genre][voice]} (${gmName(GM[genre][voice])})`);
console.log(`Judged against ${CANDIDATES.length} candidates — chance ${(100 / CANDIDATES.length).toFixed(0)}%\n`);

const pairs = knob2 && values2.length
  ? sweepList.flatMap((a) => values2.map((b) => [a, b]))
  : sweepList.map((a) => [a, undefined]);

if (knob2) console.log(`  crossed with ${knob2}: ${values2.join(", ")} — ${pairs.length} combinations\n`);

const allClips = [];
const labels = new Map();
for (const [item, item2] of pairs) {
  const clips = renderVariant(knob ? undefined : item, knob ? item : undefined, item2);
  allClips.push(...clips);
  labels.set(clips[0].variant, knob
    ? `${String(item)}${item2 !== undefined ? ` + ${item2}` : ""}`.padEnd(30)
    : `${String(item).padStart(3)} ${gmName(item).padEnd(24)}`);
}
console.log(`Rendered ${allClips.length} clip(s); judging with every ear...\n`);

const byVariant = judgeAll(allClips);

const results = [];
for (const [variant, label] of labels) {
  const v = byVariant.get(variant);
  if (!v) continue;
  const rank = mean(v.ranks);
  const gap = mean(v.gaps);
  results.push({ variant, label, ...v, rank, gap });
  const top = [...v.heard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k, n]) => `${k} x${n}`).join(", ");
  console.log(
    `  ${label} ${v.hits}/${v.total}  rank ${rank.toFixed(2)}  gap ${gap.toFixed(3)}   ${top}`,
  );
}

// Rank, not hits. A variant that moves the truth from fifth to second has told
// us something even at zero hits, and picking by hits alone throws that away.
const best = results.reduce((a, b) => (b.rank < a.rank ? b : a));
console.log(
  `\nBest by rank: ${best.label.trim()} — rank ${best.rank.toFixed(2)} of ${CANDIDATES.length}, ` +
  `gap ${best.gap.toFixed(3)}, ${best.hits}/${best.total} hits`,
);
const baseline = results.find((r) => r.hits > 0) ? "" :
  "\nNo variant scored a hit. Read the ranks: a rank near 2 is a near miss worth " +
  "pushing on, a rank near the middle means this knob is not what is wrong.";
if (baseline) console.log(baseline);
