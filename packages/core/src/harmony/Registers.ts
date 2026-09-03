/**
 * Register ownership.
 *
 * Each role keeps to a preferred pitch band so the voices don't pile up in the
 * same octave and muddy each other: the bass owns the low end, the pad the
 * low-to-upper-mid, and the melody the mid-to-high — leaving the top of the
 * texture clear for the line the listener is meant to follow.
 *
 * These are preferences realized by construction, not hard per-note clamps:
 * whole phrases/voicings are placed by octave so contour and voice leading are
 * preserved. A little overlap between neighbours is fine and natural.
 */

export type VoiceRole = "bass" | "pad" | "melody";

export interface Register {
  readonly lo: number;
  readonly hi: number;
}

export const ROLE_REGISTERS: Record<VoiceRole, Register> = {
  bass: { lo: 34, hi: 57 },
  pad: { lo: 46, hi: 71 },
  melody: { lo: 67, hi: 89 },
};
