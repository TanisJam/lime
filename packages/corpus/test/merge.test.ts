import { describe, it, expect } from "vitest";
import { planMerge, relabelBucket } from "../src/build/mergeBuckets.js";
import type { TaggedFile } from "../src/datasets/index.js";

const emopia: TaggedFile[] = [
  { path: "e1", bucket: "Q4", emotion: { valence: 0.6, arousal: -0.6 }, genre: "pop" },
  { path: "e2", bucket: "Q1", emotion: { valence: 0.6, arousal: 0.6 }, genre: "pop" },
];
const vgmidi: TaggedFile[] = [
  { path: "v1", bucket: "Q4", emotion: { valence: 1, arousal: -1 }, genre: "video-game" },
];
const lakh: TaggedFile[] = [{ path: "l1", bucket: "all", genre: "mixed" }];

describe("cross-dataset bucket merge", () => {
  it("relabels quadrants to semantic emotions", () => {
    expect(relabelBucket("Q1")).toBe("happy");
    expect(relabelBucket("Q4")).toBe("calm");
    expect(relabelBucket("all")).toBe("all"); // non-quadrant passes through
  });

  it("pools the same emotion across datasets and keeps non-emotion separate", () => {
    const plan = planMerge([
      { dataset: "emopia", files: emopia },
      { dataset: "vgmidi", files: vgmidi },
      { dataset: "lakh", files: lakh },
    ]);

    // All emotion files (2 EMOPIA + 1 VGMIDI), relabeled semantically.
    expect(plan.emotion.length).toBe(3);
    expect(new Set(plan.emotion.map((f) => f.bucket))).toEqual(new Set(["calm", "happy"]));

    // Q4 from EMOPIA + VGMIDI merged into one "calm" bucket.
    const calm = plan.emotion.filter((f) => f.bucket === "calm");
    expect(calm.length).toBe(2);
    expect(new Set(calm.map((f) => f.genre))).toEqual(new Set(["pop", "video-game"]));

    // Lakh (no emotion) stays its own pool; not mixed into emotion.
    expect(plan.nonEmotion).toEqual([{ dataset: "lakh", files: lakh }]);
    expect(plan.emotion.some((f) => f.path === "l1")).toBe(false);
  });
});
