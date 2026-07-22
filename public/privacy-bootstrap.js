(() => {
  const TAG_MANAGER_ID = 'GTM-NKZK4DC5';
  const CONSENT_KEY = 'minuto106:consent-v1';
  const CONSENT_MAX_AGE_MS = 730 * 24 * 60 * 60 * 1_000;

  function readStoredConsent(storage = window.localStorage, now = Date.now()) {
    try {
      const stored = JSON.parse(storage.getItem(CONSENT_KEY) || 'null');
      if (!stored) return null;
      const updatedAt = Date.parse(String(stored.updatedAt || ''));
      const age = now - updatedAt;
      if (!Number.isFinite(updatedAt) || age < 0 || age > CONSENT_MAX_AGE_MS) return null;
      return stored;
    } catch {
      return null;
    }
  }

  function ensureGoogleConsentApi() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    return window.gtag;
  }

  function consentState(consent, property) {
    return consent?.[property] === true ? 'granted' : 'denied';
  }

  function setDefaultConsent(consent) {
    const gtag = ensureGoogleConsentApi();
    gtag('consent', 'default', {
      analytics_storage: consentState(consent, 'analytics'),
      ad_storage: consentState(consent, 'ads'),
      ad_user_data: consentState(consent, 'ads'),
      ad_personalization: consentState(consent, 'ads'),
      wait_for_update: 500,
    });
    gtag('set', 'ads_data_redaction', true);
  }

  function loadTagManager() {
    if (document.querySelector('script[data-minuto106-gtm]')) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${TAG_MANAGER_ID}`;
    script.dataset.minuto106Gtm = 'true';
    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
    else document.head.append(script);
  }

  const privacyApi = Object.freeze({
    CONSENT_KEY,
    CONSENT_MAX_AGE_MS,
    TAG_MANAGER_ID,
    ensureGoogleConsentApi,
    readStoredConsent,
  });
  window.Minuto106Privacy = privacyApi;

  setDefaultConsent(readStoredConsent());
  loadTagManager();
})();
