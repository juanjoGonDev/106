export const MIN_NICKNAME_LENGTH = 3;
export const MAX_NICKNAME_LENGTH = 24;

const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff/\\]/u;
const ALLOWED_CHARACTERS = /^[\p{L}\p{N} _.'’\-]+$/u;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const SEPARATOR = /[ _.'’\-]/u;
const REPEATED_SEPARATORS = /[ _.'’\-]{2,}/u;

export function normalizeNickname(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function validateNickname(value) {
  const raw = String(value ?? '').normalize('NFKC');
  const normalized = normalizeNickname(raw);
  const characters = Array.from(normalized);

  if (characters.length < MIN_NICKNAME_LENGTH) {
    return Object.freeze({ valid: false, normalized, reason: 'too_short' });
  }
  if (characters.length > MAX_NICKNAME_LENGTH) {
    return Object.freeze({ valid: false, normalized, reason: 'too_long' });
  }
  if (FORBIDDEN_CHARACTERS.test(raw) || !ALLOWED_CHARACTERS.test(normalized)) {
    return Object.freeze({ valid: false, normalized, reason: 'invalid_characters' });
  }
  if (!ALPHANUMERIC.test(normalized)
    || SEPARATOR.test(characters[0])
    || SEPARATOR.test(characters.at(-1))
    || REPEATED_SEPARATORS.test(normalized)) {
    return Object.freeze({ valid: false, normalized, reason: 'invalid_format' });
  }

  return Object.freeze({
    valid: true,
    normalized,
    key: normalized.toLocaleLowerCase('es'),
    reason: null,
  });
}

export function nicknameErrorMessage(reason) {
  const messages = Object.freeze({
    too_short: 'El nick debe tener al menos 3 caracteres.',
    too_long: 'El nick puede tener como máximo 24 caracteres.',
    invalid_characters: 'Usa letras, números y separadores simples; no se permiten rutas ni caracteres invisibles.',
    invalid_format: 'El nick debe empezar y terminar con una letra o número y no repetir separadores.',
    reserved: 'Este nick está reservado.',
    offensive: 'El nick contiene lenguaje ofensivo o inapropiado.',
  });
  return messages[reason] ?? 'El nick no es válido.';
}
