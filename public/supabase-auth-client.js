import {
  AUTH_PKCE_STORAGE_KEY,
  AUTH_RETURN_STORAGE_KEY,
  AUTH_SESSION_STORAGE_KEY,
  accountRedirectUrl,
  normalizeEmail,
  normalizeProvider,
} from './auth-account-state.js';

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function createCodeVerifier(cryptoApi = crypto) {
  const bytes = new Uint8Array(48);
  cryptoApi.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function codeChallenge(verifier, cryptoApi = crypto) {
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function normalizeSession(value) {
  if (!value || typeof value !== 'object') return null;
  const accessToken = String(value.access_token ?? '');
  const refreshToken = String(value.refresh_token ?? '');
  const expiresAt = Number(value.expires_at ?? 0)
    || Math.floor(Date.now() / 1000) + Number(value.expires_in ?? 0);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresAt) || !value.user) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(expiresAt),
    token_type: String(value.token_type || 'bearer'),
    user: value.user,
  };
}

export function callbackCode(url) {
  try {
    return new URL(url).searchParams.get('code') || '';
  } catch {
    return '';
  }
}

export class SupabaseAuthClient {
  constructor(config, dependencies = {}) {
    this.supabaseUrl = config.supabaseUrl;
    this.publishableKey = config.publishableKey;
    this.publicSiteUrl = config.publicSiteUrl;
    this.fetch = dependencies.fetch ?? window.fetch.bind(window);
    this.storage = dependencies.storage ?? window.localStorage;
    this.location = dependencies.location ?? window.location;
    this.history = dependencies.history ?? window.history;
    this.crypto = dependencies.crypto ?? crypto;
    this.now = dependencies.now ?? (() => Date.now());
  }

  authUrl(path) {
    return `${this.supabaseUrl}/auth/v1${path}`;
  }

