#!/usr/bin/env node
/**
 * Smoke-tests the demo in a real browser: enter, then switch across every
 * genre, and fail on any error the page reports.
 *
 * The demo now picks its renderer per genre — FluidSynth for most, the Tone.js
 * sampled palettes for ambient and hip-hop — so crossing that line tears one
 * renderer down and builds another mid-session. Nothing in typecheck or the
 * bundle can tell you whether that survives contact with a live audio context;
 * only loading it can.
 *
 * Headless Chromium has no audio device, but Web Audio still runs, so a
 * construction or scheduling error surfaces exactly as it would for a listener.
 *
 * Usage:
 *   pnpm build && pnpm --filter @lime/demo build
 *   node tools/judge/smoke-demo.mjs
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../../apps/demo/dist");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm",
  ".sf2": "application/octet-stream", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".wav": "audio/wav", ".svg": "image/svg+xml",
};

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = join(DIST, p === "/" ? "/index.html" : p);
      if (!file.startsWith(DIST)) return res.writeHead(403).end();
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  s.listen(0, "127.0.0.1", () => ok(s));
});
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.click("#enter-btn");
// The SoundFont is ~30 MB and loads on first start.
await page.waitForTimeout(6000);

const genres = await page.$$eval("#style-select option", (os) =>
  os.map((o) => ({ value: o.value, label: o.textContent?.trim() })),
);
console.log(`${genres.length} genre(s) in the selector\n`);

for (const g of genres) {
  const before = errors.length;
  await page.selectOption("#style-select", g.value);
  // Sampled genres fetch their instruments on switch; give them room.
  await page.waitForTimeout(4000);
  const fresh = errors.slice(before);
  console.log(`${fresh.length ? "FAIL" : "  ok"}  ${g.label ?? g.value}`);
  for (const e of fresh) console.log(`        ${e}`);
}

// Switching back across the renderer boundary is where a disposed renderer
// would be reused, so exercise it explicitly rather than trusting the sweep.
const roundTrip = ["genre-ambient", "genre-rock-pop", "genre-hiphop", "genre-classical"];
console.log("\nround trip across the renderer boundary:");
for (const value of roundTrip) {
  const before = errors.length;
  await page.selectOption("#style-select", value).catch(() => {});
  await page.waitForTimeout(3000);
  const fresh = errors.slice(before);
  console.log(`${fresh.length ? "FAIL" : "  ok"}  ${value}`);
  for (const e of fresh) console.log(`        ${e}`);
}

// "No errors" is not "makes sound": a renderer whose samples never loaded is
// silent and throws nothing. Check the transport is actually running on a
// sampled genre before believing the sweep above.
await page.selectOption("#style-select", "genre-hiphop").catch(() => {});
await page.waitForTimeout(4000);
// The demo prints the transport's bar and beat. If those advance, the engine
// is scheduling through whichever renderer is live — which is the closest
// observable to "it is playing" without an audio device.
const readClock = () =>
  page.evaluate(() => ({
    bar: document.querySelector("#d-bar")?.textContent?.trim(),
    beat: document.querySelector("#d-beat")?.textContent?.trim(),
  }));

const first = await readClock();
await page.waitForTimeout(4000);
const second = await readClock();
const advanced = JSON.stringify(first) !== JSON.stringify(second);
console.log(`\nsampled genre clock: ${JSON.stringify(first)} -> ${JSON.stringify(second)}`);
console.log(advanced ? "  transport ADVANCING" : "  transport STUCK — renderer is not playing");
if (!advanced) errors.push("transport did not advance on a sampled genre");

await browser.close();
server.close();

console.log(`\n${errors.length} error(s) total`);
process.exit(errors.length ? 1 : 0);
