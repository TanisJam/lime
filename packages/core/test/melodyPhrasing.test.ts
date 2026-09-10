import { describe, it, expect } from "vitest";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";
import type { StylePack } from "../src/style/StylePack.js";
import type { MusicalStatePatch } from "../src/state/MusicalState.js";

// testStyle has 4-bar phrases and the grammar statement/variation/development/
// cadence (see themeClarity.test.ts), so barInPhrase = bar % 4.
const PHRASE_LEN = 4;
const BARS = 64;

/**
 * Melody presence per bar, plus its position within its phrase. Energy 0.6 is
 * comfortably above the tacet threshold (0.22) even after the form's arc
 * shifts it (LimeEngine.applyForm, spread ±0.7 gated by energy — see
 * FormDirector.ts / LimeEngine.ts), so no whole phrase goes silent here: any
 * rest observed is the per-bar phrase-boundary decision under test, not the
 * separate tacet mechanism.
 */
function melodyPresence(seed: string): { barInPhrase: number; sounds: boolean }[] {
  const engine = new LimeEngine({
    seed,
    style: testStyle,
    initialState: { energy: 0.6, tension: 0.3, density: 0.5, complexity: 0.4, tempo: 84 },
  });
  const out: { barInPhrase: number; sounds: boolean }[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const sounds = engine.composeBar(bar).some((e) => e.voice === "melody");
    out.push({ barInPhrase: bar % PHRASE_LEN, sounds });
  }
  return out;
}

describe("melody rests are phrase-structured, not a per-bar coin flip", () => {
  it("never rests in the interior of a phrase (barInPhrase 0 or 1)", () => {
    const presence = melodyPresence("phrase-rest");
    const interior = presence.filter((p) => p.barInPhrase === 0 || p.barInPhrase === 1);
    expect(interior.length).toBeGreaterThan(0);
    for (const p of interior) expect(p.sounds).toBe(true);
  });

  it("still takes real rests — clustered at the phrase boundary", () => {
    const presence = melodyPresence("phrase-rest");
    const rests = presence.filter((p) => !p.sounds);
    // The melody does breathe somewhere...
    expect(rests.length).toBeGreaterThan(0);
    // ...and everywhere it does, it's at the boundary (barInPhrase 2 or 3 —
    // the cadence approach or the phrase's last bar), never mid-phrase.
    for (const r of rests) expect(r.barInPhrase).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic", () => {
    const a = melodyPresence("phrase-rest-det").map((p) => p.sounds);
    const b = melodyPresence("phrase-rest-det").map((p) => p.sounds);
    expect(a).toEqual(b);
  });
});

/**
 * Melody note count per bar, counted directly from what composeBar emits for
 * that bar (not re-derived from event.time, which the humanizer can nudge by
 * a few ticks) — the measurement approach the brief calls for, and the same
 * one the manual density script used while tuning this change.
 */
function melodyNoteCounts(style: StylePack, state: MusicalStatePatch, seed: string): number[] {
  const engine = new LimeEngine({ seed, style, initialState: state });
  const counts: number[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    counts.push(engine.composeBar(bar).filter((e) => e.voice === "melody").length);
  }
  return counts;
}

/** Total melody notes across many seeds, so a single seed's RNG cascade (see
 * generateBar's single per-bar stream) can't flip the comparison — the
 * direction is real but its size varies seed to seed, so pooling many seeds
 * is what makes the comparison reproducible. */
function pooledNoteCount(style: StylePack, state: MusicalStatePatch, seeds: readonly string[]): number {
  let total = 0;
  for (const seed of seeds) {
    for (const c of melodyNoteCounts(style, state, seed)) total += c;
  }
  return total;
}

const SEEDS = Array.from({ length: 12 }, (_, i) => `density-${i}`);

describe("melody density tracks activity, not a flat constant", () => {
  const BUSY: MusicalStatePatch = {
    energy: 0.88, tension: 0.4, valence: 0.4, density: 0.75,
    complexity: 0.5, instability: 0.35, tempo: 108,
  };
  // Just above the tacet cutoff even at the bottom of the form's arc, but
  // below the sparse/lead boundary (0.4) — the melody plays, but thin.
  const CALM: MusicalStatePatch = {
    energy: 0.41, tension: 0.2, valence: 0.4, density: 0.3,
    complexity: 0.25, instability: 0.1, tempo: 84,
  };

  it("plays more notes overall when the passage is busy than when it's calm", () => {
    const busy = pooledNoteCount(testStyle, BUSY, SEEDS);
    const calm = pooledNoteCount(testStyle, CALM, SEEDS);
    expect(busy).toBeGreaterThan(calm);
  });

  it("is deterministic", () => {
    const a = melodyNoteCounts(testStyle, BUSY, "density-det");
    const b = melodyNoteCounts(testStyle, BUSY, "density-det");
    expect(a).toEqual(b);
  });
});

describe("motifDevelopment default is reachable", () => {
  // A style that says nothing about motifDevelopment still gets some (the
  // MelodyGenerator constructor's `?? 0.3` fallback) — a style that
  // explicitly asks for 0 gets the old, undeveloped behaviour back. Pooled
  // over many seeds for the same reason as above: the per-bar RNG stream
  // makes any single seed's exact note count noisy, but the direction — more
  // development odds, so more material survives to sound — is consistent.
  const STATE: MusicalStatePatch = {
    energy: 0.8, tension: 0.4, valence: 0.4, density: 0.65,
    complexity: 0.5, instability: 0.3, tempo: 100,
  };
  const offStyle: StylePack = { ...testStyle, melody: { motifDevelopment: 0 } };
  const DEV_SEEDS = Array.from({ length: 12 }, (_, i) => `dev-${i}`);

  it("develops the line more than an explicit motifDevelopment: 0", () => {
    const withDefault = pooledNoteCount(testStyle, STATE, DEV_SEEDS);
    const withoutDev = pooledNoteCount(offStyle, STATE, DEV_SEEDS);
    expect(withDefault).toBeGreaterThan(withoutDev);
  });
});
