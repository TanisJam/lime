/**
 * Symbolic melody statistics — note-level measurements of a Standard MIDI
 * File's lead line against its own accompaniment.
 *
 * This is the melodic counterpart of `groove-stats.mjs`: the audio ear stack
 * scores timbre and texture, `groove-stats.mjs` measures whether the rhythm
 * section locks together, and neither ever asked whether the melody sits on
 * the harmony underneath it, moves by step or by leap, or clashes with the
 * chord. These metrics answer that, from onset ticks, durations, pitches and
 * programs alone — no audio, no models, no embeddings.
 *
 * The same detection rule and the same metric definitions run over real
 * reference recordings and over LIME's own output, so the two are directly
 * comparable. That is the whole point: a target is only meaningful if the
 * same ruler measured it.
 *
 * Usage:
 *   node tools/judge/melody-stats.mjs <file.mid> [...]        # per-file table
 *   node tools/judge/melody-stats.mjs --manifest=<file.json>  # grouped medians
 *   node tools/judge/melody-stats.mjs --json <file.mid>       # machine-readable
 *
 * A manifest is a JSON array of `{ id, label, localPath }`; results are grouped
 * by `label` and reported as medians, which resist the outliers a single oddly
 * arranged song would otherwise contribute.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMidiFile } from "../../packages/corpus/dist/index.js";

/** Sixteenth positions per 4/4 bar — the grid strong-beat detection snaps to. */
const GRID = 16;

/**
 * General MIDI program numbers that denote a bass instrument (32–39: acoustic
 * bass through synth bass 2). A voice made entirely of bass notes is never a
 * melody candidate, on either side of the comparison.
 */
const BASS_PROGRAM_LO = 32;
const BASS_PROGRAM_HI = 39;

/** A voice needs at least this many onsets in the window to be considered. */
const MIN_VOICE_NOTES = 40;

/** A voice whose median pitch sits below this is treated as accompaniment, not melody. */
const MIN_MELODY_MEDIAN_PITCH = 48;

/** Monophony floor a candidate must clear to be preferred by mean pitch. */
const MONOPHONY_THRESHOLD = 0.8;

/**
 * Fraction of a file skipped before measuring, and how much is then kept.
 *
 * Same convention as `groove-stats.mjs`: reference recordings open with an
 * intro and close with a fade, so a central window compares like with like.
 */
const WINDOW_SKIP = 0.25;
const WINDOW_KEEP = 0.5;

/** Median of a numeric list; NaN for empty. Mutates nothing. */
function median(xs) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Share of `xs` satisfying `pred`, as 0..1; NaN when empty (nothing to measure). */
function share(xs, pred) {
  if (xs.length === 0) return NaN;
  let n = 0;
  for (const x of xs) if (pred(x)) n++;
  return n / xs.length;
}

/** Pitch class distance (0..6), symmetric under octave and direction. */
function pitchClassInterval(a, b) {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/**
 * The metric set, in report order, with the definition each name stands for.
 * Exported so callers render one consistent table and never drift on wording.
 */
export const MELODY_METRICS = [
  ["melChordTone", "melody onsets that are a chord tone (incl. implied third) over sounding accompaniment"],
  ["melStrongChordTone", "same, restricted to 16th steps 0 and 8 of the bar"],
  ["melClash", "melody onsets a semitone from a sounding accompaniment pitch"],
  ["melStep", "consecutive melody-note pairs (within a bar) moving by step (≤ 2 semitones)"],
  ["melLeap", "same pairs moving by leap (≥ 7 semitones)"],
  ["melDurBeats", "mean melody note duration, in beats"],
];

/**
 * Group a voice's onsets by `(track, program)` and score it as a melody
 * candidate: total notes, monophony, and mean pitch.
 *
 * Monophony = 1 − (share of onsets that start less than one 32nd-note after
 * the previous onset in the same voice). A 32nd is `cell / 2`, where `cell`
 * (a 16th) is `bar / 16` — half a 16th step is close enough together that two
 * onsets that close cannot both be heard as the single moving line a melody is.
 */
function scoreCandidate(key, notes, cell) {
  const starts = notes.map((n) => n.start).sort((a, b) => a - b);
  let bunched = 0;
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] - starts[i - 1] < cell / 2) bunched++;
  }
  const monophony = 1 - bunched / notes.length;
  const meanPitch = notes.reduce((a, n) => a + n.pitch, 0) / notes.length;
  return { key, notes, monophony, meanPitch };
}

