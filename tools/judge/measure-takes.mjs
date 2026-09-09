#!/usr/bin/env node
/**
 * measure-takes.mjs — N-take measurement harness for the judge renderers.
 *
 * WHY THIS EXISTS: see take-stats.mjs's docblock for the full story. In short,
 * `render-tone.mjs` is not bit-reproducible (Chromium's OfflineAudioContext,
 * below this repo's own code), while `render.mjs` (FluidSynth) is. Rather
 * than chase determinism this harness renders each (genre, seed) `--takes`
 * times, measures the same metrics on every take, and reports each metric's
 * spread across takes — so a later comparison can tell a real difference
 * apart from take-to-take noise instead of reacting to one render.
 *
 * This script owns every side effect (spawning the renderers, spawning
 * ffmpeg, reading files); all the actual statistics live in the
 * dependency-free take-stats.mjs, the same split build-calibration-corpus.mjs
 * uses around calibration-corpus.mjs.
 *
 * Usage:
 *   node tools/judge/measure-takes.mjs --genres=genre-rock-pop,genre-jazz \
 *     [--seeds=1,2,3] [--takes=5] [--seconds=22] \
 *     [--palette=sampled|synth|gm] [--out=path.json] [--json]
 */

import { execFile } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TAKE_METRIC_KEYS, envelopeStats, summarizeTakes } from "./take-stats.mjs";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const DEMO_DIST = join(REPO, "apps/demo/dist");
const RENDER_TONE = join(HERE, "render-tone.mjs");
const RENDER_GM = join(HERE, "render.mjs");

const SCHEMA_VERSION = 1;
const DEFAULT_SAMPLE_RATE = 44100;
const PALETTES = new Set(["sampled", "synth", "gm"]);

const USAGE = `Usage: node tools/judge/measure-takes.mjs --genres=genre-rock-pop,genre-jazz \\
  [--seeds=1,2,3] [--takes=5] [--seconds=22] [--palette=sampled|synth|gm] \\
  [--out=path.json] [--json]

Renders each (genre, seed) pair --takes times through the requested renderer,
measures gapFloor/punch/peak/rms on every take, and reports the median and
spread of each metric across takes.

  --genres=   comma-separated genre keys (required)
  --seeds=    comma-separated seeds (default: 5)
  --takes=    number of takes per (genre, seed) (default: 5)
  --seconds=  seconds of audio to measure, before the reverb tail (default: 22)
  --palette=  sampled | synth | gm (default: sampled)
  --out=      write the JSON summary to this path
  --json      print the JSON summary instead of the table`;

export class MeasureTakesError extends Error {
  constructor(message, code = "MEASURE_TAKES_INVALID") {
    super(message);
    this.name = "MeasureTakesError";
    this.code = code;
  }
}

function splitList(raw) {
  return raw.split(",").map((token) => token.trim()).filter(Boolean);
}

function parsePositiveInt(raw, flag) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new MeasureTakesError(`${flag} must be a positive integer`);
  }
  return value;
}

function parsePositiveNumber(raw, flag) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new MeasureTakesError(`${flag} must be a positive finite number`);
  }
  return value;
}

const OPTION_FLAGS = new Map([
  ["--genres", "genres"],
  ["--seeds", "seeds"],
  ["--takes", "takes"],
  ["--seconds", "seconds"],
  ["--palette", "palette"],
  ["--out", "out"],
]);

/** Parses argv into validated options. Pure — no filesystem, no process
 *  exit — so both `main` and tests can call it directly. */
export function parseArgs(argv) {
  const raw = { json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--json") {
      raw.json = true;
      continue;
    }

    const flag = [...OPTION_FLAGS.keys()].find(
      (name) => argument === name || argument.startsWith(`${name}=`),
    );
    if (!flag) throw new MeasureTakesError(`Unknown option: ${argument}`);

    let value;
    if (argument.startsWith(`${flag}=`)) {
      value = argument.slice(flag.length + 1);
    } else {
      value = argv[index + 1];
      index += 1;
    }
    if (!value) throw new MeasureTakesError(`${flag} requires a value`);
    raw[OPTION_FLAGS.get(flag)] = value;
  }

  if (!raw.genres) throw new MeasureTakesError("--genres is required");
  const genres = splitList(raw.genres);
  if (genres.length === 0) throw new MeasureTakesError("--genres must list at least one genre");

  const seeds = splitList(raw.seeds ?? "5").map((token) => parsePositiveInt(token, "--seeds"));
  const takes = parsePositiveInt(raw.takes ?? "5", "--takes");
  const seconds = parsePositiveNumber(raw.seconds ?? "22", "--seconds");
  const palette = raw.palette ?? "sampled";
  if (!PALETTES.has(palette)) {
    throw new MeasureTakesError(`--palette must be one of ${[...PALETTES].join(", ")}`);
  }

  return {
    help: false,
    genres,
    seeds,
    takes,
    seconds,
    palette,
    out: raw.out ?? null,
    json: raw.json,
  };
}

