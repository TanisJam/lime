/**
 * Symbolic groove statistics — note-level measurements of a Standard MIDI File.
 *
 * This is the instrument behind the "funk method": when the audio judge cannot
 * hear a defect, measure the defect directly on the notes. The audio ear stack
 * scores timbre and texture; it never measured whether the bass locks to the
 * kick, whether anything lands off the beat, or whether the performance is
 * quantized to the grid. Those are the statistics below.
 *
 * Every metric here is computable from onset ticks, durations, pitches,
 * velocities and channel numbers alone — no audio, no models, no embeddings.
 * The same definitions run over real reference recordings and over LIME's own
 * output, so the two are directly comparable. That is the whole point: a target
 * is only meaningful if the same ruler measured it.
 *
 * Usage:
 *   node tools/judge/groove-stats.mjs <file.mid> [...]        # per-file table
 *   node tools/judge/groove-stats.mjs --manifest=<file.json>  # grouped medians
 *   node tools/judge/groove-stats.mjs --json <file.mid>       # machine-readable
 *
 * A manifest is a JSON array of `{ id, label, localPath }`; results are grouped
 * by `label` and reported as medians, which resist the outliers a single oddly
 * arranged song would otherwise contribute.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMidiFile } from "../../packages/corpus/dist/index.js";

/** Sixteenth positions per 4/4 bar — the grid every position metric snaps to. */
const GRID = 16;

/**
 * General MIDI program numbers that denote a bass instrument (32–39: acoustic
 * bass through synth bass 2). Real multi-track MIDI identifies its bass this
 * way, and LIME's own export writes program 32 for its bass voice, so one rule
 * covers both sides of the comparison.
 */
const BASS_PROGRAM_LO = 32;
const BASS_PROGRAM_HI = 39;

/** GM drum-map pitches, by the abstract voice they realize. */
const KICK = new Set([35, 36]);
const SNARE = new Set([37, 38, 39, 40]);

/**
 * Fraction of a file skipped before measuring, and how much is then kept.
 *
 * Reference recordings open with an intro and close with a fade; neither is
 * representative of the groove the song is known for. Measuring a central
 * window compares like with like — and it is exactly the bias that made LIME's
 * own clips look wrong, since those always started at bar 0 of a two-minute
 * form arch and so only ever sampled an intro.
 */
