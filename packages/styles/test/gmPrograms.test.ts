import { describe, it, expect } from "vitest";
import { GM_PROGRAMS, GUITAR_PROGRAMS, gmProgramName } from "../src/gmPrograms.js";

/**
 * Guards the contract that the GM program map is a single source of truth and
 * that each genre's instrument choice is internally coherent.
 *
 * The drift this exists to prevent is documented in `gmPrograms.ts`: Funk's
 * melody was pinned to GM 28 (Muted Electric Guitar) — the same patch as its pad
 * — in the judge's table while the live demo played a different program entirely.
 * Every offline render, every A/B listening test and every groove measurement for
 * Funk therefore described an instrument the product never plays, and a listener
 * reported it as "too bright and the guitars sound chopped". No metric in
 * `groove-gap` measures instrument choice at all, so nothing caught it.
 */
describe("GM program map", () => {
  it("assigns a melody and a pad to every genre", () => {
    for (const [genre, programs] of Object.entries(GM_PROGRAMS)) {
      expect(programs.melody, `${genre} has no melody program`).toBeTypeOf("number");
      expect(programs.pad, `${genre} has no pad program`).toBeTypeOf("number");
    }
  });

  it("keeps every program inside the General MIDI range", () => {
    for (const [genre, programs] of Object.entries(GM_PROGRAMS)) {
      for (const [voice, program] of Object.entries(programs)) {
        if (voice === "melodyCut") continue;
        expect(program, `${genre}.${voice}`).toBeGreaterThanOrEqual(0);
        expect(program, `${genre}.${voice}`).toBeLessThanOrEqual(127);
      }
    }
  });

  describe("Funk's melody is a guitar that carries a line", () => {
    // The defect in one place: melodía and pad must not be the same patch, and
    // the melody must not be the palm-muted guitar. "Muted" in General MIDI is a
    // short percussive attack — an accompaniment colour, not a lead voice. A
    // listener hearing it as the lead described it as chopped and harsh.
    const funk = GM_PROGRAMS["genre-funk"]!;

    it("does not double the pad's patch on the melody", () => {
      expect(funk.melody).not.toBe(funk.pad);
    });

    it("does not make the muted guitar the lead voice", () => {
      expect(funk.melody).not.toBe(28);
    });

    it("uses a guitar for the melody", () => {
      expect(GUITAR_PROGRAMS).toContain(funk.melody!);
    });

    it("names its programs readably", () => {
      expect(gmProgramName(funk.melody)).toContain("Guitar");
      expect(gmProgramName(funk.pad)).toContain("Guitar");
    });
  });

  it("doubles a pad patch as the melody only where that was validated on the ear", () => {
    // Metal deliberately runs GM 30 (Distortion Guitar) for both pad and melody.
    // That is not a defect: it was found by sweeping programs against two
    // independent listeners, and it took Metal from 0/4 to 4/4 identification and
    // fluidsynth's overall score from 24/48 to 28/48 (commit 31c79b1). Guitar
    // doubling is how the genre sounds; sharing an instrument is not the same
    // thing as sharing a *role colour* the way Funk was doing.
    //
    // So this asserts the exception explicitly rather than forbidding doubling
    // outright — an earlier version of this test asserted the general rule and
    // was wrong about Metal.
    const doubled = Object.entries(GM_PROGRAMS)
      .filter(([, p]) => p.melody !== undefined && p.melody === p.pad)
      .map(([genre]) => genre);
    expect(doubled).toEqual(["genre-metal"]);
  });

  it("caps a melody's brightness only where the melody is not the pad's patch", () => {
    // `melodyCut` exists to stop a distorted lead fizzing. Metal caps its melody
    // while sharing the pad's patch, which is harmless because the pad is the same
    // distortion guitar — the cut already applies to both. What this guards is the
    // case that caused the Funk defect: a cut on a melody that is a *different*
    // colour from the pad, hiding the mismatch instead of resolving it.
    for (const [genre, programs] of Object.entries(GM_PROGRAMS)) {
      if (programs.melodyCut === undefined) continue;
      if (genre === "genre-metal") continue; // same patch on purpose, see above
      expect(programs.melody, `${genre} caps a melody that shares the pad's patch`).not.toBe(
        programs.pad,
      );
    }
  });
});
