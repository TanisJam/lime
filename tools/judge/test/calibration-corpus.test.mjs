import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CalibrationAssetError,
  CalibrationScoringError,
  CalibrationValidationError,
  planCorpus,
  rankScores,
  resolveAssets,
  summarizeCalibration,
  validateRegistry,
} from "../calibration-corpus.mjs";

const registry = JSON.parse(
  readFileSync(new URL("../calibration-registry.json", import.meta.url), "utf8"),
);
const candidates = ["Funk/R&B", "Jazz", "Blues", "Rock", "Pop", "Electronic"];

function clone(value) {
  return structuredClone(value);
}

function errorCodes(error) {
  return error.diagnostics.map((diagnostic) => diagnostic.code);
}

function invalidRegistry(mutator) {
  const value = clone(registry);
  mutator(value);
  return value;
}

test("validates the exact reviewed 48-item registry", () => {
  const normalized = validateRegistry(registry);

  assert.deepEqual(normalized.candidates, candidates);
  assert.equal(normalized.items.length, 48);
  assert.deepEqual(
    Object.fromEntries(candidates.map((candidate) => [candidate, normalized.items.filter((item) => item.label === candidate).length])),
    Object.fromEntries(candidates.map((candidate) => [candidate, 8])),
  );
  assert.equal(normalized.items[0].localPath, registry.items[0].localPath);
});

test("rejects candidate content or order drift", () => {
  const changed = invalidRegistry((value) => {
    value.candidates = ["Jazz", "Funk/R&B", "Blues", "Rock", "Pop", "Electronic"];
  });

  assert.throws(
    () => validateRegistry(changed),
    (error) => error instanceof CalibrationValidationError && errorCodes(error).includes("candidate-set"),
  );
});

test("rejects a duplicate candidate even when the total length is unchanged", () => {
  const changed = invalidRegistry((value) => {
    value.candidates[5] = "Funk/R&B";
  });

  assert.throws(
    () => validateRegistry(changed),
    (error) => error instanceof CalibrationValidationError && errorCodes(error).includes("candidate-set"),
  );
});

test("rejects registries with 47 or 49 items", () => {
  for (const count of [47, 49]) {
    const changed = invalidRegistry((value) => {
      value.items = count === 47 ? value.items.slice(0, -1) : [...value.items, clone(value.items[0])];
      if (count === 49) value.items.at(-1).id = "extra-49";
    });

    assert.throws(
      () => validateRegistry(changed),
      (error) => error instanceof CalibrationValidationError && errorCodes(error).includes("item-count"),
    );
  }
});

test("rejects seven/nine class distribution even with 48 total items", () => {
  const changed = invalidRegistry((value) => {
    value.items[0].label = "Pop";
  });

  assert.throws(
    () => validateRegistry(changed),
    (error) => error instanceof CalibrationValidationError && errorCodes(error).includes("class-count"),
  );
});

test("rejects every missing required provenance and review field", () => {
  const changed = invalidRegistry((value) => {
    const item = value.items[0];
    delete item.id;
    delete item.localPath;
    delete item.source.url;
    delete item.source.collectionId;
    delete item.licence.id;
    delete item.licence.evidence;
    delete item.labelRationale;
    delete item.instrumentalReview.evidence;
    delete item.selectionNotes;
  });

  assert.throws(
    () => validateRegistry(changed),
    (error) => {
      if (!(error instanceof CalibrationValidationError)) return false;
      const codes = errorCodes(error);
      return [
        "required-id",
        "required-local-path",
        "required-source",
        "required-licence-id",
        "required-licence-evidence",
        "required-label-rationale",
        "required-instrumental-evidence",
        "required-selection-notes",
      ].every((code) => codes.includes(code));
    },
  );
});

test("rejects duplicate IDs and duplicate normalized local paths", () => {
  const changed = invalidRegistry((value) => {
    value.items[1].id = value.items[0].id;
    value.items[1].localPath = `./${value.items[0].localPath}`;
  });

  assert.throws(
    () => validateRegistry(changed),
    (error) => {
      if (!(error instanceof CalibrationValidationError)) return false;
      const codes = errorCodes(error);
      return codes.includes("duplicate-id") && codes.includes("duplicate-path");
    },
  );
});

