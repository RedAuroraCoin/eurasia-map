import { BALANCE } from './balance';

/**
 * Nicknames are the only user-controlled text that reaches another player, so
 * sanitising happens once, here, and both sides use it. The renderer still uses
 * textContent, never innerHTML — two independent defences, as the brief asks.
 */

// C0/C1 controls, zero-width and bidi overrides that can disguise or reorder text.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
const SPACES = /\s+/g;

export interface SanitizedNick {
  /** What we store and show. */
  readonly value: string;
  /** True when the input had to be changed (so the UI can say so). */
  readonly changed: boolean;
}

export function sanitizeNickname(raw: string, fallback = 'Игрок'): SanitizedNick {
  const max = BALANCE.player.maxNickLength;
  const normalized = raw.normalize('NFC').replace(INVISIBLE, '').replace(SPACES, ' ').trim();

  // Array.from splits by code point; surrogate pairs stay intact, ZWJ is stripped above.
  const chars = Array.from(normalized);
  const clipped = chars.slice(0, max).join('').trim();
  const value = clipped.length === 0 ? fallback : clipped;

  return { value, changed: value !== raw };
}
