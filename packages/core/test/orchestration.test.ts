import { describe, it, expect } from "vitest";
import { OrchestrationDirector } from "../src/orchestration/OrchestrationDirector.js";
import {
  MUSICAL_ROLES,
  ROLE_FOR_VOICE,
  VOICE_FOR_ROLE,
  isWiredRole,
  type MusicalRole,
} from "../src/orchestration/MusicalRole.js";
import { Arrangement } from "../src/orchestration/Arrangement.js";
import { PhraseDirector } from "../src/phrase/PhrasePlan.js";
import { PhrasePlanner } from "../src/phrase/PhrasePlanner.js";
import { FormDirector } from "../src/phrase/FormDirector.js";
import { DEFAULT_STATE, applyPatch } from "../src/state/MusicalState.js";

const phrases = new PhrasePlanner({ phraseLengthBars: 4 });
const phraseDir = new PhraseDirector();
const form = new FormDirector();

/** Plan one bar's orchestration for a given energy, via the real pipeline. */
function planAt(dir: OrchestrationDirector, bar: number, energy: number) {
  const state = applyPatch(DEFAULT_STATE, { energy, density: 0.5, complexity: 0.5 });
  const phrase = phrases.at(bar);
  const phrasePlan = phraseDir.plan(state, phrase);
  return dir.plan(state, phrasePlan, form.at(bar, 4));
}

describe("MusicalRole maps", () => {
  it("every wired role round-trips voice → role → voice", () => {
    for (const voice of ["bass", "pad", "melody", "percussion"] as const) {
      const role = ROLE_FOR_VOICE[voice];
      expect(VOICE_FOR_ROLE[role]).toBe(voice);
      expect(isWiredRole(role)).toBe(true);
    }
  });

  it("declares four wired roles and leaves the rest unwired", () => {
    const wired = MUSICAL_ROLES.filter(isWiredRole);
    expect(wired.sort()).toEqual(
      ["foundation", "harmonic-bed", "mid-rhythm", "primary-melody"].sort(),
    );
    expect(isWiredRole("counterline")).toBe(false);
    expect(VOICE_FOR_ROLE["ostinato" as MusicalRole]).toBeUndefined();
  });

  it("MUSICAL_ROLES has no duplicates", () => {
    expect(new Set(MUSICAL_ROLES).size).toBe(MUSICAL_ROLES.length);
  });
});

describe("OrchestrationDirector — active roles track the old Arrangement exactly", () => {
  it("produces the same voice set as a standalone Arrangement over a sweep", () => {
    const dir = new OrchestrationDirector();
    const ref = new Arrangement();
    // A sweep that crosses every gate up and back down, exercising hysteresis.
    const sweep = [0.1, 0.25, 0.4, 0.6, 0.6, 0.45, 0.3, 0.12, 0.5, 0.7, 0.2];
    for (let bar = 0; bar < sweep.length; bar++) {
      planAt(dir, bar, sweep[bar]!);
      ref.update(sweep[bar]!);
      const dirVoices = [...dir.activeVoices].sort();
      const refVoices = [...ref.current].sort();
      expect(dirVoices, `bar ${bar} @ e=${sweep[bar]}`).toEqual(refVoices);
    }
  });

  it("maps active roles back to exactly the active voices", () => {
    const dir = new OrchestrationDirector();
    const plan = planAt(dir, 4, 0.7);
    const voicesFromRoles = plan.activeRoles
      .map((r) => VOICE_FOR_ROLE[r])
      .filter((v): v is NonNullable<typeof v> => v !== undefined)
      .sort();
    expect(voicesFromRoles).toEqual([...dir.activeVoices].sort());
  });
});

describe("OrchestrationDirector — plan invariants", () => {
  it("is deterministic: identical inputs yield identical plans", () => {
    const a = planAt(new OrchestrationDirector(), 5, 0.65);
    const b = planAt(new OrchestrationDirector(), 5, 0.65);
    expect(a).toEqual(b);
  });

  it("focus is always an active role", () => {
    const dir = new OrchestrationDirector();
    for (let bar = 0; bar < 12; bar++) {
      const plan = planAt(dir, bar, 0.15 + (bar % 6) * 0.12);
      expect(plan.activeRoles).toContain(plan.focus);
    }
  });

  it("spends a shared activity budget summing to ~1 over active roles", () => {
    const dir = new OrchestrationDirector();
    const plan = planAt(dir, 6, 0.75);
    const total = plan.activeRoles.reduce((s, r) => s + (plan.activity[r] ?? 0), 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("puts exactly one role in the foreground (the focus)", () => {
    const dir = new OrchestrationDirector();
    const plan = planAt(dir, 6, 0.8);
    const fg = plan.activeRoles.filter((r) => plan.depth[r] === "foreground");
    expect(fg).toEqual([plan.focus]);
  });

  it("keeps prominence and activity within [0,1]", () => {
    const dir = new OrchestrationDirector();
    for (let bar = 0; bar < 8; bar++) {
      const plan = planAt(dir, bar, 0.2 + bar * 0.1);
      for (const r of plan.activeRoles) {
        expect(plan.prominence[r]!).toBeGreaterThanOrEqual(0);
        expect(plan.prominence[r]!).toBeLessThanOrEqual(1);
        expect(plan.activity[r]!).toBeGreaterThanOrEqual(0);
        expect(plan.activity[r]!).toBeLessThanOrEqual(1);
      }
    }
  });

  it("foregrounds the melody when it leads, the bed when it rests", () => {
    const dir = new OrchestrationDirector();
    // Energy high enough that melody is active; force lead vs tacet via plan.
    const state = applyPatch(DEFAULT_STATE, { energy: 0.7, density: 0.5 });
    const base = phraseDir.plan(state, phrases.at(4));
    const leadPlan = dir.plan(state, { ...base, melodicActivity: "lead" }, form.at(4, 4));
    expect(leadPlan.focus).toBe<MusicalRole>("primary-melody");

    const dir2 = new OrchestrationDirector();
    const tacetPlan = dir2.plan(state, { ...base, melodicActivity: "tacet" }, form.at(4, 4));
    expect(tacetPlan.focus).toBe<MusicalRole>("harmonic-bed");
  });
});