test("normalizes a safe relative path before resolving it", () => {
  const changed = invalidRegistry((value) => {
    value.items[0].localPath = "./clean_midi/Al Jarreau/../Al Jarreau/Roof Garden.mid";
  });
  const normalized = validateRegistry(changed);
  const resolved = resolveAssets(normalized, "/acquired/lmd", () => true);

  assert.equal(normalized.items[0].localPath, "clean_midi/Al Jarreau/Roof Garden.mid");
  assert.equal(resolved.items[0].inputPath, "/acquired/lmd/clean_midi/Al Jarreau/Roof Garden.mid");
});

test("rejects labels outside the fixed candidate set", () => {
  const changed = invalidRegistry((value) => {
    value.items[0].label = "Folk";
  });

  assert.throws(
    () => validateRegistry(changed),
    (error) => error instanceof CalibrationValidationError && errorCodes(error).includes("label"),
  );
});

test("rejects vocal, unknown, omitted, and arbitrary instrumental statuses", () => {
  for (const status of ["vocal", "unknown", undefined, "spoken-word"]) {
    const changed = invalidRegistry((value) => {
      if (status === undefined) delete value.items[0].instrumentalReview.status;
      else value.items[0].instrumentalReview.status = status;
    });

    assert.throws(
      () => validateRegistry(changed),
      (error) => error instanceof CalibrationValidationError && errorCodes(error).includes("instrumental-status"),
    );
  }
});

test("rejects absolute, traversal, and unsupported asset paths", () => {
  for (const localPath of ["/absolute/file.mid", "../outside/file.mid", "clean_midi/file.mp3"]) {
    const changed = invalidRegistry((value) => {
      value.items[0].localPath = localPath;
    });

    assert.throws(
      () => validateRegistry(changed),
      (error) => {
        if (!(error instanceof CalibrationValidationError)) return false;
        const codes = errorCodes(error);
        return localPath.endsWith(".mp3")
          ? codes.includes("unsupported-extension")
          : codes.includes("path");
      },
    );
  }
});

test("reports deterministic diagnostics for multiple independent failures", () => {
  const changed = invalidRegistry((value) => {
    value.schemaVersion = 2;
    value.candidates = ["Jazz", "Funk/R&B"];
    value.items = [];
  });

  assert.throws(
    () => validateRegistry(changed),
    (error) => {
      assert.ok(error instanceof CalibrationValidationError);
      assert.deepEqual(errorCodes(error), ["schema-version", "candidate-set", "item-count"]);
      return true;
    },
  );
});

test("resolves all local assets through an injected existence predicate", () => {
  const resolved = resolveAssets(registry, "/acquired/lmd", () => true);

  assert.equal(resolved.items.length, 48);
  assert.equal(resolved.items[0].id, "funk-rb-01");
  assert.equal(
    resolved.items[0].inputPath,
    "/acquired/lmd/clean_midi/Al Jarreau/Roof Garden.mid",
  );
  assert.equal(resolved.items.at(-1).inputPath, "/acquired/lmd/clean_midi/Foster David/Winter Games.mid");
});

test("rejects a missing local prerequisite without fetching it", () => {
  const missing = new Set([registry.items[3].localPath]);
  let checked = 0;

  assert.throws(
    () => resolveAssets(registry, "/acquired/lmd", (path) => {
      checked += 1;
      return !path.endsWith([...missing][0]);
    }),
    (error) => error instanceof CalibrationAssetError && errorCodes(error).includes("asset-missing"),
  );
  assert.equal(checked, 48);
});

