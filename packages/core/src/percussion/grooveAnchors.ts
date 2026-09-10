/**
 * Shared groove anchors — sixteenth-note positions that more than one voice
 * generator locks onto, so the generators can't silently drift apart even
 * though each runs independently with its own RNG and neither reads the
 * other's output.
 *
 * Each constant names the *structural* kick hits for one named groove — the
 * hits a `PercussionGenerator` groove method plays unconditionally, every
 * bar, regardless of `grooveVariation`. The corresponding `BassGenerator`
 * style locks part of its own pattern onto the same positions, because
 * bass/kick interlock — the two voices agreeing on where the floor is — is
 * what makes a rhythm section feel like one instrument instead of two
 * independently plausible parts.
 *
 * `grooveVariation` adds extra, *probabilistic* kick hits on top of these
 * (ghost kicks, dropped bombs, fill pickups — see each groove method's own
 * doc comment in `PercussionGenerator.ts`). Those extras are deliberately
 * NOT part of any anchor here: the bass generator has no visibility into the
 * percussion generator's RNG draws, so it cannot know where a probabilistic
 * extra will land this bar. An anchor only names positions the kick is
 * *guaranteed* to hit, which is the one thing the bass can safely build
 * around without the two generators reading each other's output.
 */

/**
 * Funk: kick on "the one" and the syncopated push right before beat 2 (see
 * `PercussionGenerator.funk()`). Ear-confirmed — this is the anchor that
 * proved the approach; every other constant below generalises it.
 */
export const FUNK_KICK_SIXTEENTHS = [0, 6] as const;

/**
 * Rock/pop/metal backbeat: kick on beats 1 and 3 (see
 * `PercussionGenerator.backbeat()`). `grooveVariation`'s extra kick on the
 * "and" of 3 (sixteenth 10) is deliberately excluded — it's probabilistic,
 * not structural.
 */
export const BACKBEAT_KICK_SIXTEENTHS = [0, 8] as const;

/**
 * Electronic four-on-the-floor: kick on every beat (see
 * `PercussionGenerator.fourOnFloor()`). This one is never touched by
 * `grooveVariation` at all — the grid-perfect kick IS the genre's
 * discriminator — so every position the kick ever plays is structural.
 */
export const FOUR_ON_FLOOR_KICK_SIXTEENTHS = [0, 4, 8, 12] as const;

/**
 * Blues shuffle: kick on beats 1 and 3 at full volume, plus a quiet
 * ("feathered") kick on beats 2 and 4 (see `PercussionGenerator.shuffle()`).
 * A walking bass states the quarter-note pulse on every beat, not just the
 * backbeat pair, so the shuffle kick reinforces the whole pulse the same way
 * — real blues drummers keep the kick moving under a walking bassline
 * instead of only marking 1 and 3.
 */
export const SHUFFLE_KICK_SIXTEENTHS = [0, 4, 8, 12] as const;

/**
 * Jazz swing: kick on beats 1 and 3 at moderate volume, plus a very quiet
 * feather on beats 2 and 4 (see `PercussionGenerator.swing()`). Real acoustic
 * jazz drummers feather the bass drum continuously to reinforce the walking
 * bass's quarter-note pulse — that's the anchor a walking line locks onto,
 * distinct from the loud, syncopated "dropped bombs" `grooveVariation`
 * scatters elsewhere (which stay probabilistic, not structural).
 */
export const SWING_KICK_SIXTEENTHS = [0, 4, 8, 12] as const;

/**
 * Hip-hop boom-bap: kick on beat 1 and the "and" of beat 2 (see
 * `PercussionGenerator.boomBap()`) — the classic two-kick breakbeat
 * skeleton.
 */
export const BOOM_BAP_KICK_SIXTEENTHS = [0, 6] as const;

/**
 * Latin: the bombo kick on the downbeat and the "and of 2" accent (see
 * `PercussionGenerator.clave()`). The clave figure itself is played on
 * claves, not kick, so it isn't part of this anchor — this names only the
 * bombo's own two hits.
 */
export const CLAVE_KICK_SIXTEENTHS = [0, 6] as const;
