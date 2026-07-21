import { describe, expect, it } from 'vitest';
import {
  compactNickname,
  isReservedNickname,
  nicknameVariants,
} from '../../supabase/functions/game-api/moderation-core.js';

const injectionPayloads = [
  "'; DROP TABLE game_players; --",
  "admin' OR '1'='1",
  '1; SELECT pg_sleep(10)',
  '${7*7}',
  '<script>alert(1)</script>',
  '../../etc/passwd',
  '\u202Etxt.exe',
  'name\u0000ignored',
];

describe('nickname security normalization', () => {
  it.each([
    ['M1NUT0-106', 'minutaia6'],
    ['m.i.n.u.t.o', 'minuto'],
    ['áéíóú', 'aeiou'],
    ['a\u200Bb\uFEFFc', 'abc'],
  ])('normalizes %s safely', (input, expected) => {
    expect(compactNickname(input)).toBe(expected);
  });

  it.each(['admin', 'Adm1n', 'moderador', 'support', 'MINUTO-106'])(
    'blocks reserved identity %s',
    (input) => {
      expect(isReservedNickname(input)).toBe(true);
    },
  );

  it.each(injectionPayloads)('treats attack payload as inert text: %s', (payload) => {
    const variants = nicknameVariants(payload);
    expect(variants.candidate).toBeTypeOf('string');
    expect(variants.compacted).toBeTypeOf('string');
    expect(variants.spaced).toBeTypeOf('string');
    expect(variants.compacted.length).toBeLessThanOrEqual(payload.normalize('NFKD').length);
  });
});
