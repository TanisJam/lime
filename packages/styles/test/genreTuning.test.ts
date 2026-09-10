import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { StylePack } from "@lime/core";
import {
  GENRE_TUNING,
  ROCK_TUNING,
  applyGenreTuning,
  metalPack,
  latinPack,
  folkPack,
  bluesPack,
  type GenreTuning,
} from "../src/index.js";

/**
 * This suite guards against the exact failure this module was built to fix:
 * an application-layer override that silently restates a value the
 * StylePack already provides. That is precisely how bug #1 happened —
 * `grooveVariation` sat only in a hand-maintained override table for rock
 * and metal, so when it was later added to the StylePacks themselves
 * (metal's `grooveVariation: 0.4` in genres.ts), nobody noticed the override
 * had become a redundant, driftable copy of a value the library already got
 * right. The next time a value like that migrates into a StylePack, this
 * test forces its tuning entry to be deleted instead of quietly kept.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// Rock has no authored StylePack (see genres.ts) — its base pack is the
// corpus-generated JSON, exactly as `applyGenreTuning`'s consumers use it.
const ROCK_JSON = join(HERE, "../../corpus/generated/genre-rock-pop.json");
const rockBase: StylePack = JSON.parse(readFileSync(ROCK_JSON, "utf8")).style;

/** Genre id → the real base StylePack its canonical tuning is layered onto. */
const BASES: Record<string, StylePack> = {
  "genre-rock-pop": rockBase,
  "genre-metal": metalPack,
  "genre-latin": latinPack,
  "genre-folk": folkPack,
  "genre-blues": bluesPack,
};

/**
 * Dotted paths ("harmony.harmonyMotion") in `tuning` whose value already
 * equals the base pack's own value at that path — an override the base pack
 * no longer needs, and therefore dead weight that can only drift stale.
 */
function redundantTuningPaths(base: StylePack, tuning: GenreTuning): string[] {
  const found: string[] = [];
  const check = (path: string, tuned: unknown, baseValue: unknown): void => {
    if (tuned === undefined) return;
    if (JSON.stringify(tuned) === JSON.stringify(baseValue)) found.push(path);
  };

  check("defaultMode", tuning.defaultMode, base.defaultMode);
  check("bassStyle", tuning.bassStyle, base.bassStyle);
  for (const [key, value] of Object.entries(tuning.harmony ?? {})) {
    check(`harmony.${key}`, value, (base.harmony as Record<string, unknown> | undefined)?.[key]);
  }
  for (const [key, value] of Object.entries(tuning.melody ?? {})) {
    check(`melody.${key}`, value, (base.melody as Record<string, unknown> | undefined)?.[key]);
  }
  for (const [key, value] of Object.entries(tuning.rhythm ?? {})) {
    check(`rhythm.${key}`, value, (base.rhythm as Record<string, unknown> | undefined)?.[key]);
  }
  return found;
}

describe("GENRE_TUNING carries no value its base StylePack already sets", () => {
  for (const [id, tuning] of Object.entries(GENRE_TUNING)) {
    it(`${id}`, () => {
      const base = BASES[id];
      if (!base) throw new Error(`no base StylePack wired up for "${id}" in this test`);

      const redundant = redundantTuningPaths(base, tuning);
      expect(
        redundant,
        `${id}'s tuning restates ${JSON.stringify(redundant)}, which the base StylePack ` +
          `already sets to the same value. Delete the redundant key from genreTuning.ts — ` +
          `keeping it only risks it silently drifting out of sync with the library again.`,
      ).toEqual([]);
    });
  }
});

describe("rock's bass style", () => {
  it("ROCK_TUNING does not override bassStyle", () => {
    // An earlier version of this table set bassStyle: "default" here,
    // silently discarding the corpus pack's own "root-drive" (see the
    // measured comparison in genreTuning.ts). This guards against
    // reintroducing that override.
    expect(ROCK_TUNING.bassStyle).toBeUndefined();
  });

  it("applyGenreTuning leaves the corpus pack's root-drive bass in place", () => {
    expect(rockBase.bassStyle).toBe("root-drive");
    expect(applyGenreTuning(rockBase).bassStyle).toBe("root-drive");
  });
});

describe("applyGenreTuning", () => {
  it("is a no-op for a genre with no tuning entry", () => {
    const untuned: StylePack = { ...metalPack, id: "genre-pop" };
    expect(applyGenreTuning(untuned)).toBe(untuned);
  });

  it("deep-merges nested config instead of replacing it wholesale", () => {
    const tuned = applyGenreTuning(rockBase);
    // The corpus-derived onsetProfile must survive the rhythm merge — only
    // grooveVariation is added by tuning.
    expect(tuned.rhythm?.onsetProfile).toEqual(rockBase.rhythm?.onsetProfile);
    expect(tuned.rhythm?.grooveVariation).toBe(0.5);
    // Likewise the corpus-derived harmony transitions must survive the
    // harmony merge — only harmonyMotion is added.
    expect(tuned.harmony?.transitions).toEqual(rockBase.harmony?.transitions);
    expect(tuned.harmony?.harmonyMotion).toBe(0.8);
  });
});
