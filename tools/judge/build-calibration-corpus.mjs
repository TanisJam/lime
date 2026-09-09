#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CALIBRATION_CANDIDATES,
  planCorpus,
  resolveAssets,
  validateRegistry,
} from "./calibration-corpus.mjs";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const DEFAULT_REGISTRY_PATH = join(HERE, "calibration-registry.json");
const DEFAULT_OUTPUT_DIR = join(HERE, "out/calibration");
const DEFAULT_SOUNDFONT_PATH = join(REPO, "apps/demo/public/soundfonts/GeneralUser-GS.sf2");
const DEFAULT_SECONDS = 22;
const DEFAULT_SAMPLE_RATE = 44100;
const MINIMUM_WAV_BYTES = 44;
const MIDI_EXTENSIONS = new Set([".mid", ".midi"]);

const USAGE = `Usage: node tools/judge/build-calibration-corpus.mjs \\
  --assets-root=/absolute/path/to/acquired-assets \\
  [--registry=tools/judge/calibration-registry.json] \\
  [--out=tools/judge/out/calibration] [--seconds=22]`;

export class CalibrationBuildError extends Error {
  constructor(message, code = "CALIBRATION_BUILD_INVALID") {
    super(message);
    this.name = "CalibrationBuildError";
    this.code = code;
  }
}

