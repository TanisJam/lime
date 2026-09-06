#!/usr/bin/env node
/**
 * Symbolic genre features, measured off the composed notes.
 *
 * The ear misidentifies four genres the same way every single time: funk and
 * latin both come back as jazz, metal as rock, pop as electronic. A consistent
 * wrong answer is not noise — it says LIME is composing each of those as the
 * generic version of its parent category, without whatever distinguishes it.
 *
 * This measures the notes rather than listening to them, so it needs no model
 * and no audio, and it answers a question the ear cannot: is the difference
 * missing from the COMPOSITION, or only from the sound? If funk and jazz score
 * the same here, the timbre was never the problem.
 *
 * Usage:
 *   node tools/judge/features.mjs [--seeds=1,2,3,4] [--seconds=22]
 */

import { createLime } from "../../packages/core/dist/index.js";
import { STATE, stylePack, NAMES } from "./genreTables.mjs";

const arg = (name, dflt) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? dflt;

const seeds = arg("seeds", "1,2,3,4").split(",").map(Number);
const seconds = Number(arg("seconds", "22"));

const PPQ = 480;
const BEAT = PPQ;
const BAR = PPQ * 4;

/** Pairs the ear confuses, so each broken genre is read against what it sounds like. */
const CONFUSIONS = [
  ["genre-funk", "genre-jazz"],
  ["genre-latin", "genre-jazz"],
  ["genre-metal", "genre-rock-pop"],
  ["genre-pop", "genre-electronic"],
];

function compose(genre, seed) {
  const style = stylePack(genre);
  const state = STATE[genre];
  const bars = Math.ceil(seconds / (240 / state.tempo));
  const lime = createLime({ seed, style, initialState: state });
  const events = [];
  for (let bar = 0; bar < bars; bar++) events.push(...lime.composeBar(bar));
  return { events, bars, bpm: state.tempo };
}

/** Fraction of onsets that do not land on a beat — the plainest syncopation read. */
const offBeatRatio = (evs) =>
  evs.length ? evs.filter((e) => e.time % BEAT !== 0).length / evs.length : 0;

/** Fraction of onsets on a 16th subdivision that is not an 8th. */
const sixteenthRatio = (evs) =>
  evs.length ? evs.filter((e) => e.time % (BEAT / 2) !== 0).length / evs.length : 0;

/** Mean gap between consecutive onsets, in beats — walking vs driving vs sparse. */
function meanGapBeats(evs) {
  const t = [...new Set(evs.map((e) => e.time))].sort((a, b) => a - b);
  if (t.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1];
  return sum / (t.length - 1) / BEAT;
}

/** Mean simultaneous notes per onset — chord thickness. */
function chordSize(evs) {
  const byTime = new Map();
  for (const e of evs) byTime.set(e.time, (byTime.get(e.time) ?? 0) + 1);
  const sizes = [...byTime.values()];
  return sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
}

function featuresFor(genre, seed) {
  const { events, bars, bpm } = compose(genre, seed);
  const by = (v) => events.filter((e) => e.voice === v);
  const bass = by("bass");
  const perc = by("percussion");
  const melody = by("melody");
  const pad = by("pad");

  return {
    bpm,
    notesPerBar: events.length / bars,
    bassPerBar: bass.length / bars,
    bassOffBeat: offBeatRatio(bass),
    bass16ths: sixteenthRatio(bass),
    bassGap: meanGapBeats(bass),
    percPerBar: perc.length / bars,
    percOffBeat: offBeatRatio(perc),
    melodyOffBeat: offBeatRatio(melody),
    melodyRange: melody.length ? Math.max(...melody.map((e) => e.pitch)) - Math.min(...melody.map((e) => e.pitch)) : 0,
    padChordSize: chordSize(pad),
    motionPerBar: by("motion").length / bars,
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function averaged(genre) {
  const runs = seeds.map((s) => featuresFor(genre, s));
  const out = {};
  for (const k of Object.keys(runs[0])) out[k] = mean(runs.map((r) => r[k]));
  return out;
}

const KEYS = [
  ["bpm", 0], ["notesPerBar", 1], ["bassPerBar", 1], ["bassOffBeat", 2],
  ["bass16ths", 2], ["bassGap", 2], ["percPerBar", 1], ["percOffBeat", 2],
  ["melodyOffBeat", 2], ["melodyRange", 0], ["padChordSize", 2], ["motionPerBar", 1],
];

console.log(`Seeds ${seeds.join(",")} · ${seconds}s\n`);

for (const [broken, heardAs] of CONFUSIONS) {
  const a = averaged(broken);
  const b = averaged(heardAs);
  console.log(`${NAMES[broken]} — heard as ${NAMES[heardAs]}`);
  console.log(`  ${"feature".padEnd(16)}${NAMES[broken].padStart(10)}${NAMES[heardAs].padStart(12)}   diff`);
  for (const [k, dp] of KEYS) {
    const x = a[k], y = b[k];
    // Flag only what actually separates them; identical numbers are the finding.
    const rel = Math.abs(y) > 1e-9 ? Math.abs(x - y) / Math.abs(y) : (Math.abs(x) > 1e-9 ? 1 : 0);
    const mark = rel < 0.15 ? "  same" : rel > 0.5 ? "  <<<<" : "";
    console.log(`  ${k.padEnd(16)}${x.toFixed(dp).padStart(10)}${y.toFixed(dp).padStart(12)}${mark}`);
  }
  console.log();
}