/**
 * Detect the melody voice with one rule, applied identically to reference
 * recordings and to LIME's own exported MIDI.
 *
 * A voice is the pair `(track, program)` — format-0 files put every
 * instrument on one track but separate by program, and LIME's own export
 * gives every voice its own track regardless. Percussion is dropped outright;
 * a voice is also dropped if it has fewer than `MIN_VOICE_NOTES` notes in the
 * window, if every one of its notes is a bass program, or if its median pitch
 * sits below `MIN_MELODY_MEDIAN_PITCH`.
 *
 * Among the survivors, a voice at or above `MONOPHONY_THRESHOLD` monophony is
 * a melody candidate; the one with the highest mean pitch wins, on the
 * assumption that the lead sits above the accompaniment it competes with. If
 * none reach the threshold, the most monophonic survivor is picked instead —
 * a lower bar is still a bar, and picking nothing would be a worse answer for
 * every downstream metric than a soft fallback.
 *
 * Returns `null` when no voice at all survives the drop rules.
 */
export function detectMelody(notes, cell) {
  const isBass = (n) =>
    !n.isPercussion && n.program !== undefined &&
    n.program >= BASS_PROGRAM_LO && n.program <= BASS_PROGRAM_HI;

  const voices = new Map();
  for (const n of notes) {
    if (n.isPercussion) continue;
    const key = `${n.track}/${n.program}`;
    if (!voices.has(key)) voices.set(key, []);
    voices.get(key).push(n);
  }

  const candidates = [];
  for (const [key, ns] of voices) {
    if (ns.length < MIN_VOICE_NOTES) continue;
    if (ns.every(isBass)) continue;
    if (median(ns.map((n) => n.pitch)) < MIN_MELODY_MEDIAN_PITCH) continue;
    candidates.push(scoreCandidate(key, ns, cell));
  }
  if (candidates.length === 0) return null;

  const monophonic = candidates.filter((c) => c.monophony >= MONOPHONY_THRESHOLD);
  const pool = monophonic.length ? monophonic : candidates;
  const rank = monophonic.length
    ? (a, b) => b.meanPitch - a.meanPitch
    : (a, b) => b.monophony - a.monophony;
  const [winner] = [...pool].sort(rank);
  return winner;
}

/**
 * Measure one parsed score.
 *
 * Positions are taken modulo the bar and rounded to the 16-step grid, exactly
 * as `groove-stats.mjs` does, so a "strong beat" here means the same thing it
 * means there.
 *
 * Returns `null` when the file yields no measurable melody candidate.
 */
export function melodyStats(score, options = {}) {
  const beatTicks = (score.ppq * 4) / score.timeSignature.denominator;
  const barTicks = beatTicks * score.timeSignature.numerator;
  const cell = barTicks / GRID;
  if (cell <= 0 || score.notes.length === 0) return null;

  const end = score.notes.reduce((m, n) => Math.max(m, n.start), 0);
  const whole = options.whole === true;
  const from = whole ? 0 : end * WINDOW_SKIP;
  const to = whole ? Infinity : end * (WINDOW_SKIP + WINDOW_KEEP);
  const notes = score.notes.filter((n) => n.start >= from && n.start <= to && !n.isPercussion);
  if (notes.length === 0) return null;

  const winner = detectMelody(notes, cell);
  if (!winner) return null;

  const melody = winner.notes.slice().sort((a, b) => a.start - b.start);
  const accompaniment = notes.filter((n) => `${n.track}/${n.program}` !== winner.key);

  const soundingAt = (t) => accompaniment.filter((n) => n.start <= t && n.start + n.duration > t);
  const stepOf = (n) => Math.round((((n.start % barTicks) + barTicks) % barTicks) / cell) % GRID;

  // Per-onset chord-tone / clash judgement, scoped to onsets that have at
  // least one accompaniment note sounding — an unaccompanied melody onset has
  // no chord to be a tone of or clash against, so it is excluded rather than
  // scored as either.
  const scored = [];
  for (const m of melody) {
    const bed = soundingAt(m.start);
    if (bed.length === 0) continue;
    const mpc = m.pitch % 12;
    const bedPcs = bed.map((n) => n.pitch % 12);
    const lowestPitch = Math.min(...bed.map((n) => n.pitch));
    const lowPc = lowestPitch % 12;
    // A power-chord bed (root + fifth, no third) carries no pitch class the
    // melody could land on as "the third" — without this clause a melody
    // resting on the implied third of a bare fifth would be miscounted as
    // foreign, when tonally it is the single most idiomatic note available.
    // The clause applies only when the bed has no third of its own: once a
    // triad sounds, its quality is decided, and crediting the other third
    // would count a wrong-quality note — a semitone off the real third — as
    // consonant.
    const bedHasThird = bedPcs.includes((lowPc + 3) % 12) || bedPcs.includes((lowPc + 4) % 12);
    const isImpliedThird = !bedHasThird && (mpc === (lowPc + 3) % 12 || mpc === (lowPc + 4) % 12);
    const isChordTone = bedPcs.includes(mpc) || isImpliedThird;
    const isClash = bedPcs.some((pc) => pitchClassInterval(mpc, pc) === 1);
    const isStrongBeat = stepOf(m) === 0 || stepOf(m) === 8;
    scored.push({ isChordTone, isClash, isStrongBeat });
  }

  const strong = scored.filter((s) => s.isStrongBeat);

  // Consecutive-pair motion, restricted to pairs within a bar of each other —
  // a gap wider than that is a phrase break, not a melodic step or leap.
  let stepCount = 0, leapCount = 0, pairs = 0;
  for (let i = 1; i < melody.length; i++) {
    if (melody[i].start - melody[i - 1].start > barTicks) continue;
    pairs++;
    const interval = Math.abs(melody[i].pitch - melody[i - 1].pitch);
    if (interval <= 2) stepCount++;
    else if (interval >= 7) leapCount++;
  }

  return {
    melChordTone: share(scored, (s) => s.isChordTone),
    melStrongChordTone: share(strong, (s) => s.isChordTone),
    melClash: share(scored, (s) => s.isClash),
    melStep: pairs ? stepCount / pairs : NaN,
    melLeap: pairs ? leapCount / pairs : NaN,
    melDurBeats: melody.reduce((a, n) => a + n.duration / beatTicks, 0) / melody.length,
    // Context, not criteria — reported so a surprising row can be explained.
    _voice: winner.key,
    _monophony: winner.monophony,
    _melodyNotes: melody.length,
  };
}

