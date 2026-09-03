/**
 * Variable-length quantity (VLQ) encoding as used by Standard MIDI Files.
 *
 * A VLQ stores a non-negative integer as a big-endian sequence of 7-bit groups.
 * Every byte except the last has its high bit (0x80) set as a continuation flag.
 * SMF uses VLQs for delta-times and for meta-event data lengths — but NOT for
 * chunk length fields (those are fixed 4-byte big-endian; see writeUint32BE).
 *
 * The SMF spec caps a VLQ at 4 bytes, i.e. values in the range 0..0x0FFFFFFF.
 */

/** Largest value representable by a 4-byte SMF VLQ. */
export const MAX_VLQ = 0x0fffffff;

/**
 * Encode a non-negative integer as a VLQ byte sequence.
 * Uses arithmetic (not bitwise) so the full 28-bit range stays exact.
 *
 * @throws if the value is negative, non-integer, or exceeds {@link MAX_VLQ}.
 */
export function encodeVLQ(value: number): number[] {
  if (!Number.isInteger(value)) {
    throw new RangeError(`VLQ value must be an integer, got ${value}`);
  }
  if (value < 0 || value > MAX_VLQ) {
    throw new RangeError(
      `VLQ value out of range 0..${MAX_VLQ}, got ${value}`,
    );
  }

  // Low 7 bits are the final (no-continuation) byte.
  const bytes = [value % 128];
  let remaining = Math.floor(value / 128);
  while (remaining > 0) {
    // Prepend higher groups with the continuation flag set.
    bytes.unshift((remaining % 128) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  return bytes;
}
