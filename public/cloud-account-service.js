const DEVICE_STORAGE_KEY = 'minuto106:device-id';

export function getOrCreateDeviceId(storage, cryptoApi) {
  const current = String(storage.getItem(DEVICE_STORAGE_KEY) ?? '');
  if (/^[a-zA-Z0-9._:-]{16,80}$/u.test(current)) return current;
  const generated = cryptoApi.randomUUID();
  storage.setItem(DEVICE_STORAGE_KEY, generated);
  return generated;
}

export class CloudAccountService {
  constructor(config, client, dependencies = {}) {
    this.config = config;
    this.client = client;
    this.fetch = dependencies.fetch ?? window.fetch.bind(window);
    this.storage = dependencies.storage ?? window.localStorage;
    this.crypto = dependencies.crypto ?? crypto;
    this.access = Object.hasOwn(dependencies, 'access') ? dependencies.access : window.Minuto106Access;
    this.deviceId = getOrCreateDeviceId(this.storage, this.crypto);
  }

  headers(session) {
    const headers = {
      apikey: this.config.publishableKey,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
      'x-device-id': this.deviceId,
    };
    const accountToken = this.access?.getAccountToken?.(false) || '';
    if (accountToken) headers['x-account-token'] = accountToken;
    return headers;
  }

  async request(action, body = {}) {
    const session = await this.client.currentSession();
    if (!session) throw new Error('Inicia sesión para continuar.');
    const response = await this.fetch(this.config.accountAuthApiUrl, {
      method: 'POST',
      headers: this.headers(session),
      body: JSON.stringify({ action, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(payload.error || 'No se pudo vincular la cuenta.'));
      error.code = String(payload.code || 'account_auth_error');
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async synchronize() {
    const result = await this.request('sync-account');
    if (result.accountToken) this.access?.setAccountToken?.(result.accountToken);
    return result;
  }

  async confirmMerge(proposal) {
    return this.request('confirm-merge', proposal);
  }

  async cancelMerge(proposalId) {
    if (!proposalId) return null;
    return this.request('cancel-merge', { proposalId });
  }
}