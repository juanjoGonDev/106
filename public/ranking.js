const rankingConfig = window.__MINUTO106_CONFIG__ ?? {};
const rankingApi = String(rankingConfig.apiBaseUrl ?? '').replace(/\/$/, '');
const rankingDevice = localStorage.getItem('minuto106:device-id') || crypto.randomUUID();
localStorage.setItem('minuto106:device-id', rankingDevice);

async function rankingRequest(action, payload = {}) {
  const response = await fetch(rankingApi, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-id': rankingDevice }, body: JSON.stringify({ action, ...payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo cargar la clasificación.');
  return body;
}
function rankingEscape(value) { return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); }
function formatDifference(value) { return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : '—'; }

async function loadRanking() {
  const list = document.querySelector('#fullRanking');
  try {
    const stats = await rankingRequest('stats');
    const entries = stats.leaderboard || [];
    list.innerHTML = entries.length ? entries.map((entry, index) => `<li data-nick="${rankingEscape(entry.nick)}" tabindex="0"><span class="rank">#${index + 1}</span><span class="player">${rankingEscape(entry.nick)}<small>${entry.team === 'spain' ? 'España' : 'Argentina'} · ${(Number(entry.elapsedMs) / 1000).toFixed(3)} s</small></span><span class="difference">${formatDifference(entry.differenceMs)}</span></li>`).join('') : '<li class="empty">Todavía no hay resultados verificados.</li>';
  } catch (error) { list.innerHTML = `<li class="empty">${rankingEscape(error.message)}</li>`; }
}

async function showProfile(nick) {
  const card = document.querySelector('#rankingProfile');
  const profile = await rankingRequest('public-profile', { nick });
  if (!profile?.nick) throw new Error('No se encontró el jugador.');
  card.hidden = false;
  card.innerHTML = `<p class="eyebrow">PERFIL PÚBLICO</p><h2>${rankingEscape(profile.nick)}</h2><div class="profile-grid"><div><span>Mejor marca</span><strong>${formatDifference(profile.bestDifferenceMs)}</strong></div><div><span>Media</span><strong>${formatDifference(profile.averageDifferenceMs)}</strong></div><div><span>Puesto global</span><strong>${profile.globalRankBest ? `#${profile.globalRankBest}` : '—'}</strong></div><div><span>Intentos válidos</span><strong>${profile.verifiedAttempts || 0}</strong></div></div>`;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.querySelector('#fullRanking')?.addEventListener('click', (event) => { const row = event.target.closest('[data-nick]'); if (row) showProfile(row.dataset.nick).catch((error) => alert(error.message)); });
document.querySelector('#rankingSearchButton')?.addEventListener('click', () => { const nick = document.querySelector('#rankingSearch').value.trim(); if (nick) showProfile(nick).catch((error) => alert(error.message)); });
loadRanking();