function optionValue(argv, index, option) {
  const argument = argv[index];
  const prefix = `${option}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), next: index };
  if (argument === option && argv[index + 1] !== undefined) {
    return { value: argv[index + 1], next: index + 1 };
  }
  return null;
}

export function parseArgs(argv) {
  const values = {};
  const options = new Map([
    ["--assets-root", "assetsRoot"],
    ["--registry", "registryPath"],
    ["--out", "outputDir"],
    ["--seconds", "seconds"],
    ["--soundfont", "soundfontPath"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--help" || argv[index] === "-h") return { help: true };
    const option = [...options.keys()].find((name) => argv[index] === name || argv[index].startsWith(`${name}=`));
    if (!option) throw new CalibrationBuildError(`Unknown option: ${argv[index]}`);
    const parsed = optionValue(argv, index, option);
    if (!parsed || parsed.value.length === 0) throw new CalibrationBuildError(`${option} requires a value`);
    values[options.get(option)] = parsed.value;
    index = parsed.next;
  }

  if (!values.assetsRoot) throw new CalibrationBuildError("--assets-root is required");
  if (values.seconds !== undefined) {
    values.seconds = Number(values.seconds);
    if (!Number.isFinite(values.seconds) || values.seconds <= 0) {
      throw new CalibrationBuildError("--seconds must be a positive finite number");
    }
  }
  return values;
}

function nodeAdapter() {
  return {
    readFile,
    mkdir,
    rm,
    rename,
    stat,
    writeFile,
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },
    async run(command, args, options) {
      await execFileAsync(command, args, { cwd: options.cwd, stdio: "ignore" });
    },
    now() {
      return new Date().toISOString();
    },
  };
}

function absoluteOption(value, name, cwd) {
  if (typeof value !== "string" || value.length === 0) {
    throw new CalibrationBuildError(`${name} must be provided`);
  }
  return resolve(cwd, value);
}

async function requireExists(adapter, path, description) {
  if (!(await adapter.exists(path))) {
    throw new CalibrationBuildError(`${description} is unavailable at ${path}`, "CALIBRATION_PREREQUISITE_MISSING");
  }
}

async function resolveLocalAssets(adapter, registry, assetRoot) {
  const available = new Map();
  for (const item of registry.items) {
    const inputPath = resolve(assetRoot, item.localPath);
    available.set(inputPath, await adapter.exists(inputPath));
  }
  return resolveAssets(registry, assetRoot, (inputPath) => available.get(inputPath) === true);
}

async function removeQuietly(adapter, path, options = {}) {
  try {
    await adapter.rm(path, { recursive: true, force: true, ...options });
  } catch {
    // Cleanup must not hide the renderer or publish error that caused it.
  }
}

async function publishStaged(adapter, stageDir, outputDir) {
  const backupDir = `${outputDir}.previous`;
  let backedUp = false;

  if (await adapter.exists(outputDir)) {
    await removeQuietly(adapter, backupDir);
    await adapter.rename(outputDir, backupDir);
    backedUp = true;
  }

  try {
    await adapter.rename(stageDir, outputDir);
  } catch (error) {
    if (backedUp) {
      await adapter.rename(backupDir, outputDir).catch(() => {});
    }
    throw error;
  }

  if (backedUp) await removeQuietly(adapter, backupDir);
}

function renderArguments(job, { sampleRate, soundfontPath }) {
  return [
    "-ni",
    "-g",
    "0.8",
    "-r",
    String(sampleRate),
    "-F",
    job.rawPath,
    soundfontPath,
    job.inputPath,
  ];
}

function transcodeArguments(job, { seconds, sampleRate }) {
  return [
    "-y",
    "-i",
    job.rawPath,
    "-t",
    String(seconds),
    "-ar",
    String(sampleRate),
    "-ac",
    "1",
    job.outputPath,
  ];
}

export async function buildCalibrationCorpus(options, adapter = nodeAdapter()) {
  const cwd = resolve(options?.cwd ?? REPO);
  const assetsRoot = absoluteOption(options?.assetsRoot, "assetsRoot", cwd);
  const registryPath = absoluteOption(options?.registryPath ?? DEFAULT_REGISTRY_PATH, "registryPath", cwd);
  const outputDir = absoluteOption(options?.outputDir ?? DEFAULT_OUTPUT_DIR, "outputDir", cwd);
  const soundfontPath = absoluteOption(options?.soundfontPath ?? DEFAULT_SOUNDFONT_PATH, "soundfontPath", cwd);
  const seconds = options?.seconds ?? DEFAULT_SECONDS;
  const sampleRate = options?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const stageDir = `${outputDir}.staging`;

  const registry = JSON.parse(String(await adapter.readFile(registryPath, "utf8")));
  const normalized = validateRegistry(registry);
  await requireExists(adapter, assetsRoot, "Asset root");
  const resolved = await resolveLocalAssets(adapter, normalized, assetsRoot);
  await requireExists(adapter, soundfontPath, "SoundFont");

  for (const item of resolved.items) {
    if (!MIDI_EXTENSIONS.has(extname(item.inputPath).toLowerCase())) {
      throw new CalibrationBuildError(`Unsupported calibration input: ${item.inputPath}`);
    }
  }

  const { jobs: plannedJobs, manifest } = planCorpus(normalized, {
    seconds,
    sampleRate,
    outputDir: stageDir,
  });
  const inputById = new Map(resolved.items.map((item) => [item.id, item.inputPath]));
  const jobs = plannedJobs.map((job) => ({
    ...job,
    inputPath: inputById.get(job.id),
    rawPath: join(stageDir, `${job.id}.tmp.wav`),
  }));
  const temporaryPaths = jobs.map((job) => job.rawPath);
  let published = false;

  await removeQuietly(adapter, stageDir);
  await adapter.mkdir(stageDir, { recursive: true });

  try {
    for (const job of jobs) {
      await adapter.run("fluidsynth", renderArguments(job, { sampleRate, soundfontPath }), { cwd });
      await adapter.run("ffmpeg", transcodeArguments(job, { seconds, sampleRate }), { cwd });
      const output = await adapter.stat(job.outputPath);
      if (!Number.isFinite(output.size) || output.size <= MINIMUM_WAV_BYTES) {
        throw new CalibrationBuildError(`Rendered WAV is empty or trivial: ${job.outputPath}`);
      }
      await removeQuietly(adapter, job.rawPath, { recursive: false });
    }

    const publishedManifest = {
      ...manifest,
      generatedAt: adapter.now(),
    };
    await adapter.writeFile(
      join(stageDir, "manifest.json"),
      JSON.stringify(publishedManifest, null, 2) + "\n",
      "utf8",
    );
    await publishStaged(adapter, stageDir, outputDir);
    published = true;
    return { manifest: publishedManifest, outputDir, jobs };
  } catch (error) {
    if (error instanceof CalibrationBuildError || error instanceof Error) throw error;
    throw new CalibrationBuildError(String(error));
  } finally {
    for (const temporaryPath of temporaryPaths) {
      await removeQuietly(adapter, temporaryPath, { recursive: false });
    }
    if (!published) await removeQuietly(adapter, stageDir);
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(USAGE);
      return 0;
    }
    const result = await buildCalibrationCorpus(options);
    const counts = Object.fromEntries(
      CALIBRATION_CANDIDATES.map((candidate) => [
        candidate,
        result.manifest.clips.filter((clip) => clip.truth === candidate).length,
      ]),
    );
    console.log(`Built ${result.manifest.clips.length} calibration clips at ${result.outputDir}`);
    console.log(`Class counts: ${JSON.stringify(counts)}`);
    console.log(`Manifest: ${join(result.outputDir, "manifest.json")}`);
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
