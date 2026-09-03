import { describe, it, expect } from "vitest";
import { PhraseDirector } from "../src/phrase/PhrasePlan.js";
import { PhrasePlanner } from "../src/phrase/PhrasePlanner.js";
import { DEFAULT_STATE, applyPatch } from "../src/state/MusicalState.js";
import type { MusicalState } from "../src/state/MusicalState.js";

const director = new PhraseDirector();
const phrases = new PhrasePlanner({ phraseLengthBars: 4 });

/** Grammar over a 4-bar cycle: statement, variation, development, cadence. */
const STATEMENT_BAR = 0;
const VARIATION_BAR = 4;
const DEVELOPMENT_BAR = 8;
const CADENCE_START_BAR = 12;

function state(patch: Partial<MusicalState>): MusicalState {
  return applyPatch(DEFAULT_STATE, patch);
}

describe("PhraseDirector", () => {
  it("is deterministic: same inputs yield a deep-equal plan", () => {
    const s = state({ energy: 0.5, tension: 0.3 });
    const phrase = phrases.at(DEVELOPMENT_BAR + 1);
    expect(director.plan(s, phrase)).toEqual(director.plan(s, phrase));
  });

  it("maps position from 0 at the first bar to 1 at the last", () => {
    const s = state({ energy: 0.5 });
    expect(director.plan(s, phrases.at(STATEMENT_BAR)).position).toBe(0);
    expect(director.plan(s, phrases.at(STATEMENT_BAR + 3)).position).toBe(1);
    expect(director.plan(s, phrases.at(STATEMENT_BAR + 1)).position).toBeCloseTo(1 / 3);
  });

  it("carries the phrase role through onto the plan", () => {
    const s = state({ energy: 0.5 });
    expect(director.plan(s, phrases.at(STATEMENT_BAR)).role).toBe("statement");
    expect(director.plan(s, phrases.at(VARIATION_BAR)).role).toBe("variation");
    expect(director.plan(s, phrases.at(DEVELOPMENT_BAR)).role).toBe("development");
    expect(director.plan(s, phrases.at(CADENCE_START_BAR)).role).toBe("cadence");
  });

  it("builds energy across a development and releases it into a cadence", () => {
    const s = state({ energy: 0.5, tension: 0.4 });
    const dev = director.plan(s, phrases.at(DEVELOPMENT_BAR));
    expect(dev.energyEnd).toBeGreaterThan(dev.energyStart);
    expect(dev.rhythmicDensityDirection).toBe("rising");
    expect(dev.melodicRegisterDirection).toBe("rising");

    const cad = director.plan(s, phrases.at(CADENCE_START_BAR));
    expect(cad.energyEnd).toBeLessThan(cad.energyStart);
    expect(cad.rhythmicDensityDirection).toBe("falling");
    expect(cad.melodicRegisterDirection).toBe("falling");
  });

  it("interpolates energy along the arc between its endpoints", () => {
    const s = state({ energy: 0.5, tension: 0.4 });
    const first = director.plan(s, phrases.at(DEVELOPMENT_BAR));
    const last = director.plan(s, phrases.at(DEVELOPMENT_BAR + 3));
    expect(first.energy).toBeCloseTo(first.energyStart);
    expect(last.energy).toBeCloseTo(last.energyEnd);
    expect(last.energy).toBeGreaterThan(first.energy);
  });

  it("signals cadence intent only inside a cadence phrase", () => {
    const s = state({ energy: 0.5 });
    expect(director.plan(s, phrases.at(STATEMENT_BAR)).cadenceIntent).toBe("none");
    expect(director.plan(s, phrases.at(CADENCE_START_BAR)).cadenceIntent).toBe("none");
    expect(director.plan(s, phrases.at(CADENCE_START_BAR + 2)).cadenceIntent).toBe(
      "approaching",
    );
    expect(director.plan(s, phrases.at(CADENCE_START_BAR + 3)).cadenceIntent).toBe(
      "resolving",
    );
  });

  it("points harmony home whenever a cadence is in play", () => {
    const s = state({ energy: 0.5, tension: 0.4 });
    expect(director.plan(s, phrases.at(CADENCE_START_BAR + 2)).harmonicDirection).toBe(
      "falling",
    );
    expect(director.plan(s, phrases.at(CADENCE_START_BAR + 3)).harmonicDirection).toBe(
      "falling",
    );
  });

  it("clamps the energy and tension arc endpoints to 0..1", () => {
    const hot = director.plan(state({ energy: 0.98, tension: 0.97 }), phrases.at(DEVELOPMENT_BAR));
    expect(hot.energyEnd).toBeLessThanOrEqual(1);
    expect(hot.tensionEnd).toBeLessThanOrEqual(1);

    const cold = director.plan(state({ energy: 0.02, tension: 0.05 }), phrases.at(CADENCE_START_BAR));
    expect(cold.energyEnd).toBeGreaterThanOrEqual(0);
    expect(cold.tensionEnd).toBeGreaterThanOrEqual(0);
  });

  it("derives a phrase shape from role and tension", () => {
    const calm = state({ energy: 0.5, tension: 0.2 });
    expect(director.plan(calm, phrases.at(STATEMENT_BAR)).shape).toBe("statement");
    expect(director.plan(calm, phrases.at(VARIATION_BAR)).shape).toBe("statement");
    expect(director.plan(calm, phrases.at(DEVELOPMENT_BAR)).shape).toBe("development");
    expect(director.plan(calm, phrases.at(CADENCE_START_BAR)).shape).toBe("cadence");
    // High tension takes over as unease, except on a cadence phrase.
    const tense = state({ energy: 0.5, tension: 0.7 });
    expect(director.plan(tense, phrases.at(STATEMENT_BAR)).shape).toBe("unease");
    expect(director.plan(tense, phrases.at(DEVELOPMENT_BAR)).shape).toBe("unease");
    expect(director.plan(tense, phrases.at(CADENCE_START_BAR)).shape).toBe("cadence");
  });

  it("scales the arc down when there is little energy to build on", () => {
    const faint = director.plan(state({ energy: 0.06 }), phrases.at(DEVELOPMENT_BAR + 3));
    const full = director.plan(state({ energy: 0.5 }), phrases.at(DEVELOPMENT_BAR + 3));
    // A near-silent passage barely breathes; a mid passage gets the full build.
    expect(faint.energyEnd - faint.energyStart).toBeLessThan(full.energyEnd - full.energyStart);
    expect(faint.energyEnd).toBeLessThan(0.22); // stays under the voices' silence gate
  });

  it("plans melodic activity from energy, leaving quiet phrases tacet", () => {
    const phrase = phrases.at(STATEMENT_BAR);
    expect(director.plan(state({ energy: 0.1 }), phrase).melodicActivity).toBe("tacet");
    expect(director.plan(state({ energy: 0.3 }), phrase).melodicActivity).toBe("sparse");
    expect(director.plan(state({ energy: 0.7 }), phrase).melodicActivity).toBe("lead");
    // A cadence stays sparse even with energy, to leave room to resolve.
    expect(
      director.plan(state({ energy: 0.7 }), phrases.at(CADENCE_START_BAR)).melodicActivity,
    ).toBe("sparse");
  });
});
