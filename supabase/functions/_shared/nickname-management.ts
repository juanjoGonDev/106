import { nicknameErrorMessage, validateNickname } from './nickname-policy.js';
import { moderateNickname } from '../game-api/moderation.ts';

export type NicknameCandidate = Readonly<{
  nick: string;
  key: string;
}>;

export type NicknameCandidateError = Readonly<{
  error: string;
  message: string;
}>;

export function evaluateNicknameCandidate(value: unknown): NicknameCandidate | NicknameCandidateError {
  const structural = validateNickname(value);
  if (!structural.valid) {
    return Object.freeze({
      error: `nick_${String(structural.reason ?? 'invalid')}`,
      message: nicknameErrorMessage(structural.reason),
    });
  }

  const moderation = moderateNickname(structural.normalized);
  if (!moderation.allowed) {
    const reason = String(moderation.reason ?? 'invalid');
    return Object.freeze({
      error: `nick_${reason}`,
      message: nicknameErrorMessage(reason),
    });
  }

  const normalized = validateNickname(moderation.normalized);
  if (!normalized.valid || !normalized.key) {
    return Object.freeze({
      error: `nick_${String(normalized.reason ?? 'invalid')}`,
      message: nicknameErrorMessage(normalized.reason),
    });
  }

  return Object.freeze({
    nick: normalized.normalized,
    key: normalized.key,
  });
}

export function isNicknameCandidateError(
  result: NicknameCandidate | NicknameCandidateError,
): result is NicknameCandidateError {
  return 'error' in result;
}
