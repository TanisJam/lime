import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Download the CC-BY sample set into apps/demo/public/samples so the demo can
 * host real instruments locally (consistent quality, offline). Run from anywhere:
 *   node apps/demo/scripts/download-samples.mjs
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../public/samples");

// nbrosowsky/tonejs-instruments: instrument → cap (null = all files).
const TI = {
  "guitar-electric": null,
  "bass-electric": null,
  "guitar-acoustic": 12,
  "guitar-nylon": 8,
  organ: 8,
  saxophone: 8,
  trumpet: 6,
  contrabass: null,
  cello: 8,
  violin: 8,
  flute: 6,
};

async function dl(url, dst) {
  if (existsSync(dst)) return 0;
  const r = await fetch(url);
  if (!r.ok) { console.log("SKIP", r.status, url); return 0; }
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dst, buf);
  return buf.length;
}

let total = 0, count = 0;
for (const [inst, cap] of Object.entries(TI)) {
  const r = await fetch(`https://api.github.com/repos/nbrosowsky/tonejs-instruments/contents/samples/${inst}`);
  const j = await r.json();
  if (!Array.isArray(j)) { console.log("ERR list", inst, j.message); continue; }
  let files = j.filter((f) => f.name.endsWith(".mp3"));
  if (cap && files.length > cap) {
    const stride = files.length / cap;
    files = Array.from({ length: cap }, (_, i) => files[Math.floor(i * stride)]);
  }
  mkdirSync(join(OUT, inst), { recursive: true });
  for (const f of files) {
    const n = await dl(f.download_url, join(OUT, inst, f.name));
    if (n) { total += n; count++; }
  }
  console.log("done", inst, files.length, "files");
}

mkdirSync(join(OUT, "drums"), { recursive: true });
for (const f of ["kick", "snare", "hihat", "tom1", "tom2", "tom3"]) {
  const n = await dl(`https://tonejs.github.io/audio/drum-samples/acoustic-kit/${f}.mp3`, join(OUT, "drums", `${f}.mp3`));
  if (n) { total += n; count++; }
}
mkdirSync(join(OUT, "piano"), { recursive: true });
for (const f of ["A1", "C2", "Ds2", "Fs2", "A2", "C3", "Ds3", "Fs3", "A3", "C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5", "A5", "C6"]) {
  const n = await dl(`https://tonejs.github.io/audio/salamander/${f}.mp3`, join(OUT, "piano", `${f}.mp3`));
  if (n) { total += n; count++; }
}

console.log(`\nTOTAL: ${count} files, ${(total / 1e6).toFixed(1)} MB`);
