import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** A discovered MIDI file: absolute path plus its path relative to the root. */
export interface MidiFile {
  readonly abs: string;
  readonly rel: string;
}

const MIDI_EXT = /\.midi?$/i;

/**
 * Recursively list every `.mid`/`.midi` file under `root`, skipping files larger
 * than `maxBytes` (a cheap guard against pathological Black-MIDI monsters before
 * they are ever parsed). Sorted by relative path for deterministic runs.
 */
export function walkMidi(root: string, maxBytes = 2_000_000): MidiFile[] {
  const acc: MidiFile[] = [];
  const rec = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        rec(abs);
      } else if (e.isFile() && MIDI_EXT.test(e.name)) {
        let size = 0;
        try {
          size = statSync(abs).size;
        } catch {
          continue;
        }
        if (size > maxBytes) continue;
        acc.push({ abs, rel: relative(root, abs) });
      }
    }
  };
  rec(root);
  acc.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return acc;
}
