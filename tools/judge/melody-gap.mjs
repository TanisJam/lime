/**
 * Melody gap — render LIME, measure its melody, and print the distance to
 * real reference melodies.
 *
 * The melodic counterpart of `groove-gap.mjs`: same iteration loop, same
 * "same ruler on both sides" discipline, applied to the lead line instead of
 * the rhythm section. It renders MIDI from the built core with the genre's
 * own GM programs, measures it with the same `melody-stats.mjs` that measured
 * the reference recordings, and diffs the two.
 *
 * Because melody detection is a heuristic rather than an oracle, this also
 * reports — per genre, per seed — whether detection actually found LIME's
 * true melody voice. That ground truth is known here (the `melody` voice and
 * its GM program), so a wrong pick is reported as a warning rather than
 * silently substituted into the numbers: doing that would hide exactly the
 * detection failures a melody-generator redesign needs to see.
 *
 * Usage:
 *   node tools/judge/melody-gap.mjs                 # off-target rows only
 *   node tools/judge/melody-gap.mjs --all           # every metric
 *   node tools/judge/melody-gap.mjs --bars=192      # longer render
 *   node tools/judge/melody-gap.mjs --seeds=1,2,3,4
 */

import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createLime } from "../../packages/core/dist/index.js";
import { eventsToStandardMidiFile } from "../../packages/midi/dist/index.js";
import { STATE, stylePack, GM, NAMES, TRACK_ORDER } from "./genreTables.mjs";
import { statsForFile, aggregate, MELODY_METRICS } from "./melody-stats.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * How far a metric may sit from the reference before it counts as off-target.
 *
 * Deliberately loose and explicitly provisional: unlike `groove-gap.mjs`'s
 * `TOLERANCE`, no reference-spread analysis (e.g. per-label standard
 * deviation across the 8 references) backs these numbers yet. They exist so
 * this tool is usable from day one, not because the gaps are well-calibrated.
 */
const TOLERANCE = {
  melChordTone: 0.12,
  melStrongChordTone: 0.12,
  melClash: 0.08,
  melStep: 0.12,
  melLeap: 0.08,
  melDurBeats: 0.4,
};

