import { describe, it, expect } from "vitest";
import { emopiaQuadrant, parseVgmidiCsv, quadrantOf } from "../src/datasets/index.js";
import { emotionToState, quadrantToEmotion } from "../src/style/emotionMapping.js";

describe("EMOPIA filename tagging", () => {
  it("extracts the quadrant from a filename", () => {
    expect(emopiaQuadrant("Q4_Ie5koh4qvJc_27.mid")).toBe("Q4");
    expect(emopiaQuadrant("/data/emopia/EMOPIA_1.0/Q1_abc_0.mid")).toBe("Q1");
    expect(emopiaQuadrant("nolabel.mid")).toBeNull();
  });

  it("maps each quadrant to a distinct emotion corner", () => {
    const q1 = emotionToState(quadrantToEmotion("Q1")); // happy
    const q3 = emotionToState(quadrantToEmotion("Q3")); // sad
    expect(q1.energy!).toBeGreaterThan(q3.energy!);
    expect(q1.valence!).toBeGreaterThan(q3.valence!);
  });
});

describe("VGMIDI CSV parsing", () => {
  const csv = [
    "id,series,console,game,piece,midi,valence,arousal",
    "8013,Banjo,N64,Banjo,Happy,labelled/phrases/a_0.mid,1,1",
    "8073,Banjo,N64,Banjo,Sad,labelled/phrases/b_0.mid,1,-1",
    "9001,X,PC,X,Tense,labelled/phrases/c_0.mid,-1,1",
  ].join("\n");

  it("parses rows with midi/valence/arousal", () => {
    const rows = parseVgmidiCsv(csv);
    expect(rows.length).toBe(3);
    expect(rows[0]!.midi).toBe("labelled/phrases/a_0.mid");
    expect(rows[0]!.valence).toBe(1);
    expect(rows[1]!.arousal).toBe(-1);
  });

  it("returns empty on malformed input", () => {
    expect(parseVgmidiCsv("")).toEqual([]);
    expect(parseVgmidiCsv("no,relevant,columns\n1,2,3")).toEqual([]);
  });

  it("assigns Russell quadrants by valence/arousal sign", () => {
    expect(quadrantOf(1, 1)).toBe("Q1"); // positive, high arousal
    expect(quadrantOf(-1, 1)).toBe("Q2"); // negative, high arousal
    expect(quadrantOf(-1, -1)).toBe("Q3"); // negative, low arousal
    expect(quadrantOf(1, -1)).toBe("Q4"); // positive, low arousal
  });
});
