import { describe, it, expect } from "vitest";
import { FormDirector } from "../src/phrase/FormDirector.js";
import { LimeEngine } from "../src/engine/LimeEngine.js";
import { testStyle } from "./helpers.js";

const form = new FormDirector();
const LEN = 8; // phrase length used for the form clock

describe("FormDirector", () => {
  it("runs a full arch: intro low, climax high, coda low", () => {
    const intro = form.at(0, LEN);
    const climax = form.at(40, LEN); // stage index 5
    const coda = form.at(56, LEN); // stage index 7
    expect(intro.section).toBe("intro");
    expect(climax.section).toBe("climax");
    expect(coda.section).toBe("coda");
    expect(climax.intensity).toBeGreaterThan(intro.intensity);
    expect(climax.intensity).toBeGreaterThan(coda.intensity);
  });

  it("expresses intensity as a deviation centred on the form mean", () => {
    // Deviation and intensity move together; the climax deviates positive, the
    // intro negative.
    expect(form.at(40, LEN).deviation).toBeGreaterThan(0);
    expect(form.at(0, LEN).deviation).toBeLessThan(0);
  });

  it("interpolates smoothly between stages and cycles", () => {
    const mid = form.at(4, LEN); // halfway through the intro stage
    expect(mid.intensity).toBeGreaterThan(form.at(0, LEN).intensity);
    // The form repeats: bar 64 is a new cycle's intro.
    expect(form.at(64, LEN).section).toBe("intro");
    expect(form.at(64, LEN).intensity).toBeCloseTo(form.at(0, LEN).intensity);
  });

  it("is deterministic", () => {
    expect(form.at(37, LEN)).toEqual(form.at(37, LEN));
  });
});

describe("form arc — end to end", () => {
  it("builds and releases the texture at a constant host state", () => {
    // Host energy never changes; any arc must come from the form alone.
    const engine = new LimeEngine({
      seed: "form-arc",
      style: testStyle, // 4-bar phrases → form cycle is 32 bars
      initialState: { energy: 0.5, tension: 0.3, density: 0.5, complexity: 0.4, tempo: 84 },
    });
    const voiceCount: number[] = [];
    for (let bar = 0; bar < 32; bar++) {
      const voices = new Set(engine.composeBar(bar).map((e) => e.voice));
      voiceCount.push(voices.size);
    }
    // The climax stage (index 5 of 8 → bars 20-23) is fuller than the intro.
    const introVoices = Math.max(voiceCount[0]!, voiceCount[1]!, voiceCount[2]!, voiceCount[3]!);
    const climaxVoices = Math.max(
      voiceCount[20]!,
      voiceCount[21]!,
      voiceCount[22]!,
      voiceCount[23]!,
    );
    expect(climaxVoices).toBeGreaterThan(introVoices);
  });
});
