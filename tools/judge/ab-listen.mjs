/**
 * Blind A/B listening test — the instrument for the questions measurement
 * cannot answer.
 *
 * `GROOVE-CRITERIA.md` is explicit that some things do not yield to a number:
 * microtiming magnitude above all (Senn et al. 2016 found perceived groove
 * peaks near 40% of real-human deviation, and Davies et al. 2013 found fully
 * quantised versions rated highest in most non-jazz genres). A blind listening
 * test has already once caught a defect that the entire audio-model stack
 * scored as an improvement. So when two options both look defensible on the
 * tables, the ear decides — and it has to be blind, because knowing which clip
 * is "the fix" is enough to hear it as better.
 *
 * This renders two style variants of the same genre and seeds, loudness-matches
 * them so neither wins on level alone, shuffles them under opaque labels, and
 * writes the answer key to a separate file. Listen first, read the key after.
 *
 * Usage:
 *   node tools/judge/ab-listen.mjs --genre=genre-funk --variant=bass-syncopation
 *   node tools/judge/ab-listen.mjs --genre=genre-funk --variant=bass-syncopation --seeds=1,2,3,4
 *
 * Output lands in `tools/judge/out/ab/<variant>/`:
 *   clip-01.wav … clip-NN.wav   the shuffled clips — listen to these
 *   clip-01.mp3 … clip-NN.mp3   the same clips, small enough to carry to a phone
 *   PROMPT.md                   what to listen for, and how to answer
 *   RATIONALE.md                why it is being asked. Do NOT read before answering.
 *   ANSWER-KEY.json             which clip was which. Read this LAST.
 *
 *   node tools/judge/ab-page.mjs builds a single self-contained HTML page from any
 *   rendered test, so it can be answered on a phone or offline.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createLime } from "../../packages/core/dist/index.js";
import { eventsToStandardMidiFile } from "../../packages/midi/dist/index.js";
import { STATE, GM, stylePack, NAMES, } from "./genreTables.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
const SF2 = join(REPO, "apps/demo/public/soundfonts/GeneralUser-GS.sf2");

/**
 * The A/B questions this tool knows how to pose.
 *
 * Each names the two variants as StylePack patches, so whichever the ear picks
 * becomes a configuration value rather than a code edit. `patch` is merged onto
 * the genre's resolved StylePack.
 */
