import { describe, it, expect } from "vitest";
import {
  FOUR_FOUR,
  TICKS_PER_QUARTER,
  ticksPerBar,
  ticksPerBeat,
  toBarPosition,
  beatTime,
  barOf,
  ticksToSeconds,
} from "../src/time/MusicalTime.js";

describe("MusicalTime", () => {
  it("computes 4/4 bar and beat sizes", () => {
    expect(ticksPerBeat(FOUR_FOUR)).toBe(TICKS_PER_QUARTER);
    expect(ticksPerBar(FOUR_FOUR)).toBe(TICKS_PER_QUARTER * 4);
  });

  it("round-trips tick ↔ bar position", () => {
    const perBar = ticksPerBar(FOUR_FOUR);
    const time = perBar * 3 + TICKS_PER_QUARTER * 2 + 100;
    const pos = toBarPosition(time, FOUR_FOUR);
    expect(pos.bar).toBe(3);
    expect(pos.beat).toBe(2);
    expect(pos.tick).toBe(100);
  });

  it("locates beats and bars", () => {
    expect(beatTime(2, 1, FOUR_FOUR)).toBe(ticksPerBar(FOUR_FOUR) * 2 + TICKS_PER_QUARTER);
    expect(barOf(ticksPerBar(FOUR_FOUR) * 5 + 10, FOUR_FOUR)).toBe(5);
  });

  it("converts ticks to seconds by tempo", () => {
    // One quarter at 120 BPM = 0.5s.
    expect(ticksToSeconds(TICKS_PER_QUARTER, 120)).toBeCloseTo(0.5, 6);
    // One bar (4 quarters) at 60 BPM = 4s.
    expect(ticksToSeconds(ticksPerBar(FOUR_FOUR), 60)).toBeCloseTo(4, 6);
  });
});