  headers(session, extra = {}) {
    const headers = {
      apikey: this.publishableKey,
      'content-type': 'application/json',
      ...extra,
    };
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`;
    return headers;
  }

  async request(path, options = {}) {
    const response = await this.fetch(this.authUrl(path), {
      method: options.method ?? 'POST',
      headers: this.headers(options.session, options.headers),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(payload.msg || payload.message || payload.error_description || payload.error || 'Auth request failed'));
      error.code = String(payload.error_code || payload.code || payload.error || 'auth_error');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  readSession() {
    try {
      return normalizeSession(JSON.parse(this.storage.getItem(AUTH_SESSION_STORAGE_KEY) || 'null'));
    } catch {
      return null;
    }
  }

  writeSession(value) {
    const session = normalizeSession(value);
    if (!session) {
      this.storage.removeItem(AUTH_SESSION_STORAGE_KEY);
      return null;
    }
    this.storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  clearSession() {
    this.storage.removeItem(AUTH_SESSION_STORAGE_KEY);
  }

  async refreshSession(session = this.readSession()) {
    if (!session?.refresh_token) {
      this.clearSession();
      return null;
    }
    try {
      const payload = await this.request('/token?grant_type=refresh_token', {
        body: { refresh_token: session.refresh_token },
      });
      return this.writeSession(payload);
    } catch (error) {
      this.clearSession();
      throw error;
    }
  }

  async currentSession() {
    const session = this.readSession();
    if (!session) return null;
    const nowSeconds = Math.floor(this.now() / 1000);
    return session.expires_at <= nowSeconds + 60 ? this.refreshSession(session) : session;
  }

  async createPkce(returnPage) {
    const verifier = createCodeVerifier(this.crypto);
    const challenge = await codeChallenge(verifier, this.crypto);
    this.storage.setItem(AUTH_PKCE_STORAGE_KEY, verifier);
    this.storage.setItem(AUTH_RETURN_STORAGE_KEY, String(returnPage || 'cuenta.html'));
    return { verifier, challenge };
  }

  consumePkce() {
    const verifier = String(this.storage.getItem(AUTH_PKCE_STORAGE_KEY) || '');
    this.storage.removeItem(AUTH_PKCE_STORAGE_KEY);
    return verifier;
  }

  consumeReturnPage() {
    const page = String(this.storage.getItem(AUTH_RETURN_STORAGE_KEY) || 'cuenta.html');
    this.storage.removeItem(AUTH_RETURN_STORAGE_KEY);
    return page;
  }

  async exchangeCallback(url = this.location.href) {
    const code = callbackCode(url);
    if (!code) return this.currentSession();
    const verifier = this.consumePkce();
    if (!verifier) throw new Error('No se encontró el verificador seguro de la sesión.');
    const payload = await this.request('/token?grant_type=pkce', {
      body: { auth_code: code, code_verifier: verifier },
    });
    const session = this.writeSession(payload);
    const clean = new URL(url);
    clean.searchParams.delete('code');
    clean.searchParams.delete('type');
    this.history.replaceState({}, '', `${clean.pathname}${clean.search}${clean.hash}`);
    return session;
  }

  async signInWithOAuth(provider, options = {}) {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) throw new Error('Proveedor OAuth no válido.');
    const redirectTo = options.redirectTo || accountRedirectUrl(this.publicSiteUrl);
    const { challenge } = await this.createPkce('cuenta.html');
    const url = new URL(this.authUrl('/authorize'));
    url.searchParams.set('provider', normalizedProvider);
    url.searchParams.set('redirect_to', redirectTo);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 's256');
    if (options.skipRedirect) return url.toString();
    this.location.assign(url.toString());
    return url.toString();
  }

  async signUp(email, password, options = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error('Introduce un email válido.');
    const redirectTo = options.redirectTo || accountRedirectUrl(this.publicSiteUrl);
    const { challenge } = await this.createPkce('cuenta.html');
    const query = new URLSearchParams({ redirect_to: redirectTo });
    const payload = await this.request(`/signup?${query}`, {
      body: {
        email: normalized,
        password,
        code_challenge: challenge,
        code_challenge_method: 's256',
        gotrue_meta_security: options.captchaToken ? { captcha_token: options.captchaToken } : undefined,
      },
    });
    if (payload.access_token) this.writeSession(payload);
    return payload;
  }

  async resendSignupConfirmation(email, options = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error('Introduce un email válido.');
    const redirectTo = options.redirectTo || accountRedirectUrl(this.publicSiteUrl);
    const query = new URLSearchParams({ redirect_to: redirectTo });
    return this.request(`/resend?${query}`, {
      body: {
        email: normalized,
        type: 'signup',
        gotrue_meta_security: options.captchaToken ? { captcha_token: options.captchaToken } : undefined,
      },
    });
  }

  async signInWithPassword(email, password, options = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error('Introduce un email válido.');
    const payload = await this.request('/token?grant_type=password', {
      body: {
        email: normalized,
        password,
        gotrue_meta_security: options.captchaToken ? { captcha_token: options.captchaToken } : undefined,
      },
    });
    return this.writeSession(payload);
  }

  async requestPasswordRecovery(email, options = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error('Introduce un email válido.');
    const redirectTo = options.redirectTo || accountRedirectUrl(this.publicSiteUrl, 'restablecer-clave.html');
    const { challenge } = await this.createPkce('restablecer-clave.html');
    const query = new URLSearchParams({ redirect_to: redirectTo });
    return this.request(`/recover?${query}`, {
      body: {
        email: normalized,
        code_challenge: challenge,
        code_challenge_method: 's256',
        gotrue_meta_security: options.captchaToken ? { captcha_token: options.captchaToken } : undefined,
      },
    });
  }

  async updatePassword(password) {
    const session = await this.currentSession();
    if (!session) throw new Error('La sesión de recuperación no es válida.');
    const payload = await this.request('/user', {
      method: 'PUT',
      session,
      body: { password },
    });
    session.user = payload;
    this.writeSession(session);
    return payload;
  }

  async signOut() {
    const session = this.readSession();
    try {
      if (session) await this.request('/logout', { session, body: {} });
    } finally {
      this.clearSession();
    }
  }
}
