import { createRequire } from "node:module";
import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Set up the FluidSynth-WASM playback assets for the demo (they are gitignored,
 * being large and regenerable):
 *   - copy js-synthesizer's libfluidsynth + worklet from node_modules → public/js-synth
 *   - download the GeneralUser GS SoundFont → public/soundfonts
 * Run after `pnpm install`:  node apps/demo/scripts/setup-fluidsynth.mjs
 */

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "../public");

// Resolve the installed js-synthesizer package directory.
const pkgJson = require.resolve("js-synthesizer/package.json");
const pkgDir = dirname(pkgJson);

const jsSynthOut = join(PUBLIC, "js-synth");
mkdirSync(jsSynthOut, { recursive: true });

// Newest libfluidsynth-*.js WITHOUT libsndfile (we load .sf2, not .sf3).
const externals = readdirSync(join(pkgDir, "externals"))
  .filter((f) => /^libfluidsynth-[\d.]+\.js$/.test(f))
  .sort();
const libfluid = externals[externals.length - 1];
if (!libfluid) throw new Error("libfluidsynth-*.js not found in js-synthesizer/externals");
copyFileSync(join(pkgDir, "externals", libfluid), join(jsSynthOut, libfluid));
copyFileSync(join(pkgDir, "dist", "js-synthesizer.worklet.js"), join(jsSynthOut, "js-synthesizer.worklet.js"));
console.log(`js-synth: ${libfluid} + js-synthesizer.worklet.js`);
console.log(`NOTE: fluidRenderer.ts references "${libfluid}" — update the path if the version differs.`);

// Download the SoundFont.
const sfOut = join(PUBLIC, "soundfonts");
mkdirSync(sfOut, { recursive: true });
const sfPath = join(sfOut, "GeneralUser-GS.sf2");
if (existsSync(sfPath)) {
  console.log("SoundFont already present.");
} else {
  const url = "https://github.com/mrbumpy409/GeneralUser-GS/raw/main/GeneralUser-GS.sf2";
  console.log("Downloading GeneralUser-GS.sf2 (~31 MB) …");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`SoundFont download failed: ${r.status}`);
  writeFileSync(sfPath, Buffer.from(await r.arrayBuffer()));
  console.log("SoundFont saved.");
}
