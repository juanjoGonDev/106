import { readFileSync } from 'node:fs';

import {
  normalizeAuthEmailOtpExpirySeconds,
  normalizeAuthEmailOtpLength,
} from '../public/auth-account-state.js';

const AUTH_EMAIL_SECTION = 'auth.email';
const DEFAULT_CONFIG_URL = new URL('../supabase/config.toml', import.meta.url);

function normalizedSettingValue(value) {
  return String(value ?? '').trim();
}

export function parseSupabaseAuthEmailPolicy(sourceValue) {
  const source = String(sourceValue ?? '');
  const settings = new Map();
  let section = '';

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\](?:\s+#.*)?$/u);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    if (section !== AUTH_EMAIL_SECTION) continue;

    const settingMatch = line.match(/^([a-z_]+)\s*=\s*([^#]+?)(?:\s+#.*)?$/u);
    if (!settingMatch) continue;
    settings.set(settingMatch[1], normalizedSettingValue(settingMatch[2]));
  }

  const otpLength = normalizeAuthEmailOtpLength(settings.get('otp_length'));
  if (!otpLength) {
    throw new Error('supabase/config.toml [auth.email].otp_length must be an integer from 6 to 10.');
  }

  const otpExpirySeconds = normalizeAuthEmailOtpExpirySeconds(settings.get('otp_expiry'));
  if (!otpExpirySeconds) {
    throw new Error('supabase/config.toml [auth.email].otp_expiry must be a positive integer in seconds.');
  }

  return Object.freeze({ otpLength, otpExpirySeconds });
}

export function readSupabaseAuthEmailPolicy(configUrl = DEFAULT_CONFIG_URL) {
  return parseSupabaseAuthEmailPolicy(readFileSync(configUrl, 'utf8'));
}

export const SUPABASE_AUTH_EMAIL_POLICY = readSupabaseAuthEmailPolicy();
