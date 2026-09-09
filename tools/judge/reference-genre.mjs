#!/usr/bin/env node
/**
 * Retained non-authoritative genre heuristic experiment for the judge, built
 * from a general MIDI collection. Its filename/artist-derived labels cannot
 * establish calibration trust; use the reviewed calibration registry instead.
 *
 * The emotion control (reference.mjs, EMOPIA) used solo piano — the poorest
 * possible material for genre, since every clip has the same timbre and no
 * drums. This one uses full multi-instrument arrangements instead, so timbre,
 * groove and instrumentation are all available as cues.
 *
 * It is deliberately the EASY version of the task: orchestral classical vs
 * drum-and-electric-guitar rock vs country. A model that cannot separate those
 * three cannot gate anything.
 *
 * Ground truth comes from the artist in the filename. That is a heuristic, so
 * the patterns are anchored and a deny list removes the known collisions —
 * "Queen" matched both Queensrÿche (metal) and "Cleopatra, Queen Of Denial" by
 * Pam Tillis (country) before they were excluded. A contaminated label set
 * would invalidate the measurement more quietly than a broken renderer.
 *
 * Usage:
 *   node tools/judge/reference-genre.mjs [--per-genre=16] [--seconds=22]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const SF2 = join(REPO, "apps/demo/public/soundfonts/GeneralUser-GS.sf2");
const OUT = join(HERE, "out", "reference-genre");

const MIDI_DIR =
  process.env.MIDI_DIR ??
  "/media/tanisjam/5f0fc2f4-f1ba-4a2c-b98b-ca0eed561390/tanisjam/projects/personal/lime/midi";

const perGenre = Number(process.argv.find((a) => a.startsWith("--per-genre="))?.split("=")[1] ?? 16);
const seconds = Number(process.argv.find((a) => a.startsWith("--seconds="))?.split("=")[1] ?? 22);

/** Artists whose genre is unambiguous. Anchored to avoid substring collisions. */
const GENRES = {
  "classical (orchestral or solo instrumental art music)": [
    /\bbach\b/i, /\bmozart\b/i, /\bbeethoven\b/i, /\bchopin\b/i, /\bvivaldi\b/i,
    /\bschumann\b/i, /\bschubert\b/i, /\bhandel\b/i, /\bhaydn\b/i, /\bbrahms\b/i,
    /\btchaikovsky\b/i, /\bdebussy\b/i, /\bliszt\b/i,
  ],
  "rock or pop (drum kit, bass, electric guitar or synth)": [
    /\bbeatles\b/i, /dire.straits/i, /\bstyx\b/i, /moody.blues/i, /rolling.stones/i,
    /led.zeppelin/i, /pink.floyd/i, /\babba\b/i, /elton.john/i, /david.bowie/i,
    /\bpolice\b/i, /fleetwood/i, /bee.gees/i, /\beagles\b/i,
    // "Queen" only when it reads as the credited artist, never mid-title.
    /(^|[-_ ])queen[ _.-]*(ga ga|greatest|live)?\.(mid|midi)$/i, /-\s*queen\b/i,
  ],
  "country (acoustic or steel guitar, shuffle or two-step feel)": [
    /garth.brooks/i, /johnny.cash/i, /willie.nelson/i, /dolly.parton/i,
    /tracy.byrd/i, /george.strait/i, /alan.jackson/i, /\breba\b/i, /pam.tillis/i,
    // Country despite the title naming a rock band — verified, it was a No.1
    // on Billboard's Hot Country chart in 1995.
    /joe.diffie/i,
  ],
  "jazz (swing or bossa feel, walking bass, seventh chords)": [
    /standard.jazz/i, /frank.sinatra/i, /take.five/i, /\bmisty\b/i, /lonely.jazz/i,
    /glenn.miller/i, /benny.goodman/i, /duke.ellington/i, /louis.armstrong/i,
    /brubeck/i,
  ],
  "latin (clave or tumbao rhythm, congas, nylon guitar or brass)": [
    /jobim/i, /gloria.estefan/i, /santana/i, /standard.salsa/i, /^salsa\./i,
    /^bossa\./i, /^latin(_|x|dnc|\.)/i, /\btango\b/i, /guantanamera/i,
    /besame/i, /^conga\./i, /carneval/i, /\bsamba\b/i,
  ],
  "electronic (synthesizers and drum machine, no acoustic band)": [
    /jarre/i, /equinoxe/i, /oxygene/i, /rendez.vou/i, /axel.f/i, /popcorn/i,
    /kraftwerk/i, /autobahn/i, /depeche/i, /vangelis/i,
  ],
  "Funk/R&B": [
    /kool.*gang/i, /^celebration/i, /earth.wind/i, /superstition/i,
    /play.that.funky/i, /wild.cherry/i, /\bprince\b/i, /rick.james/i,
    /isley/i, /ohio.players/i, /average.white/i,
  ],
  "Pop": [
    /michael.jackson/i, /madonna/i, /whitney/i, /cyndi.lauper/i, /\bwham\b/i,
    /george.michael/i, /phil.collins/i, /lionel.richie/i, /tina.turner/i,
  ],
  "metal or hard rock (distorted electric guitar, aggressive drums)": [
    /sabbath/i, /paranoid/i, /iron_man/i, /smoke.on.the.water/i, /\bacdc\b/i,
    /ac.dc/i, /soundgarden/i, /metallica/i, /queensryche/i, /deep.purple/i,
    /motorhead/i, /judas.priest/i,
  ],
};

