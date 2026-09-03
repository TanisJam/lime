import { describe, it, expect } from "vitest";
import { BassGenerator } from "../src/bass/BassGenerator.js";
import { PhraseDirector } from "../src/phrase/PhrasePlan.js";
import type { PhrasePlan, MelodicActivity } from "../src/phrase/PhrasePlan.js";
import { PhrasePlanner } from "../src/phrase/PhrasePlanner.js";
import { makeHarmonicEvent } from "../src/harmony/Chord.js";
import { DEFAULT_STATE, applyPatch } from "../src/state/MusicalState.js";
import { SeededRandom } from "../src/random/SeededRandom.js";
import { FOUR_FOUR } from "../src/time/MusicalTime.js";
import type { BarContext } from "../src/orchestration/BarContext.js";

const director = new PhraseDirector();
const phrases = new PhrasePlanner({ phraseLengthBars: 4 });

/** Bass onset count for a bar whose plan carries a given melodic activity. */
function bassOnsets(activity: MelodicActivity): number {
  // Energy just above the eighth-note tier, so stepping the bass down one tier
  // (when the melody leads) is observable.
  const state = applyPatch(DEFAULT_STATE, { energy: 0.78, density: 0.7, complexity: 0.5 });
  const phrase = phrases.at(8); // a development phrase
  const basePlan = director.plan(state, phrase);
  const plan: PhrasePlan = { ...basePlan, melodicActivity: activity };
  const chord = makeHarmonicEvent({ bar: 0, durationBars: 1, degree: 1, keyPc: 0, mode: "major" });
  const ctx: BarContext = {
    bar: 8,
    barStartTick: 0,
    meter: FOUR_FOUR,
    state,
    chord,
    nextChord: makeHarmonicEvent({ bar: 1, durationBars: 1, degree: 5, keyPc: 0, mode: "major" }),
    phrase,
    phrasePlan: plan,
    rng: new SeededRandom("bass-melody"),
  };
  return new BassGenerator().generateBar(ctx).length;
}

describe("bass/melody relationship", () => {
  it("simplifies the bass when the melody is leading, fills when it rests", () => {
    const whenLeading = bassOnsets("lead");
    const whenResting = bassOnsets("tacet");
    // The bass leaves room while the melody carries the line, and fills the gap
    // when the melody sits out.
    expect(whenLeading).toBeLessThan(whenResting);
  });

  it("is deterministic", () => {
    expect(bassOnsets("lead")).toBe(bassOnsets("lead"));
  });
});