function nodeAdapter() {
  return {
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },
    /** Runs a command with inherited stdio — renderers print their own
     *  per-clip progress, and hiding that during a slow N-take loop would
     *  make a stuck run indistinguishable from a working one. */
    async run(command, args, options = {}) {
      await execFileAsync(command, args, { cwd: options.cwd, stdio: "inherit" });
    },
    /** Runs a command and returns its captured stdout as a Buffer, for
     *  ffmpeg's raw PCM output. */
    async capture(command, args, options = {}) {
      const { stdout } = await execFileAsync(command, args, {
        cwd: options.cwd,
        encoding: "buffer",
        maxBuffer: 1024 * 1024 * 200,
      });
      return stdout;
    },
    async writeFile(path, contents) {
      await writeFile(path, contents, "utf8");
    },
  };
}

/** Checks every prerequisite up front so a mid-run failure never leaves a
 *  half-finished, misleading batch of takes on disk. */
async function checkPrerequisites(options, adapter) {
  try {
    await adapter.run("ffmpeg", ["-version"], { cwd: REPO });
  } catch {
    throw new MeasureTakesError(
      "ffmpeg is required but was not found on PATH (sudo apt install -y ffmpeg)",
      "MEASURE_TAKES_PREREQUISITE_MISSING",
    );
  }

  if (options.palette !== "gm") {
    const renderHtml = join(DEMO_DIST, "render.html");
    if (!(await adapter.exists(renderHtml))) {
      throw new MeasureTakesError(
        `Missing ${renderHtml}. The sampled/synth palettes render through the ` +
          `built demo. Build it first:\n  pnpm build && pnpm --filter @lime/demo build`,
        "MEASURE_TAKES_PREREQUISITE_MISSING",
      );
    }
  }
}

function outputDirFor(palette) {
  if (palette === "gm") return join(HERE, "out");
  if (palette === "sampled") return join(HERE, "out/tone-sampled");
  return join(HERE, "out/tone");
}

function wavPathFor(palette, genre, seed) {
  return join(outputDirFor(palette), `${genre}_seed${seed}.wav`);
}

function rendererInvocation(palette, genre, seed, seconds) {
  const common = [`--genres=${genre}`, `--seeds=${seed}`, `--seconds=${seconds}`];
  if (palette === "gm") return { script: RENDER_GM, args: common };
  return { script: RENDER_TONE, args: [...common, `--palette=${palette}`] };
}

/** Renders exactly one take of one (genre, seed) pair by spawning the
 *  existing renderer scripts — this harness never reimplements rendering,
 *  only measures its output. Each renderer writes to the same fixed path per
 *  (genre, seed), so calling it `--takes` times and reading the WAV back
 *  right after each call (before the next overwrites it) is what actually
 *  captures N independent takes. */
async function renderTake(adapter, palette, genre, seed, seconds) {
  const { script, args } = rendererInvocation(palette, genre, seed, seconds);
  await adapter.run(process.execPath, [script, ...args], { cwd: REPO });

  const wavPath = wavPathFor(palette, genre, seed);
  if (!(await adapter.exists(wavPath))) {
    throw new MeasureTakesError(`Renderer did not produce ${wavPath}`, "MEASURE_TAKES_RENDER_FAILED");
  }
  return wavPath;
}

/** Decodes a rendered WAV to mono 16-bit PCM at a fixed sample rate via
 *  ffmpeg, truncated to `seconds` — exactly the transcode step
 *  build-calibration-corpus.mjs already spawns, but piped to stdout instead
 *  of a file since this harness only needs the samples. The truncation
 *  matters: `apps/demo/src/render.ts`'s REVERB_TAIL_SEC (5s) appends a quiet
 *  reverb tail past the intended clip length, and that tail biases gapFloor
 *  downward if it leaks into the measurement window. */
