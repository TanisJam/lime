/**
 * Groove gap — render LIME, measure it, and print the distance to real music.
 *
 * This is the iteration loop from GROOVE-CRITERIA.md as one command. Change a
 * generator or a StylePack, run this, and read whether the music actually moved
 * — not whether a unit test still passes. A passing test says the code does
 * what it was told; only the artifact says whether the music got better.
 *
 * It renders MIDI from the built core, measures it with the same
 * `groove-stats.mjs` that measured the reference recordings, and diffs the two.
 * Same ruler on both sides is the whole point: a target measured any other way
 * would not be comparable.
 *
 * Two more things it reports that a single number cannot:
 *
 *  - **Distinct rhythms.** How many different bar-length rhythmic patterns a
 *    genre actually produces, with velocity stripped. This matters because
 *    counting bars *including* velocity shows 92–96 out of 96 for every genre
 *    even when the rhythm underneath never changes once — the phrase plan
 *    varies the velocities, and that variation masks a groove that is one
 *    pattern on repeat. Strip velocity or the number lies to you.
 *
 *  - **Off-target metrics only.** By default it prints just the rows that miss,
 *    so the largest gap is the thing you see first.
 *
 * Usage:
 *   node tools/judge/groove-gap.mjs                 # off-target rows only
 *   node tools/judge/groove-gap.mjs --all           # every metric
 *   node tools/judge/groove-gap.mjs --bars=192      # longer render
 *   node tools/judge/groove-gap.mjs --seeds=1,2,3,4
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { createLime } from "../../packages/core/dist/index.js";
import { eventsToStandardMidiFile } from "../../packages/midi/dist/index.js";
import { STATE, stylePack, NAMES } from "./genreTables.mjs";
import { statsForFile, aggregate, METRICS } from "./groove-stats.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * How far a metric may sit from the reference before it counts as off-target.
 *
 * These are per-metric because the metrics are not on comparable scales — a
 * 0.1 miss on a 0..1 share is a real miss, while 0.1 notes per beat is noise.
 * Deliberately loose: the goal is to sound like the genre, not to match eight
 * particular recordings, and chasing the last decimal would be tuning to the
 * corpus rather than to the music.
 */
const TOLERANCE = {
  notesPerBeat: 1.5,
  drumHitsPerBar: 5,
  drumOffbeat: 0.12,
  drum16th: 0.12,
  ghost: Infinity, // corpus unreliable — see GROOVE-CRITERIA.md
  backbeat: 0.12,
  swing: Infinity, // corpus unreliable — same reason
  bassOnsetsPerBar: 2,
  bassOffbeat: 0.15,
  bass16th: 0.1,
  bassKickLock: 0.15,
  timingDevMs: Infinity, // judged against literature, not the corpus
  velStd: 0.05,
};

/**
 * Metrics the reference cannot judge for particular labels, and why.
 *
 * The 16th-share metrics collapse against a swung genre. A swung eighth sits at
 * 2/3 of a beat, which snaps to 16th step 3 — an *odd* step — while a straight
 * eighth lands on step 2. The Lakh reference recordings for Jazz and Blues are
 * quantised transcriptions with the swing flattened out (their measured `swing`
 * is 0.03 and 0.00), so every one of their eighths reads as even and their
 * `drum16th` collapses to near zero. LIME's jazz and blues genuinely swing, so
 * theirs reads high.
 *
 * Comparing the two would therefore "reward" deleting LIME's swing to match a
 * reference that lost its own — and jazz swing is the single best-measured
 * criterion we have (Friberg & Sundström 2002). Same corpus limitation as
 * `ghost` and `swing`, third instance found; excluded for the same reason.
 */
/**
 * Floors for the variety watch, in distinct rhythms per 100 *sounding* bars.
 *
 * Deliberately not part of `TOLERANCE`: no reference recording can judge it,
 * because the reference corpus is quantised transcriptions whose own repetition
 * is an artefact of transcription, not of performance. It exists because of a
 * specific defect every metric above missed — the shipped funk bass produced
 * **one** rhythm for 700 consecutive bars while `bassOffbeat`, `bass16th` and
 * `bassKickLock` all stayed on target. Position and share were healthy; variety
 * was zero.
 *
 * Read a low value as a question, never as a failure: a deliberate one-bar vamp
 * and a stuck generator look identical here. Check whether the style intends to
 * repeat before "fixing" anything.
 */
const VARIETY_WATCH = { bass: 3, percussion: 3 };

