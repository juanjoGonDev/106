const CONSENT_KEY = 'minuto106:consent-v1';
const consentConfig = window.__MINUTO106_CONFIG__ ?? {};
const analyticsId = String(consentConfig.googleAnalyticsId || '').trim();
const adsClient = String(consentConfig.adSenseClient || '').trim();
const optionalServices = {
  analytics: Boolean(analyticsId),
  ads: Boolean(adsClient),
};
const hasOptionalServices = optionalServices.analytics || optionalServices.ads;

function readConsent() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    if (!stored) return null;
    return {
      analytics: optionalServices.analytics && stored.analytics === true,
      ads: optionalServices.ads && stored.ads === true,
      updatedAt: stored.updatedAt,
    };
  } catch {
    return null;
  }
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

function closeConsentUi() {
  const banner = document.querySelector('#cookieBanner');
  if (banner) {
    banner.hidden = true;
    banner.setAttribute('aria-hidden', 'true');
  }
  document.querySelector('#cookieDialog')?.close();
  ensurePrivacyChip().hidden = false;
}

function writeConsent(value) {
  const consent = {
    analytics: optionalServices.analytics && Boolean(value.analytics),
    ads: optionalServices.ads && Boolean(value.ads),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  applyConsent(consent);
  closeConsentUi();
  return consent;
}

function loadAnalytics() {
  if (!optionalServices.analytics || document.querySelector('[data-minuto106-ga]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(analyticsId)}`;
  script.dataset.minuto106Ga = 'true';
  document.head.append(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('config', analyticsId, { anonymize_ip: true });
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
  if (consent?.analytics) loadAnalytics();
  if (consent?.ads) loadAds();
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
    copy.textContent = hasOptionalServices
      ? 'El almacenamiento técnico permanece activo. Elige las categorías opcionales configuradas en este sitio.'
      : 'La configuración publicada solo utiliza almacenamiento técnico necesario. No se cargan servicios de analítica ni publicidad.';
  }

  const save = document.querySelector('#saveCookieSettings');
  if (save) save.textContent = hasOptionalServices ? 'Guardar preferencias' : 'Entendido';
}

function openSettings() {
  const dialog = document.querySelector('#cookieDialog');
  const consent = readConsent() || { analytics: false, ads: false };
  const analytics = document.querySelector('#analyticsConsent');
  const ads = document.querySelector('#adsConsent');
  updateSettingsAvailability();
  if (analytics) analytics.checked = Boolean(consent.analytics);
  if (ads) ads.checked = Boolean(consent.ads);
  dialog?.showModal();
}

document.addEventListener('DOMContentLoaded', () => {
  const existing = readConsent();
  const banner = document.querySelector('#cookieBanner');
  const chip = ensurePrivacyChip();
  updateSettingsAvailability();

  if (!hasOptionalServices) {
    if (banner) banner.hidden = true;
    chip.hidden = false;
  } else if (existing) {
    applyConsent(existing);
    if (banner) banner.hidden = true;
    chip.hidden = false;
  } else {
    if (banner) banner.hidden = false;
    chip.hidden = true;
  }

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
});
