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
  '0': 'o',
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

const VISUAL_EQUIVALENTS = Object.freeze({
  '0': new Set(['0', 'o']),
  '1': new Set(['1', 'i', 'l']),
  '3': new Set(['3', 'e']),
  '4': new Set(['4', 'a']),
  '5': new Set(['5', 's']),
  '6': new Set(['6', 'g']),
  '7': new Set(['7', 't']),
  '8': new Set(['8', 'b']),
  '9': new Set(['9', 'g']),
  '@': new Set(['a']),
  '$': new Set(['s']),
  '!': new Set(['i']),
  '|': new Set(['i', 'l']),
  '+': new Set(['t']),
});

function unicodeAlphanumeric(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase('und')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function visuallyMatches(candidate, reserved) {
  if (candidate.length !== reserved.length) return false;

  return Array.from(candidate).every((character, index) => {
    const expected = reserved[index];
    return character === expected || VISUAL_EQUIVALENTS[character]?.has(expected) === true;
  });
}

export function compactNickname(value) {
  return unicodeAlphanumeric(value)
    .replace(/[0@41!|35$7+89]/g, (character) => LEET_REPLACEMENTS[character] ?? character);
}

export function isReservedNickname(value) {
  const canonical = unicodeAlphanumeric(value);
  const compacted = compactNickname(value);

  return Array.from(RESERVED_NICKNAMES).some((reserved) => (
    canonical === reserved
    || compacted === reserved
    || visuallyMatches(canonical, reserved)
  ));
}

export function nicknameVariants(value) {
  const candidate = String(value ?? '').trim();
  return {
    candidate,
    compacted: compactNickname(candidate),
    spaced: candidate.replace(/[_\-.]+/g, ' '),
  };
}