const UNRELIABLE_FOR = {
  drum16th: new Set(["Jazz", "Blues"]),
  bass16th: new Set(["Jazz", "Blues"]),
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
 * Render one genre to MIDI and measure it, plus count how many genuinely
 * distinct rhythms it produced. Onsets are snapped to a 32nd-note grid before
 * comparison so the humanization layer's few milliseconds of jitter are not
 * mistaken for rhythmic variety.
 */
function renderAndMeasure(genreId, seeds, bars, outDir) {
  const state = STATE[genreId];
  const style = stylePack(genreId);
  if (!style || !state) return null;

  const rows = [];
  const rhythms = { percussion: new Set(), bass: new Set() };
  const barsSounding = { percussion: 0, bass: 0 };
  const barTicks = 1920;
  const snap = (t) => Math.round(t / 60) * 60;

  for (const seed of seeds) {
    const lime = createLime({ seed, style, initialState: state });
    const events = [];
    for (let bar = 0; bar < bars; bar++) {
      const barEvents = lime.composeBar(bar);
      events.push(...barEvents);
      for (const voice of ["percussion", "bass"]) {
        const v = barEvents.filter((e) => e.voice === voice);
        if (!v.length) continue;

        barsSounding[voice]++;
        rhythms[voice].add(
          v
            .map((e) => `${snap(e.time - bar * barTicks)}:${e.percussion ?? ""}`)
            .sort()
            .join("|"),
        );
      }
    }
    const path = join(outDir, `${genreId}_${seed}.mid`);
    writeFileSync(
      path,
      eventsToStandardMidiFile(events, {
        tempo: state.tempo,
        ppq: 480,
        programs: { bass: 32, melody: 66, pad: 4, motion: 0 },
        name: genreId,
      }),
    );
    const stats = statsForFile(path);
    if (stats) rows.push(stats);
  }
  if (!rows.length) return null;
  return {
    stats: aggregate(rows),
    distinctPercussion: rhythms.percussion.size,
    distinctBass: rhythms.bass.size,
        barsBass: barsSounding.bass,
        barsPercussion: barsSounding.percussion,
  };
}

function main() {
  const showAll = process.argv.includes("--all");
  const bars = Number(arg("bars", 96));
  const seeds = arg("seeds", "1,2,3,4").split(",").map(Number);

  const reference = JSON.parse(
    readFileSync(join(HERE, "groove-reference.json"), "utf8"),
  ).labels;

  const outDir = mkdtempSync(join(tmpdir(), "lime-groove-gap-"));
  const measured = new Map();
  try {
    for (const genreId of Object.keys(COMPARABLE)) {
      const result = renderAndMeasure(genreId, seeds, bars, outDir);
      if (result) measured.set(genreId, result);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  const genres = [...measured.keys()];
  const header = genres.map((g) => (NAMES[g] ?? g).slice(0, 10).padStart(15)).join("");
  console.log(`\nLIME vs real reference — ${bars} bars, seeds ${seeds.join(",")}`);
  console.log("(value / reference; * marks off-target)\n");
  console.log("".padEnd(18) + header);

  let offTarget = 0;
  for (const [name] of METRICS) {
    const cells = [];
    let anyOff = false;
    for (const g of genres) {
      const mine = measured.get(g).stats[name];
      const ref = reference[COMPARABLE[g]]?.[name];
      if (ref === undefined || !Number.isFinite(mine)) {
        cells.push("n/a".padStart(15));
        continue;
      }
      if (UNRELIABLE_FOR[name]?.has(COMPARABLE[g])) {
        cells.push(`${mine.toFixed(2)}/  —  `.padStart(15));
        continue;
      }
      const off = Math.abs(mine - ref) > (TOLERANCE[name] ?? Infinity);
      if (off) anyOff = true;
      cells.push(`${mine.toFixed(2)}/${ref.toFixed(2)}${off ? "*" : " "}`.padStart(15));
    }
    if (anyOff) offTarget++;
    if (showAll || anyOff) console.log(name.padEnd(18) + cells.join(""));
  }

  // Variety per 100 sounding bars, not the raw count: a slower genre fits
  // fewer bars into the same span, so raw counts are not comparable across a row.
  const per100 = (m, voice) =>
    voice === "bass"
      ? m.barsBass ? (m.distinctBass / m.barsBass) * 100 : 0
      : m.barsPercussion ? (m.distinctPercussion / m.barsPercussion) * 100 : 0;
  console.log("\nvariety per 100 sounding bars (* = watch: the voice may be repeating itself)");
  for (const voice of ["percussion", "bass"]) {
    const floor = VARIETY_WATCH[voice];
    console.log(
      `${voice} (watch <${floor})`.padEnd(18) +
        genres
          .map((g) => {
            const r = per100(measured.get(g), voice);
            return `${r.toFixed(1)}${r < floor ? "*" : " "}`.padStart(15);
          })
          .join(""),
    );
  }

  console.log("\n" + "distinct rhythms (velocity stripped — see the header comment)");
  console.log(
    "percussion".padEnd(18) +
      genres.map((g) => String(measured.get(g).distinctPercussion).padStart(15)).join(""),
  );
  console.log(
    "bass".padEnd(18) +
      genres.map((g) => String(measured.get(g).distinctBass).padStart(15)).join(""),
  );

  if (!showAll) {
    console.log(
      `\n${offTarget} metric(s) off target. Pass --all to see every row, ` +
        `including the ones already passing.`,
    );
  }
  console.log(
    "\nghost, swing and timingDevMs carry no tolerance: the reference corpus " +
      "cannot measure the first two,\nand the third is judged against the " +
      "literature, not the corpus. A dash means the reference cannot judge " +
      "that\ncell at all — the 16th-share metrics collapse against Jazz and " +
      "Blues, whose reference\nrecordings had their swing quantised away. See " +
      "GROOVE-CRITERIA.md.",
  );
}

main();
