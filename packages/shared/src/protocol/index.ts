/**
 * Wire protocol constants. Stage 1 only needs the version gate and the room code
 * alphabet; the message types arrive with the room in Stage 4.
 *
 * A client whose `proto` is below PROTOCOL_MIN is told to reload instead of
 * being served a half-understood state.
 */
export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MIN = 1;

/**
 * Crockford base32 without I, L, O and U: 32 symbols, so no look-alikes and no
 * accidental words. 10 characters = 50 bits, unambiguous when read over a phone.
 */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE_LENGTH = 10;

export function isRoomCode(value: string): boolean {
  if (value.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of value) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** Rejection sampling keeps the distribution uniform over 32 symbols. */
export function generateRoomCode(random: (bytes: Uint8Array) => Uint8Array): string {
  let out = '';
  while (out.length < ROOM_CODE_LENGTH) {
    const bytes = random(new Uint8Array(ROOM_CODE_LENGTH));
    for (const b of bytes) {
      if (b < 224) out += ROOM_CODE_ALPHABET[b % 32];
      if (out.length === ROOM_CODE_LENGTH) break;
    }
  }
  return out;
}