/**
 * Known mislabels the patterns above would otherwise pull in. Every one of
 * these was found by reading the selected filenames, not by the renderer
 * failing — a contaminated label is silent.
 */
const DENY = [
  /polovtsian|prince.igor/i,  // Borodin, matched on "Prince"
  /2princes/i,                // Spin Doctors, rock
  /disco.samba/i,             // already in the latin bucket

  /queens.of.the/i,
  /insect.queen/i,            // matched on "Queen"; not an identifiable track
  /bigger.than.the.beatles/i, // Joe Diffie (country), matched on "Beatles"
  /^the.slayer\./i,           // matched on "Slayer"; not a verifiable track
  /sultans.of.swing/i,        // Dire Straits, would match a jazz "swing" pattern
  /planet.caravan/i,          // Black Sabbath, would match the jazz "Caravan"
  /tequila.sunrise/i,         // the Eagles, not the Latin "Tequila"
];

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if ([".mid", ".midi"].includes(extname(entry.name).toLowerCase())) found.push(full);
  }
  return found;
}

if (!existsSync(MIDI_DIR)) {
  console.error(`MIDI_DIR not found: ${MIDI_DIR}`);
  process.exit(1);
}
if (!existsSync(SF2)) {
  console.error(`SoundFont missing: ${SF2}\nRun: node apps/demo/scripts/setup-fluidsynth.mjs`);
  process.exit(1);
}

const all = walk(MIDI_DIR);
console.log(`Scanned ${all.length} MIDI file(s)`);

/** A file counts only if exactly ONE genre claims it — no ambiguous overlaps. */
function classify(path) {
  const name = path.split("/").pop();
  if (DENY.some((d) => d.test(name))) return null;
  const hits = Object.entries(GENRES).filter(([, pats]) => pats.some((p) => p.test(name)));
  return hits.length === 1 ? hits[0][0] : null;
}

const buckets = new Map(Object.keys(GENRES).map((g) => [g, []]));
for (const path of all) {
  const g = classify(path);
  if (g) buckets.get(g).push(path);
}

for (const [g, list] of buckets) {
  list.sort();
  console.log(`  ${list.length.toString().padStart(4)} candidates — ${g.split(" (")[0]}`);
}

const smallest = Math.min(...[...buckets.values()].map((l) => l.length));
const take = Math.min(perGenre, smallest);
if (take < perGenre) {
  console.log(`\nBalancing down to ${take} per genre (smallest bucket decides).`);
}
if (take === 0) {
  console.error("A genre has no candidates; cannot build a balanced set.");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const clips = [];
const counts = new Map(Object.keys(GENRES).map((g) => [g, 0]));

for (const [genre, list] of buckets) {
  // Even stride over the sorted list: deterministic, and avoids taking a block
  // of tracks by the same artist that happen to sort together.
  const stride = Math.max(1, Math.floor(list.length / take));
  const picked = Array.from({ length: take }, (_, i) => list[i * stride]).filter(Boolean);

  for (const mid of picked) {
    const base = mid.split("/").pop().replace(/\.(mid|midi)$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_");
    const raw = join(OUT, `${base}.raw.wav`);
    const wav = join(OUT, `${base}.wav`);
    try {
      execFileSync("fluidsynth", ["-ni", "-g", "0.8", "-r", "44100", "-F", raw, SF2, mid], {
        stdio: "ignore",
      });
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-t", String(seconds), wav]);
      rmSync(raw, { force: true });
      if (statSync(wav).size < 1000) throw new Error("empty render");
      clips.push({ file: `${base}.wav`, truth: genre, source: "midi-collection", seconds });
      counts.set(genre, counts.get(genre) + 1);
    } catch {
      rmSync(raw, { force: true });
      rmSync(wav, { force: true });
      console.log(`  skipped (render failed): ${base}`);
    }
  }
}

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
      reference: true,
      task: "genre",
      candidates: Object.keys(GENRES),
      clips,
    },
    null,
    2,
  ),
);

console.log("\nRendered per genre:");
for (const [g, n] of counts) console.log(`  ${n}  ${g.split(" (")[0]}`);
console.log(`\n${clips.length} clip(s) → ${join(OUT, "manifest.json")}`);
