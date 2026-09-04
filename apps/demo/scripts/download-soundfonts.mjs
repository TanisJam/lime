import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Download the General-MIDI soundfont instruments we use (MusyngKite, MIT-ish,
 * free) into apps/demo/public/samples/sf. These are real recorded GM patches —
 * including proper distortion/overdriven guitars and a Rhodes electric piano —
 * far better than distorting a clean sample. Filenames use flats (Db, Eb, …).
 *   node apps/demo/scripts/download-soundfonts.mjs
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../public/samples/sf");
const SF = "https://gleitz.github.io/midi-js-soundfonts/MusyngKite";

const INSTRUMENTS = [
  "overdriven_guitar", "distortion_guitar", "electric_guitar_clean",
  "electric_guitar_jazz", "electric_guitar_muted", "electric_piano_1",
  "rock_organ", "drawbar_organ", "acoustic_grand_piano", "electric_bass_finger",
  "acoustic_bass", "tenor_sax", "trumpet", "acoustic_guitar_nylon",
  "acoustic_guitar_steel", "string_ensemble_1", "cello", "violin", "flute",
  "lead_2_sawtooth", "pad_2_warm", "synth_bass_1",
];
// A curated subset across the range (every ~3 semitones); 404s are skipped.
const NOTES = ["C1", "Eb1", "Gb1", "A1", "C2", "Eb2", "Gb2", "A2", "C3", "Eb3", "Gb3", "A3", "C4", "Eb4", "Gb4", "A4", "C5", "Eb5", "Gb5", "A5", "C6", "Eb6", "A6"];

async function dl(url, dst) {
  if (existsSync(dst)) return 0;
  const r = await fetch(url);
  if (!r.ok) return 0;
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dst, buf);
  return buf.length;
}

let total = 0, count = 0;
for (const inst of INSTRUMENTS) {
  mkdirSync(join(OUT, inst), { recursive: true });
  let got = 0;
  for (const note of NOTES) {
    const n = await dl(`${SF}/${inst}-mp3/${note}.mp3`, join(OUT, inst, `${note}.mp3`));
    if (n) { total += n; count++; got++; }
  }
  console.log(`${inst}: ${got} notes`);
}

// Acoustic drum kit (Tone.js drum-samples, CC-BY).
const DRUMS = join(OUT, "../drums");
mkdirSync(DRUMS, { recursive: true });
for (const f of ["kick", "snare", "hihat", "tom1", "tom2", "tom3"]) {
  const n = await dl(`https://tonejs.github.io/audio/drum-samples/acoustic-kit/${f}.mp3`, join(DRUMS, `${f}.mp3`));
  if (n) { total += n; count++; }
}

console.log(`\nTOTAL: ${count} files, ${(total / 1e6).toFixed(1)} MB`);