test("plans stable candidate-then-ID render jobs and a compatible manifest", () => {
  const { jobs, manifest } = planCorpus(registry, {
    seconds: 22,
    sampleRate: 44100,
    outputDir: "/out/calibration",
  });

  assert.deepEqual(jobs.map((job) => job.id), [
    "funk-rb-01", "funk-rb-02", "funk-rb-03", "funk-rb-04", "funk-rb-05", "funk-rb-06", "funk-rb-07", "funk-rb-08",
    "jazz-01", "jazz-02", "jazz-03", "jazz-04", "jazz-05", "jazz-06", "jazz-07", "jazz-08",
    "blues-01", "blues-02", "blues-03", "blues-04", "blues-05", "blues-06", "blues-07", "blues-08",
    "rock-01", "rock-02", "rock-03", "rock-04", "rock-05", "rock-06", "rock-07", "rock-08",
    "pop-01", "pop-02", "pop-03", "pop-04", "pop-05", "pop-06", "pop-07", "pop-08",
    "electronic-01", "electronic-02", "electronic-03", "electronic-04", "electronic-05", "electronic-06", "electronic-07", "electronic-08",
  ]);
  assert.equal(jobs[0].outputPath, "/out/calibration/funk-rb-01.wav");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.corpusId, "lime-genre-calibration-v1");
  assert.equal(manifest.reference, true);
  assert.equal(manifest.task, "genre");
  assert.equal(manifest.calibration, true);
  assert.equal(manifest.sampleRate, 44100);
  assert.deepEqual(manifest.candidates, candidates);
  assert.equal(manifest.clips.length, 48);
  assert.equal(manifest.clips[0].file, "funk-rb-01.wav");
  assert.equal(manifest.clips[0].truth, manifest.candidates[0]);
  assert.equal(manifest.clips[0].source, "https://colinraffel.com/projects/lmd/");
  assert.equal(manifest.clips[0].seconds, 22);
  assert.equal(manifest.clips[0].registryId, "funk-rb-01");
  assert.equal(manifest.clips[0].provenance.licence, "CC-BY-4.0");
  assert.equal(manifest.clips[0].provenance.instrumentalReview.includes("no lyric events"), true);
  assert.equal(Object.hasOwn(manifest, "generatedAt"), false);
  assert.deepEqual(JSON.stringify(planCorpus(registry, {
    seconds: 22,
    sampleRate: 44100,
    outputDir: "/out/calibration",
  })), JSON.stringify({ jobs, manifest }));
});

test("supports collection-only source provenance", () => {
  const changed = invalidRegistry((value) => {
    delete value.items[0].source.url;
  });
  const normalized = validateRegistry(changed);
  const { manifest } = planCorpus(normalized, { seconds: 20, sampleRate: 48000, outputDir: "/out" });

  assert.equal(manifest.clips[0].source, "lmd-clean/Al Jarreau/Roof Garden.mid");
  assert.equal(manifest.sampleRate, 48000);
});

function scoresAtRank(truth, rank, scoreCandidates = candidates) {
  const others = scoreCandidates.filter((candidate) => candidate !== truth);
  const order = [...others.slice(0, rank - 1), truth, ...others.slice(rank - 1)];
  return Object.fromEntries(order.map((candidate, index) => [candidate, order.length - index]));
}

function rowsForRanks(truth, ranks, scoreCandidates = candidates) {
  return ranks.map((rank) => ({ truth, scores: scoresAtRank(truth, rank, scoreCandidates) }));
}

function scoresWithPrediction(truth, prediction, rank) {
  const remaining = candidates.filter((candidate) => candidate !== truth && candidate !== prediction);
  const order = [prediction, ...remaining.slice(0, rank - 2), truth, ...remaining.slice(rank - 2)];
  return Object.fromEntries(order.map((candidate, index) => [candidate, order.length - index]));
}

function classResult(summary, candidate) {
  return summary.classes.find((result) => result.candidate === candidate);
}

test("ranks score ties in declared candidate order", () => {
  const scores = Object.fromEntries(candidates.map((candidate) => [candidate, candidate === "Blues" ? 0 : 1]));

  assert.deepEqual(
    rankScores(scores, candidates).map(({ candidate, rank }) => [candidate, rank]),
    [["Funk/R&B", 1], ["Jazz", 2], ["Rock", 3], ["Pop", 4], ["Electronic", 5], ["Blues", 6]],
  );
});

