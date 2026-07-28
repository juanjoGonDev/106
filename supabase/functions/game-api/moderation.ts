import { Profanease } from 'npm:profanease@2.0.3';
import allLanguages from 'npm:profanease@2.0.3/langs/all';
import { validateNickname } from '../_shared/nickname-policy.js';
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
  const structural = validateNickname(value);
  if (!structural.valid) {
    return { allowed: false, reason: structural.reason, normalized: structural.normalized };
  }

  const { candidate, compacted, spaced } = nicknameVariants(structural.normalized);
  const analysis = filter.analyze(`${candidate} ${spaced} ${compacted}`);
  if (analysis.isProfane) {
    return { allowed: false, reason: 'offensive', severity: analysis.severity, normalized: candidate };
  }

  if (isReservedNickname(candidate)) {
    return { allowed: false, reason: 'reserved', normalized: candidate };
  }

  return { allowed: true, normalized: candidate };
}
