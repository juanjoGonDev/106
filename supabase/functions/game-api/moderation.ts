import { Profanease } from 'npm:profanease@2.0.3';
import allLanguages from 'npm:profanease@2.0.3/langs/all';
import { isReservedNickname, nicknameVariants } from './moderation-core.js';

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

export function moderateNickname(value: string) {
  const { candidate, compacted, spaced } = nicknameVariants(value);
  if (!candidate) {
    return { allowed: false, reason: 'empty' };
  }

  const analysis = filter.analyze(`${candidate} ${spaced} ${compacted}`);
  if (analysis.isProfane) {
    return { allowed: false, reason: 'offensive', severity: analysis.severity };
  }

  if (isReservedNickname(candidate)) {
    return { allowed: false, reason: 'reserved' };
  }

  return { allowed: true };
}
