/**
 * Musical roles — what a voice is *doing*, decoupled from which instrument plays
 * it and from the renderer's routing key.
 *
 * v0.2 thinks in fixed voices (`pad`/`bass`/`melody`/`percussion`). v0.3 thinks
 * in musical function: a "harmonic bed" might be a pad, a string ensemble, an
 * organ, or a choir depending on the style. The role is the compositional label;
 * the {@link VoiceId} stays as the renderer's routing key. They coexist through
 * the maps below.
 *
 * Only the four roles that back v0.2's voices are wired today (see
 * {@link ROLE_FOR_VOICE}). The rest of the vocabulary is declared so the
 * OrchestrationDirector, StylePacks, and later generators (motion, counterline,
 * texture) can reference stable names as they come online — introducing a role
 * here does not, by itself, make anything play.
 */

import type { VoiceId } from "../events/MusicalEvent.js";

/**
 * The extensible role vocabulary. Grouped by function:
 * FOUNDATION, HARMONY, FOREGROUND, MOTION, RHYTHM, TEXTURE.
 */
export type MusicalRole =
  // FOUNDATION
  | "foundation"
  // HARMONY
  | "harmonic-bed"
  | "harmonic-motion"
  // FOREGROUND
  | "primary-melody"
  | "counterline"
  // MOTION
  | "pulse"
  | "ostinato"
  // RHYTHM
  | "low-rhythm"
  | "mid-rhythm"
  | "high-rhythm"
  | "rhythmic-ornament"
  // TEXTURE
  | "texture"
  | "transition";

/** Every declared role, in a stable canonical order. */
export const MUSICAL_ROLES: readonly MusicalRole[] = [
  "foundation",
  "harmonic-bed",
  "harmonic-motion",
  "primary-melody",
  "counterline",
  "pulse",
  "ostinato",
  "low-rhythm",
  "mid-rhythm",
  "high-rhythm",
  "rhythmic-ornament",
  "texture",
  "transition",
] as const;

/**
 * The role each v0.2 voice realizes today. This is the migration bridge: the
 * four generators keep their {@link VoiceId} for renderer routing, but the
 * orchestration layer reasons about them as roles.
 */
export const ROLE_FOR_VOICE = {
  bass: "foundation",
  pad: "harmonic-bed",
  melody: "primary-melody",
  percussion: "mid-rhythm",
} as const satisfies Partial<Record<VoiceId, MusicalRole>>;

/** The v0.2 voices that currently back a role, in canonical voice order. */
export type WiredVoice = keyof typeof ROLE_FOR_VOICE;

/** The four roles wired to a concrete voice in Phases 1–3. */
export type WiredRole = (typeof ROLE_FOR_VOICE)[WiredVoice];

/**
 * Reverse of {@link ROLE_FOR_VOICE}: which voice realizes a role, if any. Roles
 * without a dedicated voice yet (motion, counterline, texture, …) map to
 * `undefined` until their generator and renderer instrument arrive.
 */
export const VOICE_FOR_ROLE: Partial<Record<MusicalRole, WiredVoice>> = {
  foundation: "bass",
  "harmonic-bed": "pad",
  "primary-melody": "melody",
  "mid-rhythm": "percussion",
};

/** Whether a role currently maps to a playable v0.2 voice. */
export function isWiredRole(role: MusicalRole): role is WiredRole {
  return VOICE_FOR_ROLE[role] !== undefined;
}
