const RESERVED_NICKNAMES = new Set([
  'admin',
  'administrator',
  'moderador',
  'moderator',
  'soporte',
  'support',
  'staff',
  'sistema',
  'system',
  'minuto106',
]);

const LEET_REPLACEMENTS = Object.freeze({
  '0': 'a',
  '@': 'a',
  '4': 'a',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '5': 's',
  '$': 's',
  '7': 't',
  '+': 't',
  '8': 'b',
  '9': 'g',
});

function unicodeAlphanumeric(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase('und')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function compactNickname(value) {
  return unicodeAlphanumeric(value)
    .replace(/[0@41!|35$7+89]/g, (character) => LEET_REPLACEMENTS[character] ?? character);
}

export function isReservedNickname(value) {
  const canonical = unicodeAlphanumeric(value);
  return RESERVED_NICKNAMES.has(canonical) || RESERVED_NICKNAMES.has(compactNickname(value));
}

export function nicknameVariants(value) {
  const candidate = String(value ?? '').trim();
  return {
    candidate,
    compacted: compactNickname(candidate),
    spaced: candidate.replace(/[_\-.]+/g, ' '),
  };
}
