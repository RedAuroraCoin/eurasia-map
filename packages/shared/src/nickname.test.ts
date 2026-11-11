import { describe, expect, it } from 'vitest';
import { BALANCE } from './balance';
import { sanitizeNickname } from './nickname';

describe('sanitizeNickname', () => {
  it('keeps ordinary names untouched', () => {
    expect(sanitizeNickname('Евгений').value).toBe('Евгений');
    expect(sanitizeNickname('Евгений').changed).toBe(false);
  });

  it('trims and collapses whitespace', () => {
    expect(sanitizeNickname('  Иван \n\t Петров  ').value).toBe('Иван Петров');
  });

  it('strips zero-width and bidi characters used to disguise text', () => {
    const sneaky = 'Ев\u200bге\u202eний\u2060';
    expect(sanitizeNickname(sneaky).value).toBe('Евгений');
  });

  it('strips control characters', () => {
    expect(sanitizeNickname('a\u0000b\u001fc').value).toBe('abc');
  });

  it('clips to the configured length by code points, not UTF-16 units', () => {
    const long = 'Ж'.repeat(40);
    const nick = sanitizeNickname(long);
    expect(Array.from(nick.value)).toHaveLength(BALANCE.player.maxNickLength);
    expect(nick.changed).toBe(true);
  });

  it('does not split surrogate pairs', () => {
    const emoji = '🌍'.repeat(30);
    const nick = sanitizeNickname(emoji);
    expect([...nick.value].every((ch) => ch === '🌍')).toBe(true);
  });

  it('falls back when the result is empty', () => {
    expect(sanitizeNickname('   ').value).toBe('Игрок');
    expect(sanitizeNickname('\u200b\u200b').value).toBe('Игрок');
    expect(sanitizeNickname('', 'Аноним').value).toBe('Аноним');
  });

  it('normalises unicode so identical-looking names compare equal', () => {
    const composed = 'Й';
    const decomposed = 'И\u0306';
    expect(sanitizeNickname(decomposed).value).toBe(sanitizeNickname(composed).value);
  });
});
