import { Profanease } from 'npm:profanease@2.0.3';
import allLanguages from 'npm:profanease@2.0.3/langs/all';

const customBlocked = [
  'nazi', 'nazis', 'hitler', 'kkk', 'isis',
  'pedofilo', 'pedofila', 'pedophile',
  'violador', 'rapist', 'terrorista', 'terrorist',
];

const filter = new Profanease({
  languages: [allLanguages],
  list: customBlocked,
  normalize: 'aggressive',
});

function compact(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase('und')
    .replace(/[0@4]/g, 'a')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[5$]/g, 's')
    .replace(/[7+]/g, 't')
    .replace(/[8]/g, 'b')
    .replace(/[9]/g, 'g')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function moderateNickname(value: string) {
  const candidate = value.trim();
  if (!candidate) return { allowed: false, reason: 'empty' };

  const compacted = compact(candidate);
  const spaced = candidate.replace(/[_\-.]+/g, ' ');
  const analysis = filter.analyze(`${candidate} ${spaced} ${compacted}`);

  if (analysis.isProfane) {
    return { allowed: false, reason: 'offensive', severity: analysis.severity };
  }

  if (/^(admin|administrator|moderador|moderator|soporte|support|staff|sistema|system|minuto106)$/iu.test(compacted)) {
    return { allowed: false, reason: 'reserved' };
  }

  return { allowed: true };
}
