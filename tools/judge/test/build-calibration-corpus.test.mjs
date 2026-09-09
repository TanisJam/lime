import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCalibrationCorpus, parseArgs } from "../build-calibration-corpus.mjs";

const registry = JSON.parse(
  readFileSync(new URL("../calibration-registry.json", import.meta.url), "utf8"),
);
const paths = registry.items.map((item) => `/assets/${item.localPath}`);
const options = {
  assetsRoot: "/assets",
  registryPath: "/repo/calibration-registry.json",
  outputDir: "/repo/out/calibration",
  soundfontPath: "/repo/soundfont.sf2",
  seconds: 22,
  sampleRate: 44100,
};

function fakeAdapter({
  registryValue = registry,
  existing = new Set(["/assets", "/repo/soundfont.sf2", ...paths]),
  runError,
  onRun,
  renameError,
  statSize = 4096,
} = {}) {
  const files = new Map([[options.registryPath, JSON.stringify(registryValue)] ]);
  const created = new Set();
  const calls = { mkdir: [], rm: [], rename: [], write: [], run: [] };
  return {
    calls,
    created,
    async readFile(path) {
      if (!files.has(path)) throw new Error(`unexpected read: ${path}`);
      return files.get(path);
    },
    async exists(path) {
      return existing.has(path) || created.has(path);
    },
    async mkdir(path) {
      calls.mkdir.push(path);
      created.add(path);
    },
    async rm(path) {
      calls.rm.push(path);
      for (const value of [...created]) {
        if (value === path || value.startsWith(`${path}/`)) created.delete(value);
      }
    },
    async rename(from, to) {
      calls.rename.push([from, to]);
      if (renameError) throw renameError;
      created.add(to);
    },
    async writeFile(path, contents) {
      calls.write.push([path, contents]);
      created.add(path);
      files.set(path, contents);
    },
    async stat(path) {
      if (!created.has(path)) throw new Error(`unexpected stat: ${path}`);
      return { size: statSize };
    },
    async run(command, args, runOptions) {
      calls.run.push([command, args, runOptions]);
      if (runError) throw runError;
      if (onRun) return onRun({ command, args, runOptions, calls, created });
      if (command === "fluidsynth") created.add(args[args.indexOf("-F") + 1]);
      if (command === "ffmpeg") created.add(args.at(-1));
    },
    now() {
      return "2026-01-02T03:04:05.000Z";
    },
  };
}

function invalidRegistry(mutator) {
  const value = structuredClone(registry);
  mutator(value);
  return value;
}

for (const [name, setup] of [
  ["invalid registry", () => ({ registryValue: invalidRegistry((value) => { value.schemaVersion = 2; }) })],
  ["missing asset root", () => ({ existing: new Set(["/repo/soundfont.sf2"]) })],
  ["missing asset file", () => ({ existing: new Set(["/assets", "/repo/soundfont.sf2", ...paths.slice(1)]) })],
  ["missing SoundFont", () => ({ existing: new Set(["/assets", ...paths]) })],
]) {
  test(`${name} fails before output creation or renderer invocation`, async () => {
    const adapter = fakeAdapter(setup());

    await assert.rejects(
      () => buildCalibrationCorpus(options, adapter),
      /calibration|asset|SoundFont/i,
    );
    assert.deepEqual(adapter.calls.mkdir, []);
    assert.deepEqual(adapter.calls.run, []);
    assert.deepEqual(adapter.calls.write, []);
  });
}

test("render failure publishes no manifest and cleans staged temporary WAVs", async () => {
  const adapter = fakeAdapter({ runError: new Error("FluidSynth failed") });

  await assert.rejects(() => buildCalibrationCorpus(options, adapter), /FluidSynth failed/);

  assert.equal(adapter.calls.write.length, 0);
  assert.equal(adapter.calls.rename.length, 0);
  assert.ok(adapter.calls.rm.length >= 1);
  assert.equal([...adapter.created].some((path) => path.endsWith(".tmp.wav")), false);
});

test("constructs quoted command arguments without shell interpolation", async () => {
  const adapter = fakeAdapter();

  await buildCalibrationCorpus(options, adapter);

  const [renderCommand, renderArgs, renderOptions] = adapter.calls.run[0];
  assert.equal(renderCommand, "fluidsynth");
  assert.deepEqual(renderArgs, [
    "-ni", "-g", "0.8", "-r", "44100", "-F",
    "/repo/out/calibration.staging/funk-rb-01.tmp.wav",
    "/repo/soundfont.sf2",
    "/assets/clean_midi/Al Jarreau/Roof Garden.mid",
  ]);
  assert.equal(renderOptions.cwd, "/home/tanisjam/Projects/Personal/lime");
  assert.deepEqual(adapter.calls.run[1][1], [
    "-y", "-i", "/repo/out/calibration.staging/funk-rb-01.tmp.wav",
    "-t", "22", "-ar", "44100", "-ac", "1",
    "/repo/out/calibration.staging/funk-rb-01.wav",
  ]);
});

