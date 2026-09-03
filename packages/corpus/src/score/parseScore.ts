import { readFileSync } from "node:fs";
import type { CorpusMeta, CorpusScore } from "../ir.js";
import { parseMidiFile } from "../midi/parseMidi.js";
import { loadMusicXmlFile } from "../musicxml/loadMusicXml.js";

/**
 * Format-agnostic score loader. Dispatches by file extension so the rest of the
 * pipeline (key detection, chordify, extraction) is source-format-independent.
 */
export function parseScoreFile(path: string, meta: Omit<CorpusMeta, "key">): CorpusScore {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
    return parseMidiFile(new Uint8Array(readFileSync(path)), { id: path, meta });
  }
  if (lower.endsWith(".xml") || lower.endsWith(".musicxml") || lower.endsWith(".mxl")) {
    return loadMusicXmlFile(path, { id: path, meta });
  }
  throw new Error(`parseScoreFile: unsupported extension for ${path}`);
}

/** Extensions the loader understands. */
export const SCORE_EXTENSIONS = [".mid", ".midi", ".xml", ".musicxml", ".mxl"];
