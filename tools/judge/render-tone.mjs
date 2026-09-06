#!/usr/bin/env node
/**
 * Renders LIME clips through the BROWSER Tone.js path, offline and headless.
 *
 * Why this exists: `render.mjs` renders MIDI through the fluidsynth CLI and a
 * General MIDI SoundFont. GM has no effects chain, so distortion cannot exist
 * in that audio — which is very likely why every metal clip is heard as rock by
 * two independent listeners. The Tone.js renderer does have a real high-gain
 * guitar (waveshaper + Chebyshev + cabinet filter, see rockPalette.ts), so any
 * honest comparison has to render through it.
 *
 * Headless Chromium is not a convenience here, it is the requirement: Tone
 * builds offline contexts on `standardized-audio-context`, which needs a real
 * `window`. Node has none and silently degrades to a dummy context.
 *
 * Output mirrors render.mjs's manifest shape exactly, so judge.py and
 * tools/ear/tag.py consume either set without changes and the two renderers can
 * be scored against each other on identical terms.
 *
 * Usage:
 *   pnpm build && pnpm --filter @lime/demo build
 *   node tools/judge/render-tone.mjs [--genres=a,b] [--seeds=1] [--seconds=22]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const DIST = join(REPO, "apps/demo/dist");
const OUT = join(HERE, "out", "tone");

const arg = (name, dflt) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? dflt;

const NAMES = {
  "genre-classical": "Classical",
  "genre-pop": "Pop",
  "genre-rock-pop": "Rock",
  "genre-hiphop": "Hip-hop",
  "genre-jazz": "Jazz",
  "genre-blues": "Blues",
  "genre-folk": "Folk",
  "genre-latin": "Latin",
  "genre-funk": "Funk/R&B",
  "genre-metal": "Metal",
  "genre-electronic": "Electronic",
  "genre-ambient": "Ambient",
};

const genres = (arg("genres") ?? Object.keys(NAMES).join(",")).split(",").filter(Boolean);
const seeds = (arg("seeds", "1")).split(",").map(Number);
const seconds = Number(arg("seconds", "22"));

/** Minimal static server for the built demo — vite preview would also do, but
 *  this keeps the script to one process and one port we control. */
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".sf2": "application/octet-stream", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".wav": "audio/wav", ".svg": "image/svg+xml",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = join(root, path === "/" ? "/index.html" : path);
      if (!file.startsWith(root)) return res.writeHead(403).end();
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

function ensureBuilt() {
  try {
    execFileSync("node", ["-e", `require("fs").statSync(${JSON.stringify(join(DIST, "render.html"))})`], {
      stdio: "ignore",
    });
  } catch {
    console.error(
      `Missing ${join(DIST, "render.html")}.\nBuild first:\n  pnpm build && pnpm --filter @lime/demo build`,
    );
    process.exit(1);
  }
}

ensureBuilt();
mkdirSync(OUT, { recursive: true });

const server = await serve(DIST);
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();

// A silent failure is the exact hazard here: an offline render that produced
// nothing still returns a buffer full of zeros. Surface everything the page says.
page.on("pageerror", (e) => console.error(`  page error: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.error(`  console: ${m.text()}`);
});

await page.goto(`http://127.0.0.1:${port}/render.html`);
await page.waitForFunction(() => typeof window.limeRenderClip === "function", null, { timeout: 30_000 });

const clips = [];
for (const genre of genres) {
  for (const seed of seeds) {
    const base = `${genre}_seed${seed}`;
    try {
      const result = await page.evaluate(
        (opts) => window.limeRenderClip(opts),
        { genre, seed, seconds },
      );
      const wav = Buffer.from(result.wav);
      writeFileSync(join(OUT, `${base}.wav`), wav);

      // Peak check: a render that scheduled nothing is digital silence, and it
      // would otherwise sail through the judge as a valid but meaningless clip.
      const peak = peakOf(wav);
      const dropped = result.dropped?.count ?? 0;
      const flags = [
        peak < 1e-4 ? "** SILENT **" : "",
        dropped ? `** ${dropped} notes dropped **` : "",
      ].filter(Boolean).join(" ");
      console.log(
        `rendered ${base}.wav  (peak ${peak.toFixed(3)}) ${flags}`.trimEnd(),
      );
      if (dropped) console.log(`    first drop: ${result.dropped.firstReason}`);

      clips.push({
        file: `${base}.wav`,
        genre,
        genreName: NAMES[genre] ?? genre,
        truth: NAMES[genre] ?? genre,
        seed,
        seconds,
        renderer: "tone",
        peak,
        droppedNotes: result.dropped?.count ?? 0,
      });
    } catch (err) {
      console.error(`FAILED ${base}: ${err.message}`);
    }
  }
}

await browser.close();
server.close();

if (!clips.length) {
  console.error("Nothing rendered.");
  process.exit(1);
}

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify(
    {
      sampleRate: 44100,
      generatedAt: new Date().toISOString(),
      renderer: "tone",
      task: "genre",
      candidates: [...new Set(clips.map((c) => c.truth))].sort(),
      clips,
    },
    null,
    2,
  ),
);

const silent = clips.filter((c) => c.peak < 1e-4).length;
console.log(`\n${clips.length} clip(s) → ${join(OUT, "manifest.json")}`);
if (silent) console.error(`WARNING: ${silent} clip(s) are silent — the render did not work.`);

/** Peak absolute sample of a 16-bit PCM WAV, ignoring the 44-byte header. */
function peakOf(buf) {
  let peak = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) {
    const v = Math.abs(buf.readInt16LE(i)) / 32768;
    if (v > peak) peak = v;
  }
  return peak;
}