/** Genre ids whose output is comparable to a reference label, by that label. */
const COMPARABLE = {
  "genre-funk": "Funk/R&B",
  "genre-jazz": "Jazz",
  "genre-blues": "Blues",
  "genre-rock-pop": "Rock",
  "genre-pop": "Pop",
  "genre-electronic": "Electronic",
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/**
 * Render one genre to MIDI across seeds, measure each render's melody, and
 * report whether detection landed on LIME's true melody voice.
 *
 * The true melody voice is known here: it is the `melody` voice, carrying
 * `gm.melody` as its GM program, on whichever track index `eventsToStandardMidiFile`
 * assigns it — track 0 is always the conductor, and voice tracks follow in
 * `TRACK_ORDER` filtered to the voices that actually produced an event this
 * render (a genre that never emits `pad` shifts every later voice's track
 * index down by one, which is why this is recomputed per render rather than
 * hard-coded).
 */
function renderAndMeasure(genreId, seeds, bars, outDir) {
  const state = STATE[genreId];
  const style = stylePack(genreId);
  const gm = GM[genreId];
  if (!style || !state || !gm) return null;

  const programs = {};
  for (const voice of ["pad", "bass", "melody", "motion"]) {
    if (gm[voice] !== undefined) programs[voice] = gm[voice];
  }

  const rows = [];
  const detection = [];
  for (const seed of seeds) {
    const lime = createLime({ seed, style, initialState: state });
    const events = [];
    for (let bar = 0; bar < bars; bar++) events.push(...lime.composeBar(bar));

    const presentVoices = new Set(events.map((e) => e.voice));
    const trackOfVoice = TRACK_ORDER.filter((v) => presentVoices.has(v));
    const melodyTrackIndex = trackOfVoice.indexOf("melody");
    const trueMelodyVoice = melodyTrackIndex === -1 || gm.melody === undefined
      ? null
      : `${melodyTrackIndex + 1}/${gm.melody}`;

    const path = join(outDir, `${genreId}_${seed}.mid`);
    writeFileSync(
      path,
      eventsToStandardMidiFile(events, {
        tempo: state.tempo,
        ppq: 480,
        programs,
        name: genreId,
      }),
    );
    const stats = statsForFile(path, { label: COMPARABLE[genreId] });
    if (stats) rows.push(stats);
    // A seed whose true melody voice cannot be determined is unverified, not
    // correct: counting it as a pass would let a genre report "OK" on
    // detection it never actually checked.
    detection.push({
      seed,
      picked: stats ? stats._voice : null,
      truth: trueMelodyVoice,
      correct: stats !== null && trueMelodyVoice !== null && stats._voice === trueMelodyVoice,
    });
  }
  // A genre with no measurable render stays in the report with n/a cells and
  // an explicit warning, rather than silently dropping out of the table.
  return { stats: rows.length ? aggregate(rows) : null, detection };
}

function main() {
  const showAll = process.argv.includes("--all");
  const bars = Number(arg("bars", 96));
  const seeds = arg("seeds", "1,2,3,4").split(",").map(Number);

  const reference = JSON.parse(
    readFileSync(join(HERE, "melody-reference.json"), "utf8"),
  ).labels;

  const outDir = mkdtempSync(join(tmpdir(), "lime-melody-gap-"));
  const measured = new Map();
  try {
    for (const genreId of Object.keys(COMPARABLE)) {
      const result = renderAndMeasure(genreId, seeds, bars, outDir);
      measured.set(genreId, result ?? { stats: null, detection: [], reason: "no StylePack, state or GM programs for this genre" });
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  const genres = [...measured.keys()];
  const header = genres.map((g) => (NAMES[g] ?? g).slice(0, 10).padStart(15)).join("");
  console.log(`\nLIME melody vs real reference — ${bars} bars, seeds ${seeds.join(",")}`);
  console.log("(value / reference; * marks off-target)\n");
  console.log("".padEnd(20) + header);

  let offTarget = 0;
  for (const [name] of MELODY_METRICS) {
    const cells = [];
    let anyOff = false;
    for (const g of genres) {
      const mine = measured.get(g).stats?.[name];
      const ref = reference[COMPARABLE[g]]?.[name];
      if (ref === undefined || !Number.isFinite(mine)) {
        cells.push("n/a".padStart(15));
        continue;
      }
      const off = Math.abs(mine - ref) > (TOLERANCE[name] ?? Infinity);
      if (off) anyOff = true;
      cells.push(`${mine.toFixed(2)}/${ref.toFixed(2)}${off ? "*" : " "}`.padStart(15));
    }
    if (anyOff) offTarget++;
    if (showAll || anyOff) console.log(name.padEnd(20) + cells.join(""));
  }

  console.log("\ndetection: did the detector pick LIME's true melody voice on every seed?");
  const warnings = [];
  for (const g of genres) {
    const { stats, detection, reason } = measured.get(g);
    const label = NAMES[g] ?? g;
    if (reason) {
      console.log(`  ${label.padEnd(12)} WARNING — not measured: ${reason}`);
      warnings.push(label);
      continue;
    }
    if (!stats) {
      console.log(`  ${label.padEnd(12)} WARNING — no melody detected on any of ${detection.length} seed(s); every cell above is n/a`);
      warnings.push(label);
      continue;
    }
    const unverified = detection.filter((d) => d.truth === null);
    const wrong = detection.filter((d) => d.truth !== null && !d.correct);
    if (!unverified.length && !wrong.length) {
      console.log(`  ${label.padEnd(12)} OK — true melody voice picked on all ${detection.length} seed(s)`);
      continue;
    }
    const parts = [];
    if (wrong.length) {
      parts.push(
        `picked the wrong voice on ${wrong.length}/${detection.length} seed(s): ` +
          wrong.map((d) => `seed ${d.seed} picked ${d.picked ?? "(no melody)"}, true voice ${d.truth}`).join("; "),
      );
    }
    if (unverified.length) {
      parts.push(
        `could not verify ${unverified.length}/${detection.length} seed(s) — the render has no melody track to compare against: ` +
          unverified.map((d) => `seed ${d.seed} picked ${d.picked ?? "(no melody)"}`).join("; "),
      );
    }
    console.log(`  ${label.padEnd(12)} WARNING — ${parts.join(" | ")}`);
    warnings.push(label);
  }
  if (warnings.length) {
    console.log(
      `\n${warnings.length} genre(s) had a detection mismatch (${warnings.join(", ")}). ` +
        "Numbers above still come from whatever voice detection actually picked - " +
        "ground truth is never substituted in, so a metric can look off-target for " +
        "a detection reason rather than a generator one. Check the warning before " +
        "tuning the generator.",
    );
  }

  if (!showAll) {
    console.log(
      `\n${offTarget} metric(s) off target. Pass --all to see every row, ` +
        `including the ones already passing.`,
    );
  }
  console.log(
    "\nTOLERANCE values above are provisional (see the header comment in this " +
      "file) - no reference-spread analysis backs them yet.",
  );
}

main();