async function decodePcm(adapter, wavPath, seconds) {
  const args = [
    "-y",
    "-v",
    "error",
    "-i",
    wavPath,
    "-t",
    String(seconds),
    "-ar",
    String(DEFAULT_SAMPLE_RATE),
    "-ac",
    "1",
    "-f",
    "s16le",
    "pipe:1",
  ];
  const stdout = await adapter.capture("ffmpeg", args, { cwd: REPO });
  return new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
}

/** Renders and measures every (genre, seed) pair `options.takes` times, and
 *  returns each metric's per-take summary. */
export async function measureTakes(options, adapter = nodeAdapter()) {
  await checkPrerequisites(options, adapter);

  const results = [];
  for (const genre of options.genres) {
    for (const seed of options.seeds) {
      const perMetric = Object.fromEntries(TAKE_METRIC_KEYS.map((key) => [key, []]));

      for (let take = 0; take < options.takes; take += 1) {
        const wavPath = await renderTake(adapter, options.palette, genre, seed, options.seconds);
        const pcm = await decodePcm(adapter, wavPath, options.seconds);
        const stats = envelopeStats(pcm, { sampleRate: DEFAULT_SAMPLE_RATE });
        for (const key of TAKE_METRIC_KEYS) perMetric[key].push(stats[key]);
      }

      // Each metric keeps its raw per-take values alongside the summary. The
      // summary is what a reader wants; the values are what `compareConditions`
      // needs, and without them two saved runs cannot be compared at all — which
      // is the whole reason this harness exists.
      const metrics = Object.fromEntries(
        TAKE_METRIC_KEYS.map((key) => [
          key,
          { ...summarizeTakes(perMetric[key]), values: [...perMetric[key]] },
        ]),
      );
      results.push({ genre, seed, metrics });
    }
  }

  return results;
}

function formatNumber(value) {
  return value.toFixed(4);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

const TABLE_COLUMNS = [
  { key: "genre", align: "left" },
  { key: "seed", align: "right" },
  { key: "metric", align: "left" },
  { key: "median", align: "right" },
  { key: "min", align: "right" },
  { key: "max", align: "right" },
  { key: "relSpread", align: "right" },
];

/** One row per (genre, seed, metric), digits column-aligned. */
export function renderTable(results) {
  const rows = results.flatMap(({ genre, seed, metrics }) =>
    TAKE_METRIC_KEYS.map((metric) => {
      const summary = metrics[metric];
      return {
        genre,
        seed: String(seed),
        metric,
        median: formatNumber(summary.median),
        min: formatNumber(summary.min),
        max: formatNumber(summary.max),
        relSpread: formatPercent(summary.relSpread),
      };
    }),
  );

  const widths = Object.fromEntries(
    TABLE_COLUMNS.map(({ key }) => [
      key,
      Math.max(key.length, ...rows.map((row) => row[key].length)),
    ]),
  );
  const pad = (value, key, align) => (align === "right" ? value.padStart(widths[key]) : value.padEnd(widths[key]));
  const formatRow = (row) => TABLE_COLUMNS.map(({ key, align }) => pad(row[key], key, align)).join("  ");

  const header = formatRow(Object.fromEntries(TABLE_COLUMNS.map(({ key }) => [key, key])));
  const separator = TABLE_COLUMNS.map(({ key }) => "-".repeat(widths[key])).join("  ");
  return [header, separator, ...rows.map(formatRow)].join("\n");
}

/** Builds the stable JSON summary — schema version, the exact invocation
 *  parameters, and per-genre/seed/metric summaries. No timestamp: these
 *  outputs are meant to be diffed across runs to see whether a change moved
 *  a metric, and a timestamp would make every diff noisy. */
export function buildReport(options, results) {
  return {
    schemaVersion: SCHEMA_VERSION,
    invocation: {
      genres: options.genres,
      seeds: options.seeds,
      takes: options.takes,
      seconds: options.seconds,
      palette: options.palette,
    },
    results: results.map(({ genre, seed, metrics }) => ({ genre, seed, metrics })),
  };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(USAGE);
      return 0;
    }

    const results = await measureTakes(options);
    const report = buildReport(options, results);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderTable(results));
    }

    if (options.out) {
      const outPath = resolve(REPO, options.out);
      await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log(`\nWrote ${outPath}`);
    }

    return 0;
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then((code) => {
    process.exitCode = code;
  });
}
