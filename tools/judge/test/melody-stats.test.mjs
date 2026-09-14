import assert from "node:assert/strict";
import test from "node:test";

import { detectMelody, melodyStats } from "../melody-stats.mjs";

const EPSILON = 1e-9;

function closeTo(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

/** 4/4 at ppq 480: beat 480 ticks, bar 1920 ticks, 16th-cell 120 ticks. */
const PPQ = 480;
const TIME_SIGNATURE = { numerator: 4, denominator: 4 };
const CELL = 120; // barTicks / 16

/**
 * Builds one voice's notes from an interval script rather than hand-listing
 * ticks: `gaps` is the tick delta between one onset and the next (0 makes a
 * "bunched" onset for monophony purposes, since it is < CELL / 2), and
 * `pitch` is the absolute pitch of each note in order.
 */
function buildVoice({ track, program, pitches, gaps, duration = 10, isPercussion = false }) {
  const notes = [];
  let start = 0;
  for (let i = 0; i < pitches.length; i++) {
    notes.push({ start, duration, pitch: pitches[i], velocity: 0.8, track, program, isPercussion });
    if (i < gaps.length) start += gaps[i];
  }
  return notes;
}

function score(notes, overrides = {}) {
  return { ppq: PPQ, tempoBpm: 120, timeSignature: TIME_SIGNATURE, notes, ...overrides };
}

test("detectMelody picks the monophonic upper voice over a polyphonic strummed voice and a bass voice", () => {
  // Melody: 50 well-separated onsets (gap 240 >> CELL/2), fully monophonic.
  const melody = buildVoice({
    track: 1,
    program: 0,
    pitches: new Array(50).fill(72),
    gaps: new Array(49).fill(240),
  });
  // Strummed accompaniment: 60 onsets, 40 of the 59 gaps are simultaneous
  // (gap 0), so monophony = 1 - 40/59 ≈ 0.32 — well under the 0.8 floor.
  // Pitched higher than the melody, to prove it loses on monophony, not pitch.
  const strummed = buildVoice({
    track: 2,
    program: 25,
    pitches: new Array(60).fill(80),
    gaps: [...new Array(40).fill(0), ...new Array(19).fill(240)],
  });
  // Bass: fully monophonic and plenty of notes, but every note sits in the
  // GM bass program range, so the "every note is a bass program" rule drops
  // it regardless of monophony or pitch.
  const bass = buildVoice({
    track: 3,
    program: 33,
    pitches: new Array(45).fill(40),
    gaps: new Array(44).fill(240),
  });

  const winner = detectMelody([...melody, ...strummed, ...bass], CELL);
  assert.equal(winner.key, "1/0");
});

test("detectMelody falls back to the highest monophony when no voice reaches 0.8", () => {
  // Voice A: 50 notes, 20 of 49 gaps bunched -> monophony = 1 - 20/49 ≈ 0.592.
  const voiceA = buildVoice({
    track: 1,
    program: 0,
    pitches: new Array(50).fill(60),
    gaps: [...new Array(20).fill(0), ...new Array(29).fill(240)],
  });
  // Voice B: 50 notes, 30 of 49 gaps bunched -> monophony = 1 - 30/49 ≈ 0.388.
  // Pitched higher than A, to prove the fallback ranks by monophony, not pitch.
  const voiceB = buildVoice({
    track: 2,
    program: 4,
    pitches: new Array(50).fill(80),
    gaps: [...new Array(30).fill(0), ...new Array(19).fill(240)],
  });

  const winner = detectMelody([...voiceA, ...voiceB], CELL);
  assert.equal(winner.key, "1/0");
});

test("melChordTone counts a melody note on the implied third over a bare fifth bed, and rejects a foreign pitch class", () => {
  // Accompaniment: a static power chord (root C=36, fifth G=43) sounding
  // under the whole window — no third, so only the implied-third clause can
  // credit a melody note landing on E.
  const accompaniment = [
    { start: 0, duration: 1_000_000, pitch: 36, velocity: 0.8, track: 9, program: 33, isPercussion: false },
    { start: 0, duration: 1_000_000, pitch: 43, velocity: 0.8, track: 9, program: 33, isPercussion: false },
  ];

  // 38 baseline melody onsets on the chord root's pitch class (always a
  // chord tone), one onset on the implied major third (E, pc 4 = lowPc 0 + 4),
  // and one onset on a clearly foreign pitch class (D, pc 2 - not the root,
  // fifth, or either implied-third pitch class, and not a semitone from
  // either bed note so it cannot also register as a clash).
  const baseline = buildVoice({
    track: 1,
    program: 4,
    pitches: new Array(38).fill(60), // pc 0, matches the bed's root
    gaps: new Array(37).fill(240),
  });
  const impliedThird = { start: 38 * 240, duration: 10, pitch: 64, velocity: 0.8, track: 1, program: 4, isPercussion: false }; // pc 4
  const foreign = { start: 39 * 240, duration: 10, pitch: 62, velocity: 0.8, track: 1, program: 4, isPercussion: false }; // pc 2

  const stats = melodyStats(score([...accompaniment, ...baseline, impliedThird, foreign]), { whole: true });

  assert.ok(stats, "expected a detected melody");
  assert.equal(stats._voice, "1/4");
  // 39 of 40 onsets are chord tones (38 baseline + the implied third); the
  // foreign D is the only one excluded.
  closeTo(stats.melChordTone, 39 / 40);
});

test("melChordTone does not credit the other third when the bed already sounds one", () => {
  // Accompaniment: a sustained C major triad (C=36, E=40, G=43). Its third is
  // decided, so the implied-third clause must not fire.
  const accompaniment = [36, 40, 43].map((pitch) => ({
    start: 0, duration: 1_000_000, pitch, velocity: 0.8, track: 9, program: 4, isPercussion: false,
  }));
  // 38 baseline onsets on the root (pc 0), one on the bed's own major third
  // (E, pc 4 — a real chord tone), and one on the minor third (Eb, pc 3 — a
  // wrong-quality third, a semitone off the E that is sounding).
  const baseline = buildVoice({
    track: 1,
    program: 0,
    pitches: new Array(38).fill(60),
    gaps: new Array(37).fill(240),
  });
  const realThird = { start: 38 * 240, duration: 10, pitch: 64, velocity: 0.8, track: 1, program: 0, isPercussion: false }; // pc 4
  const wrongThird = { start: 39 * 240, duration: 10, pitch: 63, velocity: 0.8, track: 1, program: 0, isPercussion: false }; // pc 3

  const stats = melodyStats(score([...accompaniment, ...baseline, realThird, wrongThird]), { whole: true });

  assert.ok(stats, "expected a detected melody");
  // 39 of 40: the baseline and the real third count; the minor third does not.
  closeTo(stats.melChordTone, 39 / 40);
});

test("melClash flags a semitone against the sounding accompaniment", () => {
  // Accompaniment: a single sustained C (pc 0) under the whole window.
  const accompaniment = [
    { start: 0, duration: 1_000_000, pitch: 60, velocity: 0.8, track: 9, program: 4, isPercussion: false },
  ];
  // 39 baseline melody onsets matching the bed's pitch class (no clash), plus
  // one onset a semitone above it (C#, pc 1 - a clash both ways round, since
  // pitch-class distance is symmetric).
  const baseline = buildVoice({
    track: 1,
    program: 0,
    pitches: new Array(39).fill(72), // pc 0
    gaps: new Array(38).fill(240),
  });
  const clash = { start: 39 * 240, duration: 10, pitch: 73, velocity: 0.8, track: 1, program: 0, isPercussion: false }; // pc 1

  const stats = melodyStats(score([...accompaniment, ...baseline, clash]), { whole: true });

  assert.ok(stats, "expected a detected melody");
  closeTo(stats.melClash, 1 / 40);
});

test("melStep and melLeap read off a known line of interval steps and leaps", () => {
  // Cyclic interval script, repeated 10 times (40 deltas -> 41 notes, 40
  // consecutive pairs): +2 (step), -8 (leap), +2 (step), +4 (neither).
  // Per cycle: 2 steps, 1 leap, 1 "skip" that counts toward neither share.
  // Over 10 cycles: 20 steps, 10 leaps, 10 skips out of 40 pairs.
  const deltas = [];
  for (let i = 0; i < 10; i++) deltas.push(2, -8, 2, 4);

  const pitches = [60];
  for (const d of deltas) pitches.push(pitches.at(-1) + d);

  const line = buildVoice({
    track: 1,
    program: 0,
    pitches,
    gaps: new Array(pitches.length - 1).fill(100),
  });

  const stats = melodyStats(score(line), { whole: true });

  assert.ok(stats, "expected a detected melody");
  closeTo(stats.melStep, 20 / 40);
  closeTo(stats.melLeap, 10 / 40);
});

test("melodyStats returns null when no melody candidate survives detection", () => {
  // Only 10 notes in the whole score - below MIN_VOICE_NOTES, so the only
  // voice present is dropped and no candidate remains.
  const tooFew = buildVoice({
    track: 1,
    program: 0,
    pitches: new Array(10).fill(72),
    gaps: new Array(9).fill(240),
  });

  assert.equal(melodyStats(score(tooFew), { whole: true }), null);
  assert.equal(melodyStats(score([]), { whole: true }), null);
});
