const CONSENT_KEY = 'minuto106:consent-v1';
const consentConfig = window.__MINUTO106_CONFIG__ ?? {};

function readConsent() {
  try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); } catch { return null; }
}

function writeConsent(value) {
  const consent = { analytics: Boolean(value.analytics), ads: Boolean(value.ads), updatedAt: new Date().toISOString() };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  applyConsent(consent);
  return consent;
}

function loadAnalytics() {
  const id = String(consentConfig.googleAnalyticsId || '').trim();
  if (!id || document.querySelector('[data-minuto106-ga]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  script.dataset.minuto106Ga = 'true';
  document.head.append(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  window.gtag('config', id, { anonymize_ip: true });
}

function loadAds() {
  const client = String(consentConfig.adSenseClient || '').trim();
  if (!client || document.querySelector('[data-minuto106-ads]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  script.dataset.minuto106Ads = 'true';
  document.head.append(script);
}

function applyConsent(consent) {
  if (consent?.analytics) loadAnalytics();
  if (consent?.ads) loadAds();
  const banner = document.querySelector('#cookieBanner');
  if (banner) banner.hidden = true;
}

function openSettings() {
  const dialog = document.querySelector('#cookieDialog');
  const consent = readConsent() || { analytics: false, ads: false };
  const analytics = document.querySelector('#analyticsConsent');
  const ads = document.querySelector('#adsConsent');
  if (analytics) analytics.checked = Boolean(consent.analytics);
  if (ads) ads.checked = Boolean(consent.ads);
  dialog?.showModal();
}

document.addEventListener('DOMContentLoaded', () => {
  const existing = readConsent();
  const banner = document.querySelector('#cookieBanner');
  if (existing) applyConsent(existing);
  else if (banner) banner.hidden = false;

  document.querySelector('#acceptCookies')?.addEventListener('click', () => writeConsent({ analytics: true, ads: true }));
  document.querySelector('#rejectCookies')?.addEventListener('click', () => writeConsent({ analytics: false, ads: false }));
  document.querySelector('#configureCookies')?.addEventListener('click', openSettings);
  document.querySelector('#openCookieSettings')?.addEventListener('click', openSettings);
  document.querySelector('#closeCookieDialog')?.addEventListener('click', () => document.querySelector('#cookieDialog')?.close());
  document.querySelector('#saveCookieSettings')?.addEventListener('click', () => {
    writeConsent({
      analytics: document.querySelector('#analyticsConsent')?.checked,
      ads: document.querySelector('#adsConsent')?.checked,
    });
    document.querySelector('#cookieDialog')?.close();
  });
});