/** Parse and measure a MIDI file by path. Returns null if it yields no melody. */
export function statsForFile(path, options = {}) {
  const data = readFileSync(path);
  const score = parseMidiFile(new Uint8Array(data), {
    id: path,
    meta: { source: "melody-stats", genre: options.label ?? "unknown" },
  });
  return melodyStats(score, options);
}

/**
 * Median of each metric across a set of per-file stat objects, finite values
 * only. Mirrors `groove-stats.mjs`'s `aggregate()`: every melody metric here
 * draws only on rows where a melody was actually detected (the caller has
 * already filtered those), so there is no voice-scoping to apply — but a
 * single file can still produce a non-finite value for one metric (e.g.
 * `melStep`/`melLeap` when the melody has no consecutive pairs within a bar),
 * and that row is excluded from that metric's median rather than counted as
 * a measured zero.
 */
export function aggregate(rows) {
  const out = {};
  const metricN = {};
  for (const [name] of MELODY_METRICS) {
    const values = rows.map((r) => r[name]).filter((v) => Number.isFinite(v));
    out[name] = values.length ? median(values) : NaN;
    metricN[name] = values.length;
  }
  out._n = rows.length;
  out._metricN = metricN;
  return out;
}

// --- CLI ---------------------------------------------------------------------

function fmt(v) {
  if (!Number.isFinite(v)) return "  n/a";
  return Math.abs(v) >= 10 ? v.toFixed(1).padStart(6) : v.toFixed(2).padStart(6);
}

function printTable(rowsByGroup) {
  const groups = [...rowsByGroup.keys()];
  const width = Math.max(20, ...MELODY_METRICS.map(([n]) => n.length + 1));
  console.log("".padEnd(width) + groups.map((g) => g.slice(0, 11).padStart(12)).join(""));
  for (const [name, definition] of MELODY_METRICS) {
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
    const skipped = [];
    for (const item of items) {
      let stats = null;
      try {
        stats = statsForFile(resolve(root, item.localPath), { label: item.label, whole });
      } catch (err) {
        skipped.push(`${item.id}: ${err.message}`);
        continue;
      }
      if (!stats) {
        skipped.push(`${item.id}: no detectable melody`);
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
      if (skipped.length) {
        console.error(`\n${skipped.length} file(s) skipped (no detectable melody):`);
        for (const s of skipped) console.error("  " + s);
      }
    }
    return;
  }

  if (files.length === 0) {
    console.error("usage: node tools/judge/melody-stats.mjs <file.mid> [...] | --manifest=<file.json>");
    process.exit(2);
  }

  const rows = new Map();
  const skipped = [];
  for (const f of files) {
    const stats = statsForFile(resolve(f), { whole });
    if (stats) rows.set(f.split("/").at(-1).replace(/\.mid$/, ""), stats);
    else skipped.push(f);
  }
  if (asJson) console.log(JSON.stringify(Object.fromEntries(rows), null, 2));
  else {
    printTable(rows);
    if (skipped.length) {
      console.error(`\n${skipped.length} file(s) skipped (no detectable melody):`);
      for (const s of skipped) console.error("  " + s);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
