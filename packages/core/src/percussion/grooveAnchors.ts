/**
 * Shared groove anchors — sixteenth-note positions that more than one voice
 * generator locks onto, so the generators can't silently drift apart even
 * though each runs independently with its own RNG and neither reads the
 * other's output.
 *
 * `FUNK_KICK_SIXTEENTHS` names where the funk kick lands (see
 * `PercussionGenerator.funk()`). The funk bass (`BassGenerator`) locks its
 * pattern to include every one of these positions, because bass/kick
 * interlock — the two hitting the same sixteenth — is what makes a funk
 * rhythm section feel like one instrument. Changing these values changes
 * both voices at once; that's the point of keeping a single source of truth
 * instead of two hand-tuned literals that happen to agree today.
 */
export const FUNK_KICK_SIXTEENTHS = [0, 6] as const;