test("passes all class gates at inclusive 4/8, 6/8, and mean-rank 2.5 boundaries", () => {
  const summary = summarizeCalibration(rowsForRanks("Jazz", [1, 1, 1, 1, 2, 2, 6, 6]), candidates);
  const jazz = classResult(summary, "Jazz");

  assert.equal(jazz.top1.correct, 4);
  assert.equal(jazz.top1.accuracy, 0.5);
  assert.equal(jazz.top1.passed, true);
  assert.equal(jazz.top2.withinTwo, 6);
  assert.equal(jazz.top2.accuracy, 0.75);
  assert.equal(jazz.top2.passed, true);
  assert.equal(jazz.meanTrueLabelRank, 2.5);
  assert.equal(jazz.meanRankPassed, true);
  assert.equal(jazz.trustedForTuning, true);
});

test("reports each individual class gate failure", () => {
  const top1 = classResult(
    summarizeCalibration(rowsForRanks("Jazz", [1, 1, 1, 2, 2, 2, 3, 3]), candidates),
    "Jazz",
  );
  const top2 = classResult(
    summarizeCalibration(rowsForRanks("Jazz", [1, 1, 1, 1, 2, 3, 3, 3]), candidates),
    "Jazz",
  );
  const extendedCandidates = [...candidates, "Other", "Ambient"];
  const meanRank = classResult(
    summarizeCalibration(
      rowsForRanks("Jazz", [1, 1, 1, 1, 2, 2, 8, 8], extendedCandidates),
      extendedCandidates,
    ),
    "Jazz",
  );

  assert.equal(top1.top1.passed, false);
  assert.deepEqual(top1.failedGates, ["top-1"]);
  assert.equal(top1.trustedForTuning, false);
  assert.equal(top2.top2.passed, false);
  assert.deepEqual(top2.failedGates, ["top-2"]);
  assert.equal(meanRank.meanRankPassed, false);
  assert.deepEqual(meanRank.failedGates, ["mean rank"]);
});

test("does not let an overall pass override a failed Funk/R&B gate", () => {
  const results = candidates.flatMap((candidate) =>
    candidate === "Funk/R&B"
      ? rowsForRanks(candidate, [3, 3, 3, 3, 3, 3, 3, 3])
      : rowsForRanks(candidate, [1, 1, 1, 1, 1, 1, 1, 1]),
  );
  const summary = summarizeCalibration(results, candidates);

  assert.equal(summary.overall.correct, 40);
  assert.equal(summary.overall.accuracy, 40 / 48);
  assert.equal(classResult(summary, "Funk/R&B").trustedForTuning, false);
  assert.equal(summary.classes.filter(({ trustedForTuning }) => trustedForTuning).length, 5);
});

test("reports known ranks, counts, tied primary confusions, and absent confusions", () => {
  const rows = [
    ...rowsForRanks("Funk/R&B", [1, 1, 1]),
    ...rowsForRanks("Funk/R&B", [2, 2]),
    ...rowsForRanks("Funk/R&B", [3, 3]),
    ...rowsForRanks("Funk/R&B", [4]),
    ...rowsForRanks("Jazz", [1, 1, 1, 1, 1, 1, 1, 1]),
  ];
  const summary = summarizeCalibration(rows, candidates);
  const funk = classResult(summary, "Funk/R&B");
  const jazz = classResult(summary, "Jazz");

  assert.equal(funk.count, 8);
  assert.equal(funk.top1.correct, 3);
  assert.equal(funk.top2.withinTwo, 5);
  assert.equal(funk.meanTrueLabelRank, 2.125);
  assert.deepEqual(funk.primaryConfusions, ["Jazz"]);
  assert.deepEqual(jazz.primaryConfusions, []);
});

test("orders tied primary confusions by declared candidates", () => {
  const rows = [
    ...rowsForRanks("Funk/R&B", [1, 1, 1, 1]),
    ...[2, 2].map((rank) => ({ truth: "Funk/R&B", scores: scoresWithPrediction("Funk/R&B", "Jazz", rank) })),
    ...[3, 3].map((rank) => ({ truth: "Funk/R&B", scores: scoresWithPrediction("Funk/R&B", "Blues", rank) })),
  ];
  const summary = summarizeCalibration(rows, candidates);

  assert.deepEqual(classResult(summary, "Funk/R&B").primaryConfusions, ["Jazz", "Blues"]);
});

