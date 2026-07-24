const v4Config = window.__MINUTO106_CONFIG__ ?? {};
const v4ApiUrl = String(v4Config.apiBaseUrl ?? '').replace(/\/$/, '');
const v4$ = (selector) => document.querySelector(selector);

async function v4Request(action, payload = {}) {
  const response = await fetch(v4ApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': localStorage.getItem('minuto106:device-id') || crypto.randomUUID() },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo cargar la información.');
  return body;
}

function showV4Error(error) {
  return window.Minuto106UI?.error({
    title: 'No se pudo compartir',
    message: error instanceof Error ? error.message : String(error || 'Se produjo un error inesperado.'),
  }) ?? Promise.resolve();
}

function referralUrl(profile) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (profile?.referralCode) url.searchParams.set('ref', profile.referralCode);
  return url.toString();
}

function shortShareText(profile, result) {
  const difference = Number(result?.differenceMs ?? profile?.bestDifferenceMs);
  const rank = Number(profile?.globalRankBest);
  const parts = [`⚽ Me he quedado a ${Number.isFinite(difference) ? `${difference} ms` : 'muy poco'} del 10.600.`];
  if (rank) parts.push(`Voy #${rank} del mundo.`);
  parts.push('¿Me superas? Completa tus 5 tiros y ganas 1 tiro extra.');
  return parts.join(' ');
}

async function handleCompactShare(event) {
  const button = event.target.closest('#shareButton, #copyReferralButton');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const nick = String(v4$('#nick')?.value || localStorage.getItem('minuto106:nick') || '').trim();
  if (!nick) return;
  const profile = await v4Request('profile', { nick });
  const history = Array.isArray(profile.history) ? profile.history : [];
  const result = history[0] || null;
  const text = shortShareText(profile, result);
  const url = referralUrl(profile);
  if (navigator.share && button.id === 'shareButton') await navigator.share({ title: 'Minuto 106', text, url });
  else {
    await navigator.clipboard.writeText(`${text} ${url}`);
    const original = button.textContent;
    button.textContent = 'Copiado';
    setTimeout(() => { button.textContent = original; }, 1400);
  }
}

document.addEventListener('click', (event) => {
  if (event.target.closest('#shareButton, #copyReferralButton')) handleCompactShare(event).catch(showV4Error);
}, true);