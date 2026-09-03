import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LimeEngine, analyzeComposition } from "@lime/core";
import {
  loadEmopia, loadVgmidi, loadLakh, loadOpenscore, loadPdmx, type TaggedFile,
} from "../datasets/index.js";
import { buildStylePacks, type BucketResult } from "../build/buildStylePacks.js";
import { planMerge } from "../build/mergeBuckets.js";

/**
 * corpus:build — ingest local datasets, extract statistics, and write
 * emotion/genre-tagged StylePacks to packages/corpus/generated/.
 *
 * Usage:
 *   node dist/cli/build.js [--datasets emopia,vgmidi,lakh,openscore,pdmx]
 *                          [--limit N] [--phrase 4|8] [--merge] [--analyze]
 *                          [--data DIR] [--out DIR]
 *
 * --merge pools emotion-labeled datasets by emotion (happy/tense/sad/calm)
 * across sources; non-emotion datasets stay as their own pools.
 */

const LOADERS: Record<string, (root: string, opts: { limit?: number }) => TaggedFile[]> = {
  emopia: loadEmopia,
  vgmidi: loadVgmidi,
  lakh: loadLakh,
  openscore: loadOpenscore,
  pdmx: loadPdmx,
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function main(): void {
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args = parseArgs(process.argv.slice(2));

  const dataRoot = (args.data as string) ?? join(pkgRoot, "data");
  const outDir = (args.out as string) ?? join(pkgRoot, "generated");
  const limit = args.limit ? Number(args.limit) : 300;
  const phrase = args.phrase === "4" ? 4 : 8;
  const analyze = Boolean(args.analyze);
  const merge = Boolean(args.merge);

  const requested = args.datasets
    ? String(args.datasets).split(",")
    : Object.keys(LOADERS).filter((d) => existsSync(join(dataRoot, d)));

  if (requested.length === 0) {
    console.error(`No datasets found under ${dataRoot}. Run scripts/download-datasets.sh first.`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  console.log(`corpus:build  data=${dataRoot}  out=${outDir}  limit/bucket=${limit}\n`);

  const perDataset: { dataset: string; files: ReturnType<(typeof LOADERS)[string]> }[] = [];
  for (const ds of requested) {
    const loader = LOADERS[ds];
    if (!loader) {
      console.warn(`unknown dataset "${ds}", skipping`);
      continue;
    }
    const files = loader(dataRoot, { limit });
    if (files.length === 0) {
      console.warn(`${ds}: no files found, skipping`);
      continue;
    }
    perDataset.push({ dataset: ds, files });
  }

  const allResults: BucketResult[] = [];
  if (merge) {
    const plan = planMerge(perDataset);
    if (plan.emotion.length > 0) {
      console.log(`emotion (merged across datasets): ${plan.emotion.length} files → building...`);
      allResults.push(...buildStylePacks(plan.emotion, { idPrefix: "emotion", phraseLengthBars: phrase }));
    }
    for (const g of plan.nonEmotion) {
      console.log(`${g.dataset}: ${g.files.length} files → building...`);
      allResults.push(...buildStylePacks(g.files, { idPrefix: g.dataset, phraseLengthBars: phrase }));
    }
  } else {
    for (const { dataset, files } of perDataset) {
      console.log(`${dataset}: ${files.length} tagged files → building...`);
      allResults.push(...buildStylePacks(files, { idPrefix: dataset, phraseLengthBars: phrase }));
    }
  }

  // Write each StylePack and collect an index.
  const index: unknown[] = [];
  console.log("\nid".padEnd(16) + "files samples cad  mode          tempo    " + (analyze ? "quality" : ""));
  console.log("-".repeat(analyze ? 78 : 66));
  for (const r of allResults) {
    const payload = {
      style: r.style,
      suggestedState: r.suggestedState,
      meta: {
        bucket: r.bucket,
        fileCount: r.fileCount,
        parsedCount: r.parsedCount,
        sampleCount: r.sampleCount,
        dominantMode: r.dominantMode,
        keyPc: r.keyPc,
        tempoRange: r.tempoRange,
        emotion: r.emotion,
        cadenceResolutionRate: r.cadenceResolutionRate,
      },
    };
    writeFileSync(join(outDir, `${r.id}.json`), JSON.stringify(payload, null, 2));

    let quality = "";
    if (analyze) {
      const engine = new LimeEngine({ seed: r.id, style: r.style, initialState: r.suggestedState });
      const report = analyzeComposition(engine.captureComposition(64));
      quality = `${(report.overall * 100).toFixed(0)}%`;
    }

    index.push({ id: r.id, file: `${r.id}.json`, bucket: r.bucket, sampleCount: r.sampleCount, emotion: r.emotion });
    console.log(
      r.id.padEnd(16) +
        String(r.parsedCount).padStart(4) + " " +
        String(r.sampleCount).padStart(6) + "  " +
        r.cadenceResolutionRate.toFixed(2) + "  " +
        r.dominantMode.padEnd(13) + " " +
        `${r.tempoRange[0]}-${r.tempoRange[1]}`.padEnd(8) + " " +
        quality,
    );
  }

  writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nWrote ${allResults.length} StylePacks + index.json to ${outDir}`);
}

main();
