import { writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkMidi } from "../build/walkMidi.js";
import { buildLibraryPacks, type LibraryPackResult } from "../build/buildLibraryPacks.js";
import type { Genre } from "../build/genreMap.js";

/**
 * CLI: build section-aware StylePacks (by emotion and by genre) from ./midi.
 *
 *   node dist/cli/build-library.js [--midi DIR] [--out DIR]
 *        [--max-sections N] [--min-samples N] [--genres a,b] [--bars 4|8]
 *        [--no-emotion] [--no-genre]
 *
 * Writes one <id>.json per bucket (feel-happy/…, genre-classical/…) that the
 * demo picks up via its generated/*.json glob.
 */

const PKG_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const midiRoot = resolve(args.midi ?? join(PKG_ROOT, "../../midi"));
  const outDir = resolve(args.out ?? join(PKG_ROOT, "generated"));

  console.log(`Scanning ${midiRoot} …`);
  const files = walkMidi(midiRoot);
  console.log(`Found ${files.length} MIDI files; building packs …`);

  const results = buildLibraryPacks(files, {
    minSamples: Number(args["min-samples"] ?? 30),
    maxSectionsPerBucket: Number(args["max-sections"] ?? 4000),
    phraseLengthBars: args.bars === "4" ? 4 : 8,
    genres: args.genres ? (args.genres.split(",") as Genre[]) : undefined,
    buildEmotion: args["no-emotion"] !== "true",
    buildGenre: args["no-genre"] !== "true",
    onProgress: (d, t) => {
      if (d % 500 === 0 || d === t) console.log(`  … ${d}/${t}`);
    },
  });

  mkdirSync(outDir, { recursive: true });
  for (const r of results) {
    const file = join(outDir, `${r.id}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          style: r.style,
          suggestedState: r.suggestedState,
          meta: {
            bucket: r.bucket,
            kind: r.kind,
            sectionCount: r.sectionCount,
            sampleCount: r.sampleCount,
            dominantMode: r.dominantMode,
            keyPc: r.keyPc,
            tempoRange: r.tempoRange,
            emotion: r.emotion,
            cadenceResolutionRate: r.cadenceResolutionRate,
          },
        },
        null,
        2,
      ),
    );
  }

  console.log(`\nWrote ${results.length} packs to ${relative(process.cwd(), outDir)}\n`);
  report(results);
}

function report(results: LibraryPackResult[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    `${pad("pack", 18)} ${pad("kind", 9)} ${pad("secs", 7)} ${pad("mode", 12)} ` +
      `${pad("tempo", 9)} val/aro`,
  );
  for (const r of results) {
    console.log(
      `${pad(r.id, 18)} ${pad(r.kind, 9)} ${pad(String(r.sectionCount), 7)} ` +
        `${pad(r.dominantMode, 12)} ${pad(`${r.tempoRange[0]}-${r.tempoRange[1]}`, 9)} ` +
        `${r.emotion.valence.toFixed(2)}/${r.emotion.arousal.toFixed(2)}`,
    );
  }
}

main();