const VARIANTS = {
  "bass-syncopation": {
    genre: "genre-funk",
    question:
      "Which bass line sits better in the groove — and does either read as " +
      "trying too hard?",
    detail:
      "Both keep the same kick pattern and the same bass/kick interlock. They " +
      "differ only in how the bar is finished: one pushes out on an off-beat " +
      "sixteenth, the other lands on the quarters.",
    // Withheld from PROMPT.md deliberately. This paragraph names which variant
    // the measurements favour, and this is a *preference* test: telling the
    // listener which answer is "correct" is priming, and priming is the exact
    // thing blinding exists to prevent. It goes to RATIONALE.md instead, and the
    // HTML page keeps it behind the answer-key reveal.
    rationale:
      "Measured against real funk recordings, the pushed version overshoots " +
      "the reference (bassOffbeat 0.79 against 0.53, bass16th 0.40 against " +
      "0.20) and the grounded version is almost exactly on target (0.50 and " +
      "0.17). That is *why* this is being asked rather than decided: the " +
      "pushed version is the one already confirmed by ear, so the numbers and " +
      "the previous listening pass disagree. Nothing in the tables settles it.",
    a: { label: "pushed (current default, ear-confirmed)", patch: { bassGroove: { syncopation: 1 } } },
    b: { label: "grounded (matches the measured reference)", patch: { bassGroove: { syncopation: 0.3 } } },
  },
  "bass-variety": {
    genre: "genre-funk",
    question:
      "Which bass line holds the groove better over two minutes — and does " +
      "either one start to feel like a loop?",
    detail:
      "Both play the same kick anchors and the same two core pushes, so the " +
      "bass/kick interlock is identical. The only difference is whether the " +
      "bar's finish is chosen fresh each bar, or fixed to the same reading from " +
      "the first bar to the last.",
    // Withheld from PROMPT.md deliberately: naming the hypothesis is priming,
    // and priming is the exact thing blinding exists to prevent.
    rationale:
      "This asks the question the earlier bass test could not. That test compared " +
      "two *static* finishes and the ear accepted both, reported as 'either is " +
      "fine'. But it never varied anything: fixed at syncopation 0.3, the shipped " +
      "funk bass produced exactly ONE rhythm for 700 consecutive bars — the same " +
      "bar in every seed, from bar 0. Every positional metric stayed on target, " +
      "which is why it survived: bassOffbeat, bass16th and bassKickLock measure " +
      "shares and positions, never repetition. Variety was never in the table.",
    a: { label: "varied (per-bar draw)", patch: { bassGroove: { syncopation: 0.3 } } },
    b: { label: "frozen (always the same finish)", patch: { bassGroove: { syncopation: 0 } } },
  },
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** Render one variant of one seed to WAV. Returns the path. */
function renderClip(genreId, patch, seed, seconds, outDir, tag) {
  const state = STATE[genreId];
  const base = stylePack(genreId);
  const style = { ...base, ...patch };
  const cfg = GM[genreId] ?? {};
  const bars = Math.ceil(seconds / (240 / state.tempo));

  const lime = createLime({ seed, style, initialState: state });
  const events = [];
  // Skip the form arch's opening: a short clip taken from bar 0 is always the
  // intro of a two-minute build, which is not what the genre is known for and
  // is the same bias that made every earlier clip unrepresentative.
  const warmup = 24;
  for (let bar = 0; bar < warmup + bars; bar++) {
    const barEvents = lime.composeBar(bar);
    if (bar < warmup) continue;
    for (const e of barEvents) {
      events.push({ ...e, time: e.time - warmup * 1920 });
    }
  }

  const programs = {};
  for (const v of ["pad", "bass", "melody", "motion"]) {
    if (cfg[v] !== undefined) programs[v] = cfg[v];
  }

  const mid = join(outDir, `.${tag}-${seed}.mid`);
  const raw = join(outDir, `.${tag}-${seed}.raw.wav`);
  const norm = join(outDir, `.${tag}-${seed}.wav`);

  writeFileSync(
    mid,
    eventsToStandardMidiFile(events, {
      tempo: state.tempo,
      ppq: 480,
      programs,
      name: `${genreId} ${tag} ${seed}`,
    }),
  );
  execFileSync("fluidsynth", ["-ni", "-g", "0.8", "-r", "44100", "-F", raw, SF2, mid], {
    stdio: "ignore",
  });
  // Loudness-match, so neither variant can win simply by being louder — the
  // single most common way an informal A/B fools the listener.
  execFileSync(
    "ffmpeg",
    ["-y", "-i", raw, "-af", "loudnorm=I=-18:TP=-1.5:LRA=11", "-ar", "44100", norm],
    { stdio: "ignore" },
  );
  rmSync(mid, { force: true });
  rmSync(raw, { force: true });
  return norm;
}

/** Deterministic shuffle, so a rerun with the same seed poses the same test. */
function shuffle(items, seed) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function main() {
  const variantName = arg("variant", "bass-syncopation");
  const variant = VARIANTS[variantName];
  if (!variant) {
    console.error(
      `unknown variant "${variantName}". Available: ${Object.keys(VARIANTS).join(", ")}`,
    );
    process.exit(2);
  }
  const genreId = arg("genre", variant.genre);
  const seeds = arg("seeds", "1,2,3,4").split(",").map(Number);
  const seconds = Number(arg("seconds", 20));
  const shuffleSeed = Number(arg("shuffle", 20260909));

  if (!existsSync(SF2)) {
    console.error(`SoundFont not found at ${SF2} — see tools/judge/README.md`);
    process.exit(1);
  }

  const outDir = join(HERE, "out", "ab", variantName);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const rendered = [];
  for (const seed of seeds) {
    for (const side of ["a", "b"]) {
      const path = renderClip(genreId, variant[side].patch, seed, seconds, outDir, side);
      rendered.push({ side, seed, path });
    }
  }

  const order = shuffle(rendered, shuffleSeed);
  const key = [];
  order.forEach((item, i) => {
    const name = `clip-${String(i + 1).padStart(2, "0")}.wav`;
    execFileSync("mv", [item.path, join(outDir, name)]);
    // A portable copy as well. The WAV is the measurement artifact; the mp3 is so
    // the test can actually be taken away from the desk it was rendered on.
    execFileSync(
      "ffmpeg",
      ["-y", "-i", join(outDir, name), "-b:a", "160k", "-ar", "44100", join(outDir, name.replace(/\.wav$/, ".mp3"))],
      { stdio: "ignore" },
    );
    key.push({ clip: name, variant: variant[item.side].label, side: item.side, seed: item.seed });
  });

  writeFileSync(
    join(outDir, "ANSWER-KEY.json"),
    JSON.stringify(
      { variant: variantName, genre: NAMES[genreId] ?? genreId, clips: key },
      null,
      2,
    ),
  );

  const prompt = `# Blind listening test — ${NAMES[genreId] ?? genreId}: ${variantName}

${variant.question}

${variant.detail}

## How to do this

${order.length} clips, ${seconds}s each, in \`${outDir}\`. Two variants, ${seeds.length} seeds
each, shuffled and loudness-matched. Both are the same genre, tempo and seed set —
only the one property above differs.

Play them in order and write one line per clip: which you would rather keep, and
whether either one starts to feel **repetitive** (like a loop) as it plays. You
are not being asked to identify the variants or to guess what changed — you are
being asked which you prefer, clip by clip, without knowing which is which.

This file deliberately does **not** say which variant the measurements favour.
That reasoning is in \`RATIONALE.md\`, withheld because this is a preference test:
being told which answer is "correct" is enough to hear it as correct, which is
exactly what blinding is for. Read it after answering.

Do not open \`ANSWER-KEY.json\` until you have written your answers down.
Knowing which clip is "the fix" is enough to hear it as better — that is the
whole reason this is blind.

## Answering

A list is enough, e.g. \`1 keep, 2 keep, 3 …\`, plus any note you want to add.
If the two are indistinguishable to you, that is a real and useful result: it
means the measured target should win, because nothing is lost by taking it.
`;
  writeFileSync(join(outDir, "PROMPT.md"), prompt);

  // The measurement rationale lives apart from the prompt so it cannot prime the
  // listener. Everything before the answer belongs to the ear; everything after
  // belongs to the tables.
  const rationale = `# Why this is being asked — read this AFTER answering

This file exists because the reasoning below names which variant the numbers
prefer, and this is a *preference* test. Read it once your list is written.

## The question

${variant.question}

## The measurement rationale

${variant.rationale}

## How to read the result

- If the **pushed** version wins, the ear keeps its call and the reference gap is
  a documented overshoot rather than a defect.
- If the **grounded** version wins, the measured target was right and the earlier
  listening pass was reading a rendering artefact, not the line.
- If the two are **indistinguishable**, take the grounded version: it matches the
  reference, and nothing is lost by preferring it.

Whichever wins becomes a configuration value, not a code edit.
`;
  writeFileSync(join(outDir, "RATIONALE.md"), rationale);

  console.log(`\n${order.length} clips written to ${outDir}`);
  console.log(`Read PROMPT.md first. Do NOT open ANSWER-KEY.json until you have answered.\n`);
}

main();
