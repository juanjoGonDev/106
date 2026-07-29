const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function loadTurnstileScript(documentValue = document) {
  const existing = documentValue.querySelector('script[data-minuto106-auth-turnstile]');
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar la verificación anti-bots.')), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = documentValue.createElement('script');
    script.src = TURNSTILE_URL;
    script.async = true;
    script.defer = true;
    script.dataset.minuto106AuthTurnstile = 'true';
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('No se pudo cargar la verificación anti-bots.')), { once: true });
    documentValue.head.append(script);
  });
}

export class AuthCaptcha {
  constructor(siteKey, container, dependencies = {}) {
    this.siteKey = String(siteKey ?? '').trim();
    this.container = container;
    this.loadScript = dependencies.loadScript ?? (() => loadTurnstileScript(dependencies.document ?? document));
    this.getTurnstile = dependencies.getTurnstile ?? (() => window.turnstile);
    this.widgetId = null;
  }

  async token() {
    if (!this.siteKey) return '';
    if (!this.container) throw new Error('No se pudo preparar la verificación anti-bots.');
    this.container.hidden = false;
    try {
      if (!this.getTurnstile()?.render) await this.loadScript();
      const turnstile = this.getTurnstile();
      if (!turnstile?.render) throw new Error('No se pudo cargar la verificación anti-bots.');
      return await new Promise((resolve, reject) => {
        this.widgetId = turnstile.render(this.container, {
          sitekey: this.siteKey,
          theme: 'dark',
          callback: resolve,
          'error-callback': () => reject(new Error('No se pudo completar la verificación anti-bots.')),
          'expired-callback': () => reject(new Error('La verificación anti-bots ha caducado.')),
        });
      });
    } finally {
      this.container.hidden = true;
    }
  }

  reset() {
    const turnstile = this.getTurnstile();
    if (this.widgetId !== null && turnstile?.remove) turnstile.remove(this.widgetId);
    this.widgetId = null;
    this.container?.replaceChildren();
  }
}
