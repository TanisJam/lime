#!/usr/bin/env node
/**
 * Scores judge and ear reports, with class-level gates for calibration corpora.
 *
 * Prose-only reports retain the legacy top-1, chance, and exact-binomial output.
 * Reports with numeric scores receive deterministic per-class rank and confusion
 * metrics, so a passing aggregate cannot hide a class that is unfit for tuning.
 *
 * Usage:
 *   node tools/judge/matrix.mjs [--json] [tools/judge/out/report-fused.json]
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CALIBRATION_SCHEMA_VERSION,
  rankScores,
  summarizeCalibration,
} from "./calibration-corpus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORT_PATH = join(HERE, "out", "report-blind.json");

function truthOf(result) {
  return result.truth ?? result.genreName ?? result.genre;
}

function matrixError(message) {
  return new Error(`Invalid matrix report: ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pull the model's committed answer off a BEST GENRE/MATCH line. The model does
 * not always keep the exact numbering, so fall back to the first candidate name
 * mentioned in the report.
 */
export function parseBest(verdict, candidates) {
  const lines = String(verdict ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const labelled = lines.find((line) => /best\s*(genre|match)/i.test(line));
  const scan = labelled ? [labelled] : lines;

  for (const line of scan) {
    const hit = [...candidates]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => line.toLowerCase().includes(candidate.toLowerCase()));
    if (hit) return hit;

    const head = [...candidates]
      .map((candidate) => [candidate, candidate.split(/[\s(]/)[0]])
      .sort((left, right) => right[1].length - left[1].length)
      .find(([, word]) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(line));
    if (head) return head[0];
  }
  return null;
}

/** The exact upper tail P(X >= k) for a binomial(n, p). */
export function binomialTail(k, n, probability) {
  if (k <= 0 || k >= n) return 1;
  const logFactorial = (value) => {
    let result = 0;
    for (let index = 2; index <= value; index += 1) result += Math.log(index);
    return result;
  };
  let below = 0;
  for (let successes = 0; successes < k; successes += 1) {
    const logProbability =
      logFactorial(n) -
      logFactorial(successes) -
      logFactorial(n - successes) +
      successes * Math.log(probability) +
      (n - successes) * Math.log(1 - probability);
    below += Math.exp(logProbability);
  }
  return Math.max(0, Math.min(1, 1 - below));
}

function readManifest(reportPath) {
  const manifestPath = join(dirname(reportPath), "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw matrixError(`cannot read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sharedCandidates(results, manifest) {
  const scored = results.some((result) => result && Object.hasOwn(result, "scores"));
  if (!scored) return null;
  const firstScores = results.find((result) => result && Object.hasOwn(result, "scores"))?.scores;

  if (!Array.isArray(results) || results.some((result) => !result || !Object.hasOwn(result, "scores"))) {
    throw matrixError("scored reports must provide scores for every row");
  }
  if (!firstScores || typeof firstScores !== "object" || Array.isArray(firstScores)) {
    throw matrixError("scores must be an object for every row");
  }

  const scoreKeys = Object.keys(firstScores);
  const declared = manifest?.candidates;
  if (declared !== undefined && !Array.isArray(declared)) {
    throw matrixError("manifest candidates must be an array");
  }
  const candidates = declared ? [...declared] : [...scoreKeys].sort();
  if (candidates.length === 0 || new Set(candidates).size !== candidates.length) {
    throw matrixError("candidate set must be non-empty and unique");
  }
  const expected = new Set(candidates);
  for (const [index, result] of results.entries()) {
    const keys = Object.keys(result.scores ?? {});
    const missing = candidates.filter((candidate) => !Object.hasOwn(result.scores ?? {}, candidate));
    const extra = keys.filter((candidate) => !expected.has(candidate));
    if (missing.length > 0 || extra.length > 0) {
      throw matrixError(
        `row ${index + 1} has an inconsistent candidate set (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
      );
    }
  }
  if (declared && (scoreKeys.length !== candidates.length || scoreKeys.some((candidate) => !expected.has(candidate)))) {
    throw matrixError("score keys do not match manifest candidates");
  }
  return candidates;
}

function scoreReport(results, manifest) {
  const candidates = sharedCandidates(results, manifest);
  if (!candidates) return null;
  const summary = summarizeCalibration(
    results.map((result) => ({ truth: truthOf(result), scores: result.scores })),
    candidates,
  );
  return { candidates, summary };
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function percent(value) {
  return `${(value * 100).toFixed(0)}%`;
}

function corpusMetadata(manifest) {
  if (!manifest) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    corpusId: manifest.corpusId,
    reference: manifest.reference,
    task: manifest.task,
    calibration: manifest.calibration,
    sampleRate: manifest.sampleRate,
  };
}

function jsonSummary(reportPath, manifest, scored) {
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    reportPath,
    corpus: corpusMetadata(manifest),
    candidates: scored.candidates,
    overall: scored.summary.overall,
    classes: scored.summary.classes,
  };
}

function printCalibrationTable(reportPath, scored) {
  const { candidates, summary } = scored;
  const classWidth = Math.max("class".length, ...candidates.map((candidate) => candidate.length)) + 2;
  const confusionWidth = Math.max(
    "primary confusion".length,
    ...summary.classes.map(({ primaryConfusions }) => (primaryConfusions.join(", ") || "—").length),
  ) + 2;
  console.log(`CALIBRATION TRUST GATES (${basename(reportPath)}; ${summary.overall.total} clips; ${candidates.length} candidates)\n`);
  console.log(
    `${pad("class", classWidth)}${pad("n", 4)}${pad("top-1", 12)}${pad("top-2", 12)}${pad("mean rank", 12)}${pad("primary confusion", confusionWidth)}tuning gate`,
  );
  for (const result of summary.classes) {
    const gate = result.trustedForTuning
      ? "TRUSTED FOR TUNING"
      : `UNTRUSTED FOR TUNING (${result.failedGates.join(", ")})`;
    const confusion = result.primaryConfusions.join(", ") || "—";
    const meanRank = result.meanTrueLabelRank === null ? "—" : result.meanTrueLabelRank.toFixed(2);
    console.log(
      `${pad(result.candidate, classWidth)}${pad(result.count, 4)}${pad(`${result.top1.correct}/${result.count} ${percent(result.top1.accuracy)}`, 12)}${pad(`${result.top2.withinTwo}/${result.count} ${percent(result.top2.accuracy)}`, 12)}${pad(meanRank, 12)}${pad(confusion, confusionWidth)}${gate}`,
    );
  }
  console.log("");
}

function renderLegacyAndOverall(results, candidates, scored) {
  const rows = results.map((result, index) => {
    const truth = truthOf(result);
    if (scored) {
      const ranked = rankScores(result.scores, candidates);
      const heard = ranked[0].candidate;
      return { truth, heard, correct: heard === truth, rank: ranked.find(({ candidate }) => candidate === truth)?.rank };
    }
    const heard = parseBest(result.verdict ?? "", candidates);
    return { truth, heard, correct: heard === truth };
  });
  const parsed = rows.filter((row) => row.heard !== null);
  const overall = scored?.summary.overall ?? (() => {
    const correct = rows.filter((row) => row.correct).length;
    const chance = 1 / candidates.length;
    return {
      correct,
      total: rows.length,
      accuracy: correct / rows.length,
      chance,
      pValue: binomialTail(correct, rows.length, chance),
    };
  })();

  const labels = rows.map((row) => String(row.truth ?? "(unknown)"));
  const width = Math.max(...labels.map((label) => label.length), 8) + 2;
  console.log("BLIND GENRE IDENTIFICATION\n");
  console.log(`${pad("intended", width)}${pad("heard", width)}ok`);
  console.log("-".repeat(width * 2 + 3));
  for (const row of rows) {
    console.log(`${pad(row.truth ?? "(unknown)", width)}${pad(row.heard ?? "(unparsed)", width)}${row.correct ? "OK" : ""}`);
  }

  console.log(`\nparsed     : ${parsed.length}/${rows.length}`);
  console.log(`correct    : ${overall.correct}/${overall.total}`);
  console.log(`accuracy   : ${percent(overall.accuracy)}`);
  console.log(`chance     : ${percent(overall.chance)}  (${candidates.length} candidates)`);

  if (scored && candidates.length > 2) {
    console.log(`top-2      : ${overall.top2}/${overall.total}  (chance ${percent(2 / candidates.length)})`);
    console.log(`top-3      : ${overall.top3}/${overall.total}  (chance ${percent(3 / candidates.length)})`);
    console.log(`mean rank  : ${overall.meanTrueLabelRank.toFixed(2)} of ${candidates.length}  (chance ${((candidates.length + 1) / 2).toFixed(2)})`);
  }
  console.log(`p-value    : ${overall.pValue.toFixed(3)}  P(this many correct by pure guessing)`);

  const aggregateVerdict =
    overall.pValue > 0.05
      ? "INDISTINGUISHABLE FROM GUESSING — do not use these scores as a gate."
      : overall.accuracy < 0.5
        ? "ABOVE CHANCE but weak — not trustworthy on its own."
        : "DISCRIMINATES — usable as a signal.";
  if (scored && scored.summary.classes.some(({ trustedForTuning }) => !trustedForTuning)) {
    console.log(`verdict    : ${aggregateVerdict} Class gates remain authoritative; failed classes are not usable for tuning.`);
  } else {
    console.log(`verdict    : ${aggregateVerdict}`);
  }
}

export function parseArgs(argv) {
  const json = argv.includes("--json");
  const paths = argv.filter((argument) => argument !== "--json" && argument !== "--help" && argument !== "-h");
  if (argv.includes("--help") || argv.includes("-h")) return { help: true, json };
  if (paths.length > 1) throw matrixError("only one report path may be supplied");
  return { json, reportPath: resolve(paths[0] ?? DEFAULT_REPORT_PATH) };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: node tools/judge/matrix.mjs [--json] [report.json]");
    return 0;
  }

  let results;
  try {
    results = JSON.parse(readFileSync(options.reportPath, "utf8"));
  } catch {
    console.error(
      `Cannot read ${options.reportPath}. Run the blind judge first:\n` +
        "  /data/ai/judge/venv/bin/python tools/judge/judge.py tools/judge/out/manifest.json --blind",
    );
    return 1;
  }
  if (!Array.isArray(results) || results.length === 0) {
    console.error("Invalid matrix report: report must be a non-empty array");
    return 1;
  }

  try {
    const manifest = readManifest(options.reportPath);
    const scored = scoreReport(results, manifest);
    if (options.json) {
      if (!scored) throw matrixError("--json requires numeric scores for every report row");
      console.log(JSON.stringify(jsonSummary(options.reportPath, manifest, scored), null, 2));
      return 0;
    }
    if (scored) printCalibrationTable(options.reportPath, scored);
    const candidates = scored?.candidates ?? [...new Set(results.map(truthOf).filter((truth) => truth !== undefined))].sort();
    if (candidates.length === 0) throw matrixError("report does not declare or contain any candidates");
    renderLegacyAndOverall(results, candidates, scored);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
