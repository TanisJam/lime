import { posix } from "node:path";

export const CALIBRATION_CANDIDATES = Object.freeze([
  "Funk/R&B",
  "Jazz",
  "Blues",
  "Rock",
  "Pop",
  "Electronic",
]);

export const CALIBRATION_SCHEMA_VERSION = 1;
export const CALIBRATION_CORPUS_ID = "lime-genre-calibration-v1";
export const CALIBRATION_ITEMS_PER_CANDIDATE = 8;
export const CALIBRATION_ITEM_COUNT = CALIBRATION_CANDIDATES.length * CALIBRATION_ITEMS_PER_CANDIDATE;
export const CALIBRATION_GATE_THRESHOLDS = Object.freeze({
  top1: 0.5,
  top2: 0.75,
  meanTrueLabelRank: 2.5,
});

const MIDI_EXTENSIONS = new Set([".mid", ".midi"]);
const candidateOrder = new Map(CALIBRATION_CANDIDATES.map((candidate, index) => [candidate, index]));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function diagnostic(code, path, message) {
  return { code, path, message };
}

function compareLexically(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedLocalPath(localPath) {
  if (!nonEmptyString(localPath)) return null;
  if (posix.isAbsolute(localPath) || localPath.includes("\\") || /^[A-Za-z][A-Za-z\d+.-]*:/.test(localPath)) {
    return null;
  }

  const normalized = posix.normalize(localPath);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function sourceValue(item) {
  return nonEmptyString(item.source.url) ? item.source.url : item.source.collectionId;
}

function orderedItems(registry) {
  return [...registry.items].sort((left, right) => {
    const byCandidate = candidateOrder.get(left.label) - candidateOrder.get(right.label);
    return byCandidate || compareLexically(left.id, right.id);
  });
}

function cloneItem(item, localPath) {
  return {
    ...item,
    localPath,
    source: { ...item.source },
    licence: { ...item.licence },
    instrumentalReview: { ...item.instrumentalReview },
  };
}

function validationError(diagnostics) {
  return new CalibrationValidationError(diagnostics);
}

export class CalibrationValidationError extends Error {
  constructor(diagnostics) {
    const summary = diagnostics.map(({ code, path }) => `${code} at ${path}`).join("; ");
    super(`Invalid calibration registry: ${summary}`);
    this.name = "CalibrationValidationError";
    this.code = "CALIBRATION_REGISTRY_INVALID";
    this.diagnostics = diagnostics;
    this.codes = diagnostics.map(({ code }) => code);
  }
}

export class CalibrationAssetError extends Error {
  constructor(diagnostics) {
    const summary = diagnostics.map(({ code, path }) => `${code} at ${path}`).join("; ");
    super(`Calibration assets are unavailable: ${summary}`);
    this.name = "CalibrationAssetError";
    this.code = "CALIBRATION_ASSETS_INVALID";
    this.diagnostics = diagnostics;
    this.codes = diagnostics.map(({ code }) => code);
  }
}

export class CalibrationPlanningError extends Error {
  constructor(diagnostics) {
    const summary = diagnostics.map(({ code, path }) => `${code} at ${path}`).join("; ");
    super(`Invalid calibration planning options: ${summary}`);
    this.name = "CalibrationPlanningError";
    this.code = "CALIBRATION_PLAN_INVALID";
    this.diagnostics = diagnostics;
    this.codes = diagnostics.map(({ code }) => code);
  }
}

export class CalibrationScoringError extends Error {
  constructor(diagnostics) {
    const summary = diagnostics.map(({ code, path }) => `${code} at ${path}`).join("; ");
    super(`Invalid calibration scores: ${summary}`);
    this.name = "CalibrationScoringError";
    this.code = "CALIBRATION_SCORES_INVALID";
    this.diagnostics = diagnostics;
    this.codes = diagnostics.map(({ code }) => code);
  }
}

export function validateRegistry(registry) {
  const diagnostics = [];
  if (!isRecord(registry)) {
    throw validationError([diagnostic("registry-shape", "registry", "registry must be an object")]);
  }

  if (registry.schemaVersion !== CALIBRATION_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        "schema-version",
        "schemaVersion",
        `schemaVersion must be ${CALIBRATION_SCHEMA_VERSION}`,
      ),
    );
  }
  if (registry.corpusId !== CALIBRATION_CORPUS_ID) {
    diagnostics.push(
      diagnostic("corpus-id", "corpusId", `corpusId must be ${CALIBRATION_CORPUS_ID}`),
    );
  }
  if (
    !Array.isArray(registry.candidates) ||
    registry.candidates.length !== CALIBRATION_CANDIDATES.length ||
    registry.candidates.some((candidate, index) => candidate !== CALIBRATION_CANDIDATES[index])
  ) {
    diagnostics.push(
      diagnostic(
        "candidate-set",
        "candidates",
        "candidates must exactly match the ordered six-class calibration set",
      ),
    );
  }

  if (!Array.isArray(registry.items)) {
    diagnostics.push(diagnostic("item-count", "items", `items must contain ${CALIBRATION_ITEM_COUNT} records`));
    throw validationError(diagnostics);
  }
  if (registry.items.length !== CALIBRATION_ITEM_COUNT) {
    diagnostics.push(
      diagnostic(
        "item-count",
        "items",
        `items must contain exactly ${CALIBRATION_ITEM_COUNT} records`,
      ),
    );
  }

  const ids = new Map();
  const paths = new Map();
  const counts = new Map(CALIBRATION_CANDIDATES.map((candidate) => [candidate, 0]));
  const normalizedPaths = new Map();

  for (const [index, item] of registry.items.entries()) {
    const itemPath = `items[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push(diagnostic("item-shape", itemPath, "item must be an object"));
      continue;
    }

    if (!nonEmptyString(item.id)) {
      diagnostics.push(diagnostic("required-id", `${itemPath}.id`, "id must be a non-empty string"));
    } else if (item.id.includes("/") || item.id.includes("\\") || item.id === "." || item.id === "..") {
      diagnostics.push(diagnostic("invalid-id", `${itemPath}.id`, "id must be safe for a rendered filename"));
    } else if (ids.has(item.id)) {
      diagnostics.push(
        diagnostic(
          "duplicate-id",
          `${itemPath}.id`,
          `id duplicates ${ids.get(item.id)}`,
        ),
      );
    } else {
      ids.set(item.id, `${itemPath}.id`);
    }

    if (!nonEmptyString(item.label)) {
      diagnostics.push(diagnostic("required-label", `${itemPath}.label`, "label must be a non-empty string"));
    } else if (!candidateOrder.has(item.label)) {
      diagnostics.push(diagnostic("label", `${itemPath}.label`, "label is outside the fixed candidate set"));
    } else {
      counts.set(item.label, counts.get(item.label) + 1);
    }

    let normalizedPath = null;
    if (!nonEmptyString(item.localPath)) {
      diagnostics.push(
        diagnostic("required-local-path", `${itemPath}.localPath`, "localPath must be a non-empty string"),
      );
    } else {
      normalizedPath = normalizedLocalPath(item.localPath);
      if (normalizedPath === null) {
        diagnostics.push(
          diagnostic(
            "path",
            `${itemPath}.localPath`,
            "localPath must be a non-escaping POSIX-relative path and cannot be a URL",
          ),
        );
      } else {
        const extension = posix.extname(normalizedPath).toLowerCase();
        if (!MIDI_EXTENSIONS.has(extension)) {
          diagnostics.push(
            diagnostic(
              "unsupported-extension",
              `${itemPath}.localPath`,
              "localPath must identify a .mid or .midi asset",
            ),
          );
        }
        if (paths.has(normalizedPath)) {
          diagnostics.push(
            diagnostic(
              "duplicate-path",
              `${itemPath}.localPath`,
              `localPath duplicates ${paths.get(normalizedPath)}`,
            ),
          );
        } else {
          paths.set(normalizedPath, `${itemPath}.localPath`);
        }
        normalizedPaths.set(index, normalizedPath);
      }
    }

    if (!isRecord(item.source) || (!nonEmptyString(item.source.url) && !nonEmptyString(item.source.collectionId))) {
      diagnostics.push(
        diagnostic(
          "required-source",
          `${itemPath}.source`,
          "source.url or source.collectionId must be provided",
        ),
      );
    }
    if (!isRecord(item.licence)) {
      diagnostics.push(diagnostic("required-licence", `${itemPath}.licence`, "licence must be an object"));
    } else {
      if (!nonEmptyString(item.licence.id)) {
        diagnostics.push(
          diagnostic("required-licence-id", `${itemPath}.licence.id`, "licence.id must be non-empty"),
        );
      }
      if (!nonEmptyString(item.licence.evidence)) {
        diagnostics.push(
          diagnostic(
            "required-licence-evidence",
            `${itemPath}.licence.evidence`,
            "licence.evidence must be non-empty",
          ),
        );
      }
    }
    if (!nonEmptyString(item.labelRationale)) {
      diagnostics.push(
        diagnostic(
          "required-label-rationale",
          `${itemPath}.labelRationale`,
          "labelRationale must be non-empty",
        ),
      );
    }
    if (!isRecord(item.instrumentalReview)) {
      diagnostics.push(
        diagnostic(
          "required-instrumental-review",
          `${itemPath}.instrumentalReview`,
          "instrumentalReview must be an object",
        ),
      );
    } else {
      if (item.instrumentalReview.status !== "instrumental") {
        diagnostics.push(
          diagnostic(
            "instrumental-status",
            `${itemPath}.instrumentalReview.status`,
            "instrumentalReview.status must be exactly instrumental",
          ),
        );
      }
      if (!nonEmptyString(item.instrumentalReview.evidence)) {
        diagnostics.push(
          diagnostic(
            "required-instrumental-evidence",
            `${itemPath}.instrumentalReview.evidence`,
            "instrumentalReview.evidence must be non-empty",
          ),
        );
      }
    }
    if (!nonEmptyString(item.selectionNotes)) {
      diagnostics.push(
        diagnostic(
          "required-selection-notes",
          `${itemPath}.selectionNotes`,
          "selectionNotes must be non-empty",
        ),
      );
    }
  }

  if (registry.items.length > 0) {
    for (const candidate of CALIBRATION_CANDIDATES) {
      if (counts.get(candidate) !== CALIBRATION_ITEMS_PER_CANDIDATE) {
        diagnostics.push(
          diagnostic(
            "class-count",
            `items[label=${candidate}]`,
            `${candidate} must contain exactly ${CALIBRATION_ITEMS_PER_CANDIDATE} records`,
          ),
        );
      }
    }
  }

  if (diagnostics.length > 0) throw validationError(diagnostics);

  return {
    ...registry,
    candidates: [...registry.candidates],
    items: registry.items.map((item, index) => cloneItem(item, normalizedPaths.get(index))),
  };
}

export function resolveAssets(registry, assetRoot, exists) {
  const normalized = validateRegistry(registry);
  const diagnostics = [];

  if (typeof exists !== "function") {
    throw new CalibrationAssetError([
      diagnostic("exists-predicate", "exists", "exists must be an injected predicate function"),
    ]);
  }
  if (!nonEmptyString(assetRoot) || !posix.isAbsolute(assetRoot)) {
    throw new CalibrationAssetError([
      diagnostic("asset-root", "assetRoot", "assetRoot must be an absolute path"),
    ]);
  }

  const root = posix.normalize(assetRoot);
  const items = orderedItems(normalized).map((item) => {
    const inputPath = posix.resolve(root, item.localPath);
    const insideRoot = root === "/" ? inputPath.startsWith("/") : inputPath === root || inputPath.startsWith(`${root}/`);
    if (!insideRoot) {
      diagnostics.push(
        diagnostic("path-escape", `items[${item.id}].localPath`, "resolved asset path escapes assetRoot"),
      );
      return { ...item, inputPath };
    }

    let available = false;
    try {
      available = Boolean(exists(inputPath));
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "asset-check",
          `items[${item.id}].localPath`,
          error instanceof Error ? error.message : "exists predicate failed",
        ),
      );
      return { ...item, inputPath };
    }
    if (!available) {
      diagnostics.push(
        diagnostic("asset-missing", `items[${item.id}].localPath`, `asset is not available at ${inputPath}`),
      );
    }
    return { ...item, inputPath };
  });

  if (diagnostics.length > 0) throw new CalibrationAssetError(diagnostics);
  return { registry: normalized, assetRoot: root, items };
}

export function planCorpus(registry, options) {
  const normalized = validateRegistry(registry);
  const diagnostics = [];
  const { seconds, sampleRate, outputDir } = options ?? {};

  if (!(typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0)) {
    diagnostics.push(diagnostic("seconds", "options.seconds", "seconds must be a positive finite number"));
  }
  if (!(Number.isInteger(sampleRate) && sampleRate > 0)) {
    diagnostics.push(diagnostic("sample-rate", "options.sampleRate", "sampleRate must be a positive integer"));
  }
  if (!nonEmptyString(outputDir)) {
    diagnostics.push(diagnostic("output-dir", "options.outputDir", "outputDir must be a non-empty path"));
  }
  if (diagnostics.length > 0) throw new CalibrationPlanningError(diagnostics);

  const jobs = orderedItems(normalized).map((item) => {
    const file = `${item.id}.wav`;
    return {
      id: item.id,
      registryId: item.id,
      inputPath: item.localPath,
      outputPath: posix.join(outputDir, file),
      file,
      truth: item.label,
      seconds,
      sampleRate,
    };
  });

  const manifest = {
    schemaVersion: normalized.schemaVersion,
    corpusId: normalized.corpusId,
    reference: true,
    task: "genre",
    calibration: true,
    sampleRate,
    candidates: [...normalized.candidates],
    clips: jobs.map((job) => {
      const item = normalized.items.find(({ id }) => id === job.id);
      const provenance = {
        licence: item.licence.id,
        licenceEvidence: item.licence.evidence,
        labelRationale: item.labelRationale,
        instrumentalReview: item.instrumentalReview.evidence,
        selectionNotes: item.selectionNotes,
      };
      if (item.source.collectionId !== undefined) provenance.collectionId = item.source.collectionId;
      return {
        file: job.file,
        truth: job.truth,
        source: sourceValue(item),
        seconds: job.seconds,
        registryId: item.id,
        provenance,
      };
    }),
  };

  return { jobs, manifest };
}

function scoringDiagnostics(code, path, message) {
  return diagnostic(code, path, message);
}

function scoringCandidates(candidates) {
  const diagnostics = [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    diagnostics.push(scoringDiagnostics("candidate-set", "candidates", "candidates must be a non-empty array"));
  } else {
    const seen = new Set();
    for (const [index, candidate] of candidates.entries()) {
      if (!nonEmptyString(candidate)) {
        diagnostics.push(
          scoringDiagnostics("candidate", `candidates[${index}]`, "candidate must be a non-empty string"),
        );
      } else if (seen.has(candidate)) {
        diagnostics.push(
          scoringDiagnostics("candidate-set", `candidates[${index}]`, "candidates must be unique"),
        );
      } else {
        seen.add(candidate);
      }
    }
  }
  if (diagnostics.length > 0) throw new CalibrationScoringError(diagnostics);
  return [...candidates];
}

function scoreEntries(scores, candidates, path = "scores") {
  const diagnostics = [];
  if (!isRecord(scores)) {
    throw new CalibrationScoringError([
      scoringDiagnostics("scores-shape", path, "scores must be an object"),
    ]);
  }

  const candidateSet = new Set(candidates);
  const keys = Object.keys(scores);
  const missing = candidates.filter((candidate) => !Object.hasOwn(scores, candidate));
  const extra = keys.filter((candidate) => !candidateSet.has(candidate));
  if (missing.length > 0 || extra.length > 0) {
    diagnostics.push(
      scoringDiagnostics(
        "candidate-set",
        path,
        `scores must contain exactly the declared candidates; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`,
      ),
    );
  }
  for (const candidate of candidates) {
    const value = scores[candidate];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      diagnostics.push(
        scoringDiagnostics(
          "score-value",
          `${path}.${candidate}`,
          "score must be a finite number",
        ),
      );
    }
  }
  if (diagnostics.length > 0) throw new CalibrationScoringError(diagnostics);

  const order = new Map(candidates.map((candidate, index) => [candidate, index]));
  return candidates
    .map((candidate) => ({ candidate, score: scores[candidate], order: order.get(candidate) }))
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map(({ candidate, score }, index) => ({ candidate, score, rank: index + 1 }));
}

export function rankScores(scores, candidates) {
  const declaredCandidates = scoringCandidates(candidates);
  return scoreEntries(scores, declaredCandidates);
}

function exactBinomialTail(k, n, probability) {
  if (k <= 0) return 1;
  if (k >= n) return 1;
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

export function summarizeCalibration(results, candidates) {
  const declaredCandidates = scoringCandidates(candidates);
  const diagnostics = [];
  if (!Array.isArray(results) || results.length === 0) {
    throw new CalibrationScoringError([
      scoringDiagnostics("results", "results", "results must contain at least one scored row"),
    ]);
  }

  const rows = [];
  for (const [index, result] of results.entries()) {
    const rowPath = `results[${index}]`;
    if (!isRecord(result)) {
      diagnostics.push(scoringDiagnostics("row-shape", rowPath, "result must be an object"));
      continue;
    }
    if (!nonEmptyString(result.truth)) {
      diagnostics.push(scoringDiagnostics("truth", `${rowPath}.truth`, "truth must be a declared candidate"));
    } else if (!declaredCandidates.includes(result.truth)) {
      diagnostics.push(scoringDiagnostics("truth", `${rowPath}.truth`, "truth is outside the declared candidates"));
    }
    try {
      const ranked = scoreEntries(result.scores, declaredCandidates, `${rowPath}.scores`);
      rows.push({ result, truth: result.truth, ranked });
    } catch (error) {
      if (error instanceof CalibrationScoringError) diagnostics.push(...error.diagnostics);
      else throw error;
    }
  }
  if (diagnostics.length > 0) throw new CalibrationScoringError(diagnostics);

  const correct = rows.filter(({ truth, ranked }) => ranked[0].candidate === truth).length;
  const top2 = rows.filter(({ truth, ranked }) => ranked.find(({ candidate }) => candidate === truth).rank <= 2).length;
  const top3 = rows.filter(({ truth, ranked }) => ranked.find(({ candidate }) => candidate === truth).rank <= 3).length;
  const meanRank = rows.reduce(
    (sum, { truth, ranked }) => sum + ranked.find(({ candidate }) => candidate === truth).rank,
    0,
  ) / rows.length;
  const chance = 1 / declaredCandidates.length;
  const overall = {
    correct,
    total: rows.length,
    accuracy: correct / rows.length,
    chance,
    top2,
    top3,
    meanTrueLabelRank: meanRank,
    pValue: exactBinomialTail(correct, rows.length, chance),
  };

  const classes = declaredCandidates.map((candidate) => {
    const classRows = rows.filter(({ truth }) => truth === candidate);
    const classCount = classRows.length;
    const top1Correct = classRows.filter(({ ranked }) => ranked[0].candidate === candidate).length;
    const withinTwo = classRows.filter(
      ({ ranked }) => ranked.find(({ candidate: rankedCandidate }) => rankedCandidate === candidate).rank <= 2,
    ).length;
    const ranks = classRows.map(
      ({ ranked }) => ranked.find(({ candidate: rankedCandidate }) => rankedCandidate === candidate).rank,
    );
    const meanTrueLabelRank = classCount > 0
      ? ranks.reduce((sum, rank) => sum + rank, 0) / classCount
      : null;
    const confusionCounts = Object.fromEntries(declaredCandidates.map((label) => [label, 0]));
    for (const { ranked } of classRows) {
      const prediction = ranked[0].candidate;
      if (prediction !== candidate) confusionCounts[prediction] += 1;
    }
    const highestConfusion = Math.max(...Object.values(confusionCounts), 0);
    const primaryConfusions = declaredCandidates.filter(
      (label) => highestConfusion > 0 && confusionCounts[label] === highestConfusion,
    );
    const top1Accuracy = classCount > 0 ? top1Correct / classCount : 0;
    const top2Accuracy = classCount > 0 ? withinTwo / classCount : 0;
    const top1Passed = classCount > 0 && top1Accuracy >= CALIBRATION_GATE_THRESHOLDS.top1;
    const top2Passed = classCount > 0 && top2Accuracy >= CALIBRATION_GATE_THRESHOLDS.top2;
    const meanRankPassed = meanTrueLabelRank !== null && meanTrueLabelRank <= CALIBRATION_GATE_THRESHOLDS.meanTrueLabelRank;
    const failedGates = [
      !top1Passed && "top-1",
      !top2Passed && "top-2",
      !meanRankPassed && "mean rank",
    ].filter(Boolean);

    return {
      candidate,
      count: classCount,
      top1: {
        correct: top1Correct,
        total: classCount,
        accuracy: top1Accuracy,
        threshold: CALIBRATION_GATE_THRESHOLDS.top1,
        passed: top1Passed,
      },
      top2: {
        withinTwo,
        total: classCount,
        accuracy: top2Accuracy,
        threshold: CALIBRATION_GATE_THRESHOLDS.top2,
        passed: top2Passed,
      },
      meanTrueLabelRank,
      meanRankThreshold: CALIBRATION_GATE_THRESHOLDS.meanTrueLabelRank,
      meanRankPassed,
      confusionCounts,
      primaryConfusions,
      failedGates,
      trustedForTuning: failedGates.length === 0,
    };
  });

  return {
    candidates: declaredCandidates,
    overall,
    classes,
    correct: overall.correct,
    total: overall.total,
    accuracy: overall.accuracy,
    chance: overall.chance,
    pValue: overall.pValue,
  };
}