const WINDOW_SKIP = 0.25;
const WINDOW_KEEP = 0.5;

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Sample standard deviation. Returns 0 for fewer than two values. */
function stdev(xs) {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Median of a numeric list; 0 when empty. Mutates nothing. */
function median(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Percentile (0..1) of a numeric list, nearest-rank; 0 when empty. */
function percentile(xs, p) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
  return s[idx];
}

/** Share of `xs` satisfying `pred`, as 0..1; 0 when empty. */
function share(xs, pred) {
  if (xs.length === 0) return 0;
  let n = 0;
  for (const x of xs) if (pred(x)) n++;
  return n / xs.length;
}

/**
 * The metric set, in report order, with the definition each name stands for.
 * Exported so callers render one consistent table and never drift on wording.
 */
export const METRICS = [
  ["notesPerBeat", "note onsets per beat, all voices"],
  ["drumHitsPerBar", "channel-10 onsets per bar"],
  ["drumOffbeat", "drum onsets not on a quarter-note position"],
  ["drum16th", "drum onsets on an odd 16th step"],
  ["ghost", "snare onsets below half the loud-snare velocity"],
  ["backbeat", "snare onsets on step 4 or 12 (beats 2 and 4)"],
  ["swing", "0 straight … 1 full triplet, from offbeat onset placement"],
  ["bassOnsetsPerBar", "bass onsets per bar"],
  ["bassOffbeat", "bass onsets not on a quarter-note position"],
  ["bass16th", "bass onsets on an odd 16th step"],
  ["bassKickLock", "bass onsets landing on a kick onset"],
  ["timingDevMs", "SD of onset deviation from the grid, milliseconds"],
  ["velStd", "SD of note velocity (0..1 scale)"],
];

/**
 * Measure one parsed score.
 *
 * Positions are taken modulo the bar and rounded to the 16-step grid; the
 * residual (how far the note actually sat from that grid cell) is what
 * `timingDevMs` reports, which is how a fully quantized generator gives itself
 * away — its residual is exactly zero.
 */
export function grooveStats(score, options = {}) {
  const beatTicks = (score.ppq * 4) / score.timeSignature.denominator;
  const barTicks = beatTicks * score.timeSignature.numerator;
  const cell = barTicks / GRID;
  if (cell <= 0 || score.notes.length === 0) return null;

  const msPerTick = 60_000 / (score.tempoBpm * score.ppq);

  // Restrict to a central window unless the caller asks for the whole file.
  const end = score.notes.reduce((m, n) => Math.max(m, n.start), 0);
  const whole = options.whole === true;
  const from = whole ? 0 : end * WINDOW_SKIP;
  const to = whole ? Infinity : end * (WINDOW_SKIP + WINDOW_KEEP);
  const notes = score.notes.filter((n) => n.start >= from && n.start <= to);
  if (notes.length === 0) return null;

  const spanTicks = Math.max(barTicks, (notes.at(-1).start - notes[0].start) || barTicks);
  const bars = spanTicks / barTicks;
  const beats = spanTicks / beatTicks;

  const isBass = (n) =>
    !n.isPercussion && n.program !== undefined &&
    n.program >= BASS_PROGRAM_LO && n.program <= BASS_PROGRAM_HI;

  const stepOf = (n) => Math.round((((n.start % barTicks) + barTicks) % barTicks) / cell) % GRID;
  const offGrid = (n) => {
    const pos = ((n.start % barTicks) + barTicks) % barTicks;
    const nearest = Math.round(pos / cell) * cell;
    return pos - nearest;
  };

  const drums = notes.filter((n) => n.isPercussion);
  const bass = notes.filter(isBass);
  const snare = drums.filter((n) => SNARE.has(n.pitch));
  const kickSteps = new Set(drums.filter((n) => KICK.has(n.pitch)).map(stepOf));

  // Distinct rhythmic events: simultaneous onsets are one gesture, not many.
  const onsets = new Set(notes.map((n) => n.start));

  // Ghost notes sit far under the accented hits of the same drum. Comparing to
  // the file's own loud snare (p90) keeps this independent of overall level.
  const loudSnare = percentile(snare.map((n) => n.velocity), 0.9);
  const ghost = loudSnare > 0
    ? share(snare, (n) => n.velocity < 0.5 * loudSnare)
    : 0;

  // Swing: where the offbeat actually lands between the beat and the next one.
  // 0.5 is a straight eighth, 0.667 a triplet; anything between is partial.
  const offbeatPositions = [];
  for (const n of drums) {
    const p = (((n.start % beatTicks) + beatTicks) % beatTicks) / beatTicks;
    if (p >= 0.4 && p <= 0.75) offbeatPositions.push(p);
  }
  const swing = offbeatPositions.length
    ? clamp01((median(offbeatPositions) - 0.5) / (2 / 3 - 0.5))
    : 0;

  return {
    notesPerBeat: onsets.size / beats,
    drumHitsPerBar: drums.length / bars,
    drumOffbeat: share(drums, (n) => stepOf(n) % 4 !== 0),
    drum16th: share(drums, (n) => stepOf(n) % 2 === 1),
    ghost,
    backbeat: share(snare, (n) => stepOf(n) === 4 || stepOf(n) === 12),
    swing,
    bassOnsetsPerBar: bass.length / bars,
    bassOffbeat: share(bass, (n) => stepOf(n) % 4 !== 0),
    bass16th: share(bass, (n) => stepOf(n) % 2 === 1),
    bassKickLock: kickSteps.size ? share(bass, (n) => kickSteps.has(stepOf(n))) : 0,
    timingDevMs: stdev(notes.map((n) => offGrid(n) * msPerTick)),
    velStd: stdev(notes.map((n) => n.velocity)),
    // Context, not criteria — reported so a surprising row can be explained.
    _bars: bars,
    _notes: notes.length,
    _hasDrums: drums.length > 0,
    _hasBass: bass.length > 0,
    _tempo: score.tempoBpm,
  };
}

/** Parse and measure a MIDI file by path. Returns null if it yields no notes. */
export function statsForFile(path, options = {}) {
  const data = readFileSync(path);
  const score = parseMidiFile(new Uint8Array(data), {
    id: path,
    meta: { source: "groove-stats", genre: options.label ?? "unknown" },
  });
  return grooveStats(score, options);
}

/** Median of each metric across a set of per-file stat objects. */
export function aggregate(rows) {
  const out = {};
  for (const [name] of METRICS) {
    out[name] = median(rows.map((r) => r[name]).filter((v) => Number.isFinite(v)));
  }
  out._n = rows.length;
  return out;
}

// --- CLI ---------------------------------------------------------------------

function fmt(v) {
  if (!Number.isFinite(v)) return "  n/a";
  return Math.abs(v) >= 10 ? v.toFixed(1).padStart(6) : v.toFixed(2).padStart(6);
}

function printTable(rowsByGroup) {
  const groups = [...rowsByGroup.keys()];
  const width = Math.max(18, ...METRICS.map(([n]) => n.length + 1));
  console.log("".padEnd(width) + groups.map((g) => g.slice(0, 11).padStart(12)).join(""));
  for (const [name, definition] of METRICS) {
    const line = name.padEnd(width) +
      groups.map((g) => fmt(rowsByGroup.get(g)[name]).padStart(12)).join("");
    console.log(line + "   " + definition);
  }
  console.log("".padEnd(width) + groups.map((g) => `n=${rowsByGroup.get(g)._n}`.padStart(12)).join(""));
}

function main(argv) {
  const args = argv.slice(2);
  const manifestArg = args.find((a) => a.startsWith("--manifest="));
  const asJson = args.includes("--json");
  const whole = args.includes("--whole");
  const files = args.filter((a) => !a.startsWith("--"));

  if (manifestArg) {
    const manifestPath = resolve(manifestArg.slice("--manifest=".length));
    const root = resolve(manifestPath, "..");
    const items = JSON.parse(readFileSync(manifestPath, "utf8"));
    const byLabel = new Map();
    const failures = [];
    for (const item of items) {
      let stats = null;
      try {
        stats = statsForFile(resolve(root, item.localPath), { label: item.label, whole });
      } catch (err) {
        failures.push(`${item.id}: ${err.message}`);
        continue;
      }
      if (!stats) {
        failures.push(`${item.id}: no measurable notes`);
        continue;
      }
      if (!byLabel.has(item.label)) byLabel.set(item.label, []);
      byLabel.get(item.label).push(stats);
    }
    const agg = new Map();
    for (const [label, rows] of byLabel) agg.set(label, aggregate(rows));
    if (asJson) {
      console.log(JSON.stringify(Object.fromEntries(agg), null, 2));
    } else {
      printTable(agg);
      if (failures.length) {
        console.error(`\n${failures.length} file(s) skipped:`);
        for (const f of failures) console.error("  " + f);
      }
    }
    return;
  }

  if (files.length === 0) {
    console.error("usage: node tools/judge/groove-stats.mjs <file.mid> [...] | --manifest=<file.json>");
    process.exit(2);
  }

  const rows = new Map();
  for (const f of files) {
    const stats = statsForFile(resolve(f), { whole });
    if (stats) rows.set(f.split("/").at(-1).replace(/\.mid$/, ""), stats);
  }
  if (asJson) console.log(JSON.stringify(Object.fromEntries(rows), null, 2));
  else printTable(rows);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