test("rejects missing or unknown truth and incomplete or non-numeric score maps", () => {
  const valid = rowsForRanks("Jazz", [1])[0];
  const cases = [
    { ...valid, truth: undefined },
    { ...valid, truth: "Folk" },
    { truth: "Jazz", scores: { ...valid.scores, Electronic: undefined } },
    { truth: "Jazz", scores: { ...valid.scores, Electronic: "high" } },
    { truth: "Jazz", scores: { ...valid.scores, Other: 1 } },
  ];

  for (const value of cases) {
    assert.throws(
      () => summarizeCalibration([value], candidates),
      (error) => error instanceof CalibrationScoringError,
    );
  }
});

test("retains chance and exact-binomial output for a prose-only legacy report", () => {
  const directory = mkdtempSync(join(tmpdir(), "lime-matrix-legacy-"));
  const reportPath = join(directory, "report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(candidates.map((truth) => ({ truth, verdict: `1. BEST MATCH: ${truth}` }))),
  );

  const output = execFileSync(process.execPath, ["tools/judge/matrix.mjs", reportPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.match(output, /chance\s+: 17%\s+\(6 candidates\)/);
  assert.match(output, /p-value\s+:/);
  assert.doesNotMatch(output, /CALIBRATION TRUST GATES/);
});

test("rejects incomplete, inconsistent, or non-numeric scored matrix input", () => {
  const directory = mkdtempSync(join(tmpdir(), "lime-matrix-invalid-"));
  const manifestPath = join(directory, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ candidates }));
  const reportPath = join(directory, "report.json");
  const validScores = scoresAtRank("Jazz", 1);
  const cases = [
    { truth: "Jazz", scores: { ...validScores, Electronic: undefined } },
    { truth: "Jazz", scores: { ...validScores, Electronic: "not-a-score" } },
    { truth: "Jazz", scores: { ...validScores, Other: 1 } },
    { truth: undefined, scores: validScores },
  ];

  for (const value of cases) {
    writeFileSync(reportPath, JSON.stringify([value]));
    assert.throws(
      () => execFileSync(process.execPath, ["tools/judge/matrix.mjs", reportPath], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
      /Invalid matrix report|Invalid calibration scores/,
    );
  }

  writeFileSync(reportPath, JSON.stringify([
    { truth: "Jazz", scores: validScores },
    { truth: "Jazz", scores: { ...validScores, Electronic: undefined } },
  ]));
  assert.throws(
    () => execFileSync(process.execPath, ["tools/judge/matrix.mjs", reportPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    }),
    /inconsistent candidate set|Invalid calibration scores/,
  );
});

test("prints class gates and stable JSON for scored calibration reports", () => {
  const directory = mkdtempSync(join(tmpdir(), "lime-matrix-calibration-"));
  const reportPath = join(directory, "report-fused.json");
  const results = candidates.flatMap((candidate) => {
    if (candidate === "Funk/R&B") return rowsForRanks(candidate, [3, 3, 3, 3, 3, 3, 3, 3]);
    if (candidate === "Jazz") return rowsForRanks(candidate, [1, 1, 1, 1, 2, 2, 6, 6]);
    return rowsForRanks(candidate, [1, 1, 1, 1, 1, 1, 1, 1]);
  });
  writeFileSync(reportPath, JSON.stringify(results));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      corpusId: "lime-genre-calibration-v1",
      reference: true,
      task: "genre",
      calibration: true,
      candidates,
    }),
  );

  const output = execFileSync(process.execPath, ["tools/judge/matrix.mjs", reportPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const json = JSON.parse(
    execFileSync(process.execPath, ["tools/judge/matrix.mjs", "--json", reportPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    }),
  );

  assert.ok(output.indexOf("CALIBRATION TRUST GATES") < output.indexOf("intended"));
  assert.match(output, /Funk\/R&B.*UNTRUSTED FOR TUNING/);
  assert.match(output, /Jazz.*TRUSTED FOR TUNING/);
  assert.deepEqual(json.candidates, candidates);
  assert.equal(json.corpus.corpusId, "lime-genre-calibration-v1");
  assert.equal(json.overall.correct, 36);
  assert.ok(json.overall.pValue >= 0 && json.overall.pValue <= 1);
  assert.equal(json.classes[0].candidate, "Funk/R&B");
  assert.equal(json.classes[0].trustedForTuning, false);
});
