import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EmotionAnnotation } from "../ir.js";
import { quadrantToEmotion } from "../style/emotionMapping.js";

/** A corpus file with its grouping bucket and optional tags. */
export interface TaggedFile {
  readonly path: string;
  /** Grouping key for one StylePack, e.g. "Q1" or "all". */
  readonly bucket: string;
  readonly emotion?: EmotionAnnotation;
  readonly genre?: string;
}

export interface LoadOptions {
  /** Max files per dataset (deterministic: first N sorted). 0 = all. */
  readonly limit?: number;
}

/** Recursively list files matching an extension under a directory. */
function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (exts.some((e) => name.toLowerCase().endsWith(e))) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

// --- EMOPIA (quadrant encoded in filename: Q1_.. Q2_.. Q3_.. Q4_..) ---------

/** Extract the emotion quadrant from an EMOPIA filename, or null. */
export function emopiaQuadrant(filename: string): "Q1" | "Q2" | "Q3" | "Q4" | null {
  const m = /(?:^|\/)(Q[1-4])_/.exec(filename);
  return m ? (m[1] as "Q1" | "Q2" | "Q3" | "Q4") : null;
}

export function loadEmopia(root: string, opts: LoadOptions = {}): TaggedFile[] {
  const files = listFiles(join(root, "emopia"), [".mid", ".midi"]);
  const tagged: TaggedFile[] = [];
  for (const path of files) {
    const q = emopiaQuadrant(path);
    if (!q) continue;
    tagged.push({ path, bucket: q, emotion: quadrantToEmotion(q), genre: "pop" });
  }
  return applyPerBucketLimit(tagged, opts.limit);
}

// --- VGMIDI (labelled CSV: ...,midi,valence,arousal) ------------------------

export interface VgmidiRow {
  readonly midi: string;
  readonly valence: number;
  readonly arousal: number;
  readonly series?: string;
  readonly console?: string;
  readonly game?: string;
  readonly piece?: string;
}

/** Parse the VGMIDI labelled CSV into rows (pure; no filesystem). */
export function parseVgmidiCsv(text: string): VgmidiRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsv(lines[0]!);
  const midiIdx = header.indexOf("midi");
  const valIdx = header.indexOf("valence");
  const aroIdx = header.indexOf("arousal");
  const at = (name: string) => header.indexOf(name);
  if (midiIdx < 0 || valIdx < 0 || aroIdx < 0) return [];
  const rows: VgmidiRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsv(lines[i]!);
    const midi = cols[midiIdx];
    const valence = Number(cols[valIdx]);
    const arousal = Number(cols[aroIdx]);
    if (midi && Number.isFinite(valence) && Number.isFinite(arousal)) {
      rows.push({
        midi,
        valence,
        arousal,
        series: cols[at("series")],
        console: cols[at("console")],
        game: cols[at("game")],
        piece: cols[at("piece")],
      });
    }
  }
  return rows;
}

/** Candidate on-disk paths for a labelled VGMIDI row, most specific first. */
export function vgmidiCandidatePaths(row: VgmidiRow): string[] {
  const paths = [row.midi];
  // The CSV references labelled/phrases/*.mid segments that aren't always in the
  // download; the full pieces live in labelled/midi/{series}_{console}_{game}_{piece}.mid.
  if (row.series && row.console && row.game && row.piece) {
    paths.push(`labelled/midi/${row.series}_${row.console}_${row.game}_${row.piece}.mid`);
  }
  return paths;
}

/** Quadrant (Q1..Q4) from valence/arousal signs (Russell). */
export function quadrantOf(valence: number, arousal: number): "Q1" | "Q2" | "Q3" | "Q4" {
  if (arousal >= 0) return valence >= 0 ? "Q1" : "Q2";
  return valence >= 0 ? "Q4" : "Q3";
}

export function loadVgmidi(root: string, opts: LoadOptions = {}): TaggedFile[] {
  const base = join(root, "vgmidi", "vgmidi-master");
  const csvPath = join(base, "vgmidi_labelled.csv");
  if (!existsSync(csvPath)) return [];
  const rows = parseVgmidiCsv(readFileSync(csvPath, "utf8"));
  const tagged: TaggedFile[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const resolved = vgmidiCandidatePaths(row).map((p) => join(base, p)).find((p) => existsSync(p));
    if (!resolved || seen.has(resolved)) continue; // dedupe pieces shared by phrases
    seen.add(resolved);
    tagged.push({
      path: resolved,
      bucket: quadrantOf(row.valence, row.arousal),
      emotion: { valence: clampVA(row.valence), arousal: clampVA(row.arousal) },
      genre: "video-game",
    });
  }
  return applyPerBucketLimit(tagged, opts.limit);
}

// --- Lakh clean_midi (no emotion labels; a general multi-genre pool) ---------

export function loadLakh(root: string, opts: LoadOptions = {}): TaggedFile[] {
  const files = listFiles(join(root, "lakh"), [".mid", ".midi"]);
  const tagged = files.map((path): TaggedFile => ({ path, bucket: "all", genre: "mixed" }));
  return applyPerBucketLimit(tagged, opts.limit);
}

// --- MusicXML directories (OpenScore / PDMX — CC0 classical) -----------------

/** Load a directory of MusicXML files (.xml/.musicxml/.mxl) as one pool. */
export function loadMusicXmlDir(
  root: string,
  sub: string,
  genre: string,
  opts: LoadOptions = {},
): TaggedFile[] {
  const files = listFiles(join(root, sub), [".xml", ".musicxml", ".mxl"]);
  const tagged = files.map((path): TaggedFile => ({ path, bucket: "all", genre }));
  return applyPerBucketLimit(tagged, opts.limit);
}

export const loadOpenscore = (root: string, opts: LoadOptions = {}): TaggedFile[] =>
  loadMusicXmlDir(root, "openscore", "classical", opts);

export const loadPdmx = (root: string, opts: LoadOptions = {}): TaggedFile[] =>
  loadMusicXmlDir(root, "pdmx", "classical", opts);

// --- helpers ----------------------------------------------------------------

function splitCsv(line: string): string[] {
  // VGMIDI CSV has no quoted commas in the columns we read; simple split is safe.
  return line.split(",");
}

function clampVA(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Keep at most `limit` files per bucket (deterministic order). */
function applyPerBucketLimit(files: TaggedFile[], limit?: number): TaggedFile[] {
  if (!limit || limit <= 0) return files;
  const counts = new Map<string, number>();
  const out: TaggedFile[] = [];
  for (const f of files) {
    const c = counts.get(f.bucket) ?? 0;
    if (c >= limit) continue;
    counts.set(f.bucket, c + 1);
    out.push(f);
  }
  return out;
}
