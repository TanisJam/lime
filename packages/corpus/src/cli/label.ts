import { writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { labelFile, summarize, QUADS, type LibraryEntry } from "../build/labelLibrary.js";
import { genreForPath } from "../build/genreMap.js";
import { walkMidi, type MidiFile } from "../build/walkMidi.js";

/**
 * CLI: label the local ./midi collection into a classified library manifest.
 *
 *   node dist/cli/label.js [--midi DIR] [--out FILE] [--sample N]
 *                          [--bars N] [--min-notes N] [--max-notes N] [--max-bytes N]
 *
 * --sample N caps files PER GENRE (0 = all) so a quick pass stays balanced and
 * fast. Writes the manifest and prints a genre × quadrant distribution.
 */

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const midiRoot = resolve(args.midi ?? join(PKG_ROOT, "../../midi"));
  const outFile = resolve(args.out ?? join(PKG_ROOT, "generated/library-labels.json"));
  const sample = Number(args.sample ?? 0);
  const opts = {
    barsPerSection: Number(args.bars ?? 8),
    minNotes: Number(args["min-notes"] ?? 12),
    maxNotes: Number(args["max-notes"] ?? 40_000),
  };
  const maxBytes = Number(args["max-bytes"] ?? 2_000_000);

  console.log(`Scanning ${midiRoot} …`);
  const found = walkMidi(midiRoot, maxBytes);

  // Group by genre and, if sampling, cap per genre (evenly spaced for variety).
  const byGenreFiles = new Map<string, MidiFile[]>();
  for (const f of found) {
    const g = genreForPath(f.rel);
    if (g === "exclude") continue;
    (byGenreFiles.get(g) ?? byGenreFiles.set(g, []).get(g)!).push(f);
  }
  const selected: MidiFile[] = [];
  for (const [, files] of byGenreFiles) {
    if (sample > 0 && files.length > sample) {
      const stride = files.length / sample;
      for (let i = 0; i < sample; i++) selected.push(files[Math.floor(i * stride)]!);
    } else {
      selected.push(...files);
    }
  }

  console.log(
    `Found ${found.length} MIDI files; labelling ${selected.length}` +
      (sample > 0 ? ` (sample ${sample}/genre)` : "") + " …",
  );

  const entries: LibraryEntry[] = [];
  let skipped = 0;
  let done = 0;
  for (const f of selected) {
    const entry = labelFile(f.abs, f.rel, opts);
    if (entry) entries.push(entry);
    else skipped++;
    if (++done % 200 === 0) console.log(`  … ${done}/${selected.length}`);
  }

  const summary = summarize(entries);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify({ midiRoot, options: { ...opts, sample }, summary, entries }, null, 2),
  );

  // Report.
  console.log(`\nLabelled ${entries.length} files (${skipped} skipped), ${summary.sectionCount} sections.`);
  console.log(`Manifest → ${relative(process.cwd(), outFile)}\n`);

  const genres = Object.keys(summary.genreQuadrant).sort();
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad("genre", 12)} ${pad("files", 6)} ${QUADS.map((q) => q.padStart(6)).join("")}   sections`);
  for (const g of genres) {
    const row = summary.genreQuadrant[g]!;
    const secs = QUADS.reduce((s, q) => s + row[q], 0);
    console.log(
      `${pad(g, 12)} ${pad(String(summary.byGenre[g] ?? 0), 6)} ` +
        QUADS.map((q) => String(row[q]).padStart(6)).join("") +
        `   ${secs}`,
    );
  }
  console.log(
    `\nQuadrant totals (sections): ` +
      QUADS.map((q) => `${q}=${summary.byQuadrant[q]}`).join("  "),
  );
}

main();
