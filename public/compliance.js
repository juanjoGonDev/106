const privacyBootstrap = window.Minuto106Privacy;
if (!privacyBootstrap) throw new Error('privacy-bootstrap.js must load before compliance.js.');

const consentConfig = window.__MINUTO106_CONFIG__ ?? {};
const adsClient = String(consentConfig.adSenseClient || '').trim();
const optionalServices = {
  analytics: true,
  ads: Boolean(adsClient),
};

function readConsent() {
  const stored = privacyBootstrap.readStoredConsent();
  if (!stored) return null;
  return {
    analytics: optionalServices.analytics && stored.analytics === true,
    ads: optionalServices.ads && stored.ads === true,
    updatedAt: stored.updatedAt,
  };
}

function ensureGoogleConsentApi() {
  return privacyBootstrap.ensureGoogleConsentApi();
}

function clearAnalyticsCookies() {
  const names = document.cookie
    .split(';')
    .map((entry) => entry.split('=')[0].trim())
    .filter((name) => /^_ga(?:_|$)/.test(name) || name === '_gid' || name === '_gat');

  for (const name of names) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=${location.hostname}; SameSite=Lax`;
  }
}

function updateGoogleConsent(consent) {
  const analyticsGranted = Boolean(consent?.analytics);
  const adsGranted = Boolean(consent?.ads);
  const gtag = ensureGoogleConsentApi();
  gtag('consent', 'update', {
    analytics_storage: analyticsGranted ? 'granted' : 'denied',
    ad_storage: adsGranted ? 'granted' : 'denied',
    ad_user_data: adsGranted ? 'granted' : 'denied',
    ad_personalization: adsGranted ? 'granted' : 'denied',
  });
  window.dataLayer.push({
    event: 'minuto106_consent_update',
    analytics_consent: analyticsGranted ? 'granted' : 'denied',
    ads_consent: adsGranted ? 'granted' : 'denied',
  });
  if (!analyticsGranted) clearAnalyticsCookies();
}

function loadAds() {
  if (!optionalServices.ads || document.querySelector('[data-minuto106-ads]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsClient)}`;
  script.dataset.minuto106Ads = 'true';
  document.head.append(script);
}

function applyConsent(consent) {
  updateGoogleConsent(consent);
  if (consent?.ads) loadAds();
}

function closeConsentUi() {
  const banner = document.querySelector('#cookieBanner');
  const dialog = document.querySelector('#cookieDialog');
  if (banner) {
    banner.hidden = true;
    banner.setAttribute('aria-hidden', 'true');
  }
  if (dialog?.open) dialog.close();
  const chip = document.querySelector('#privacyChip');
  if (chip) chip.hidden = false;
}

function writeConsent(value) {
  const consent = {
    analytics: optionalServices.analytics && Boolean(value.analytics),
    ads: optionalServices.ads && Boolean(value.ads),
    policyVersion: 2,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(privacyBootstrap.CONSENT_KEY, JSON.stringify(consent));
  applyConsent(consent);
  closeConsentUi();
  return consent;
}

function updateSettingsAvailability() {
  const analyticsRow = document.querySelector('#analyticsConsentRow');
  const adsRow = document.querySelector('#adsConsentRow');
  const analytics = document.querySelector('#analyticsConsent');
  const ads = document.querySelector('#adsConsent');
  if (analyticsRow) analyticsRow.hidden = !optionalServices.analytics;
  if (adsRow) adsRow.hidden = !optionalServices.ads;
  if (analytics) analytics.disabled = !optionalServices.analytics;
  if (ads) ads.disabled = !optionalServices.ads;

  const copy = document.querySelector('#optionalConsentCopy');
  if (copy) {
    copy.textContent = optionalServices.ads
      ? 'El almacenamiento técnico permanece activo. Elige por separado analítica y publicidad.'
      : 'El almacenamiento técnico permanece activo. Google Analytics es opcional y no se habilita sin tu consentimiento.';
  }
}

function openSettings() {
  const dialog = document.querySelector('#cookieDialog');
  if (!dialog) return;
  const consent = readConsent() || { analytics: false, ads: false };
  const analytics = document.querySelector('#analyticsConsent');
  const ads = document.querySelector('#adsConsent');
  updateSettingsAvailability();
  if (analytics) analytics.checked = Boolean(consent.analytics);
  if (ads) ads.checked = Boolean(consent.ads);
  dialog.showModal();
}

function ensurePrivacyChip() {
  let chip = document.querySelector('#privacyChip');
  if (chip) return chip;
  chip = document.createElement('button');
  chip.id = 'privacyChip';
  chip.className = 'privacy-chip';
  chip.type = 'button';
  chip.textContent = 'Privacidad';
  chip.addEventListener('click', openSettings);
  document.body.append(chip);
  return chip;
}

function bindConsentUi() {
  document.querySelector('#acceptCookies')?.addEventListener('click', () => writeConsent({
    analytics: optionalServices.analytics,
    ads: optionalServices.ads,
  }));
  document.querySelector('#rejectCookies')?.addEventListener('click', () => writeConsent({ analytics: false, ads: false }));
  document.querySelector('#configureCookies')?.addEventListener('click', openSettings);
  document.querySelector('#openCookieSettings')?.addEventListener('click', openSettings);
  document.querySelector('#closeCookieDialog')?.addEventListener('click', () => document.querySelector('#cookieDialog')?.close());
  document.querySelector('#saveCookieSettings')?.addEventListener('click', () => {
    writeConsent({
      analytics: document.querySelector('#analyticsConsent')?.checked,
      ads: document.querySelector('#adsConsent')?.checked,
    });
  });
}

function initializeConsent() {
  const existing = readConsent();
  const banner = document.querySelector('#cookieBanner');
  const chip = ensurePrivacyChip();
  updateSettingsAvailability();
  bindConsentUi();

  if (existing) {
    applyConsent(existing);
    if (banner) banner.hidden = true;
    chip.hidden = false;
  } else {
    applyConsent({ analytics: false, ads: false });
    if (banner) {
      banner.hidden = false;
      banner.removeAttribute('aria-hidden');
    }
    chip.hidden = true;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeConsent, { once: true });
} else {
  initializeConsent();
}