test("a mid-batch renderer failure removes the staged corpus and every temporary WAV", async () => {
  let rendered = 0;
  const adapter = fakeAdapter({
    onRun({ command, args, created }) {
      if (command === "fluidsynth") {
        rendered += 1;
        if (rendered === 17) throw new Error("mid-batch FluidSynth failure");
        created.add(args[args.indexOf("-F") + 1]);
      } else {
        created.add(args.at(-1));
      }
    },
  });

  await assert.rejects(() => buildCalibrationCorpus(options, adapter), /mid-batch FluidSynth failure/);

  assert.equal(rendered, 17);
  assert.equal(adapter.calls.write.length, 0);
  assert.equal(adapter.calls.rename.length, 0);
  assert.equal([...adapter.created].some((path) => path.endsWith(".tmp.wav")), false);
  assert.equal(adapter.created.has("/repo/out/calibration.staging"), false);
});

test("a transcode failure removes the raw WAV and does not publish a manifest", async () => {
  const adapter = fakeAdapter({
    onRun({ command, args, created }) {
      if (command === "fluidsynth") created.add(args[args.indexOf("-F") + 1]);
      else throw new Error("ffmpeg transcode failure");
    },
  });

  await assert.rejects(() => buildCalibrationCorpus(options, adapter), /ffmpeg transcode failure/);

  assert.equal(adapter.calls.write.length, 0);
  assert.equal(adapter.calls.rename.length, 0);
  assert.equal([...adapter.created].some((path) => path.endsWith(".tmp.wav")), false);
});

test("rejects a trivial rendered WAV before publishing", async () => {
  const adapter = fakeAdapter({ statSize: 44 });

  await assert.rejects(() => buildCalibrationCorpus(options, adapter), /empty or trivial/);

  assert.equal(adapter.calls.write.length, 0);
  assert.equal(adapter.calls.rename.length, 0);
  assert.equal([...adapter.created].some((path) => path.endsWith(".tmp.wav")), false);
});

test("replaces an existing output only after the staged directory is complete", async () => {
  const outputDir = "/repo/out/calibration";
  const adapter = fakeAdapter({
    existing: new Set(["/assets", "/repo/soundfont.sf2", outputDir, ...paths]),
  });

  await buildCalibrationCorpus(options, adapter);

  assert.deepEqual(adapter.calls.rename, [
    [outputDir, `${outputDir}.previous`],
    [`${outputDir}.staging`, outputDir],
  ]);
  assert.equal(adapter.calls.write.length, 1);
});

test("a publish rename failure cleans staging without exposing a partial output", async () => {
  const adapter = fakeAdapter({ renameError: new Error("atomic rename failed") });

  await assert.rejects(() => buildCalibrationCorpus(options, adapter), /atomic rename failed/);

  assert.equal(adapter.calls.write.length, 1);
  assert.equal(adapter.created.has("/repo/out/calibration"), false);
  assert.equal(adapter.created.has("/repo/out/calibration.staging"), false);
  assert.equal([...adapter.created].some((path) => path.endsWith(".tmp.wav")), false);
});

test("parses the documented CLI options and rejects missing assets root", () => {
  assert.deepEqual(parseArgs([
    "--assets-root", "/local/assets",
    "--registry=registry.json",
    "--out", "out/calibration",
    "--seconds=18",
  ]), {
    assetsRoot: "/local/assets",
    registryPath: "registry.json",
    outputDir: "out/calibration",
    seconds: 18,
  });
  assert.throws(() => parseArgs(["--seconds=18"]), /assets-root is required/);
});

test("success renders every MIDI through both commands and publishes a complete manifest", async () => {
  const adapter = fakeAdapter();

  const result = await buildCalibrationCorpus(options, adapter);

  assert.equal(result.manifest.clips.length, 48);
  assert.equal(result.manifest.generatedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(adapter.calls.run.filter(([command]) => command === "fluidsynth").length, 48);
  assert.equal(adapter.calls.run.filter(([command]) => command === "ffmpeg").length, 48);
  assert.equal(adapter.calls.write.length, 1);
  assert.equal(adapter.calls.write[0][0], "/repo/out/calibration.staging/manifest.json");
  assert.deepEqual(adapter.calls.rename, [[
    "/repo/out/calibration.staging",
    "/repo/out/calibration",
  ]]);
  assert.equal(JSON.parse(adapter.calls.write[0][1]).clips.length, 48);
  assert.equal(adapter.calls.run.some(([command, args]) => command === "fluidsynth" && args.includes(".mp3")), false);
});
