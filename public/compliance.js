const CONSENT_KEY = 'minuto106:consent-v1';
const CONSENT_MAX_AGE_MS = 730 * 24 * 60 * 60 * 1_000;
const consentConfig = window.__MINUTO106_CONFIG__ ?? {};
const adsClient = String(consentConfig.adSenseClient || '').trim();
const optionalServices = {
  analytics: true,
  ads: Boolean(adsClient),
};
const hasOptionalServices = optionalServices.analytics || optionalServices.ads;

function readConsent() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    if (!stored) return null;
    const updatedAt = Date.parse(String(stored.updatedAt || ''));
    const age = Date.now() - updatedAt;
    if (!Number.isFinite(updatedAt) || age < 0 || age > CONSENT_MAX_AGE_MS) return null;
    return {
      analytics: optionalServices.analytics && stored.analytics === true,
      ads: optionalServices.ads && stored.ads === true,
      updatedAt: stored.updatedAt,
    };
  } catch {
    return null;
  }
}

function ensureGoogleConsentApi() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  return window.gtag;
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

function ensureConsentUi() {
  let banner = document.querySelector('#cookieBanner');
  if (!banner) {
    banner = document.createElement('section');
    banner.id = 'cookieBanner';
    banner.className = 'cookie-banner';
    banner.hidden = true;
    banner.setAttribute('aria-label', 'Preferencias de privacidad');
    banner.innerHTML = '<div><strong>Analítica opcional</strong><p>Google Tag Manager está instalado con el almacenamiento denegado por defecto. Google Analytics solo se activa si lo aceptas.</p><a href="./cookies.html">Más información</a></div><div class="cookie-actions"><button id="rejectCookies" class="secondary" type="button">Rechazar</button><button id="configureCookies" class="ghost" type="button">Configurar</button><button id="acceptCookies" class="secondary" type="button">Aceptar</button></div>';
    document.body.append(banner);
  }

  let dialog = document.querySelector('#cookieDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'cookieDialog';
    dialog.className = 'cookie-dialog';
    dialog.innerHTML = '<h2>Privacidad y almacenamiento</h2><label id="analyticsConsentRow"><input id="analyticsConsent" type="checkbox"> Analítica con Google Analytics</label><label id="adsConsentRow"><input id="adsConsent" type="checkbox"> Publicidad y medición publicitaria</label><p id="optionalConsentCopy">El almacenamiento técnico necesario permanece activo.</p><div class="cookie-actions"><button id="saveCookieSettings" class="secondary" type="button">Guardar preferencias</button><button id="closeCookieDialog" class="ghost" type="button">Cancelar</button></div>';
    document.body.append(dialog);
  }

  return { banner, dialog };
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
  const { banner, dialog } = ensureConsentUi();
  banner.hidden = true;
  banner.setAttribute('aria-hidden', 'true');
  if (dialog.open) dialog.close();
  ensurePrivacyChip().hidden = false;
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

function writeConsent(value) {
  const consent = {
    analytics: optionalServices.analytics && Boolean(value.analytics),
    ads: optionalServices.ads && Boolean(value.ads),
    policyVersion: 2,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
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
  const { dialog } = ensureConsentUi();
  const consent = readConsent() || { analytics: false, ads: false };
  const analytics = document.querySelector('#analyticsConsent');
  const ads = document.querySelector('#adsConsent');
  updateSettingsAvailability();
  if (analytics) analytics.checked = Boolean(consent.analytics);
  if (ads) ads.checked = Boolean(consent.ads);
  dialog.showModal();
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

document.addEventListener('DOMContentLoaded', () => {
  const existing = readConsent();
  const { banner } = ensureConsentUi();
  const chip = ensurePrivacyChip();
  updateSettingsAvailability();
  bindConsentUi();

  if (existing) {
    applyConsent(existing);
    banner.hidden = true;
    chip.hidden = false;
  } else if (hasOptionalServices) {
    applyConsent({ analytics: false, ads: false });
    banner.hidden = false;
    banner.removeAttribute('aria-hidden');
    chip.hidden = true;
  } else {
    banner.hidden = true;
    chip.hidden = false;
  }
});
