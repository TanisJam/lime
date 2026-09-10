/**
 * Per-genre timbre/state tables shared by the Node-side judge tools.
 *
 * Extracted from render.mjs so the renderer, the symbolic feature extractor and
 * anything added later describe the same genres. `apps/demo/src/render.ts` keeps
 * its own copy of GM/STATE/NAMES because it is bundled for the browser and
 * cannot import from here — but the per-genre style TUNING (defaultMode,
 * harmonyMotion, melody rebalancing, grooveVariation, etc.) lives in exactly
 * one place, `@lime/styles`' `applyGenreTuning`, and every consumer (this
 * file, the demo, its offline render page) calls that instead of hand-copying
 * an override table. See `packages/styles/src/genreTuning.ts` for why.
 */

import * as styles from "../../packages/styles/dist/index.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");

export const GM = styles.GM_PROGRAMS;

// Per-genre initial state (tempo + mood) — MIRROR of GENRE_STATE in main.ts.
export const STATE = {
  "genre-classical": { energy: 0.5, valence: 0.6, tension: 0.3, density: 0.45, complexity: 0.4, instability: 0.25, brightness: 0.55, tempo: 90 },
  "genre-pop": { energy: 0.7, valence: 0.72, tension: 0.3, density: 0.55, complexity: 0.35, instability: 0.25, brightness: 0.6, tempo: 118 },
  "genre-rock-pop": { energy: 0.8, valence: 0.25, tension: 0.6, density: 0.6, complexity: 0.55, instability: 0.42, brightness: 0.38, tempo: 126 },
  "genre-hiphop": { energy: 0.8, valence: 0.4, tension: 0.35, density: 0.6, complexity: 0.35, instability: 0.3, brightness: 0.45, tempo: 88 },
  "genre-electronic": { energy: 0.76, valence: 0.45, tension: 0.4, density: 0.65, complexity: 0.45, instability: 0.35, brightness: 0.55, tempo: 126 },
  "genre-jazz": { energy: 0.55, valence: 0.5, tension: 0.35, density: 0.5, complexity: 0.55, instability: 0.4, brightness: 0.55, tempo: 130 },
  "genre-blues": { energy: 0.55, valence: 0.3, tension: 0.4, density: 0.5, complexity: 0.3, instability: 0.15, brightness: 0.52, tempo: 95 },
  "genre-folk": { energy: 0.45, valence: 0.55, tension: 0.25, density: 0.4, complexity: 0.3, instability: 0.2, brightness: 0.55, tempo: 100 },
  "genre-latin": { energy: 0.72, valence: 0.65, tension: 0.35, density: 0.6, complexity: 0.45, instability: 0.35, brightness: 0.6, tempo: 105 },
  "genre-funk": { energy: 0.72, valence: 0.55, tension: 0.35, density: 0.62, complexity: 0.45, instability: 0.35, brightness: 0.55, tempo: 108 },
  "genre-metal": { energy: 0.9, valence: 0.28, tension: 0.62, density: 0.72, complexity: 0.5, instability: 0.4, brightness: 0.42, tempo: 160 },
  "genre-ambient": { energy: 0.32, valence: 0.5, tension: 0.2, density: 0.3, complexity: 0.25, instability: 0.15, brightness: 0.5, tempo: 68 },
};

// GM program number → human name, for the programs LIME actually uses.
export const GM_NAMES = styles.GM_PROGRAM_NAMES;
export const gmName = styles.gmProgramName;

export const NAMES = {
  "genre-classical": "Classical", "genre-pop": "Pop", "genre-rock-pop": "Rock",
  "genre-hiphop": "Hip-hop", "genre-electronic": "Electronic", "genre-jazz": "Jazz",
  "genre-blues": "Blues", "genre-folk": "Folk", "genre-latin": "Latin",
  "genre-funk": "Funk/R&B", "genre-metal": "Metal", "genre-ambient": "Ambient",
};

// Resolve a StylePack by id: authored packs from @lime/styles, rock from corpus.
export const AUTHORED = {
  "genre-classical": styles.classicalPack, "genre-pop": styles.popPack,
  "genre-hiphop": styles.hiphopPack, "genre-electronic": styles.electronicPack,
  "genre-jazz": styles.jazzPack, "genre-blues": styles.bluesPack,
  "genre-folk": styles.folkPack, "genre-latin": styles.latinPack,
  "genre-funk": styles.funkPack, "genre-metal": styles.metalPack,
  "genre-ambient": styles.ambientPack,
};
/**
 * Resolve a StylePack by id: rock is corpus-derived (its own JSON has no
 * authored StylePack in `@lime/styles`), the rest are authored. Either way,
 * the genre's canonical tuning — defaultMode, harmonyMotion, melody
 * rebalancing, grooveVariation, etc. — is applied by `@lime/styles`'
 * `applyGenreTuning`, the single place that merge is expressed. See
 * `packages/styles/src/genreTuning.ts`.
 */
export function stylePack(id) {
  let style;
  if (id === "genre-rock-pop") {
    style = JSON.parse(readFileSync(join(REPO, "packages/corpus/generated/genre-rock-pop.json"), "utf8")).style;
  } else {
    style = AUTHORED[id];
  }
  return styles.applyGenreTuning(style);
}

/** Voice order written into the Standard MIDI File. */
export const TRACK_ORDER = ["pad", "bass", "melody", "motion", "percussion", "texture"];
