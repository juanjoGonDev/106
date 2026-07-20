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

function escapeV4(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function teamLabel(team) { return team === 'spain' ? 'España' : 'Argentina'; }

function renderFallbackRanking(stats) {
  const list = v4$('#leaderboard');
  if (!list) return;
  const entries = Array.isArray(stats.leaderboard) ? stats.leaderboard.slice(0, 10) : [];
  if (!entries.length) {
    list.innerHTML = '<li class="empty">Aún no hay marcas verificadas. Sé el primero.</li>';
    return;
  }
  list.innerHTML = entries.map((entry, index) => `<li class="${index === 0 ? 'leader' : ''}" tabindex="0"><span class="rank">#${index + 1}</span><span class="player">${escapeV4(entry.nick)}<small>${teamLabel(entry.team)} · ${(Number(entry.elapsedMs) / 1000).toFixed(3)} s</small></span><span class="difference">±${Number(entry.differenceMs).toLocaleString('es-ES')} ms</span></li>`).join('');
  const total = v4$('#totalAttempts');
  if (total) total.textContent = `${Number(stats.totalAttempts || 0).toLocaleString('es-ES')} intentos`;
}

async function ensureInitialRanking(attempt = 0) {
  if (!v4ApiUrl || v4ApiUrl.includes('YOUR_PROJECT_REF')) return;
  try {
    const stats = await v4Request('stats');
    renderFallbackRanking(stats);
  } catch {
    if (attempt < 3) setTimeout(() => ensureInitialRanking(attempt + 1), 900 * (attempt + 1));
    else {
      const list = v4$('#leaderboard');
      if (list && list.querySelector('.empty')) list.innerHTML = '<li class="empty">No se pudo cargar el ranking. Revisa la conexión.</li>';
    }
  }
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
  if (event.target.closest('#shareButton, #copyReferralButton')) handleCompactShare(event).catch((error) => alert(error.message));
}, true);

document.addEventListener('DOMContentLoaded', () => ensureInitialRanking());