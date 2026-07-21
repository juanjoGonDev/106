const rankingConfig = window.__MINUTO106_CONFIG__ ?? {};
const rankingApi = String(rankingConfig.apiBaseUrl ?? '').replace(/\/$/, '');
const rankingDevice = localStorage.getItem('minuto106:device-id') || crypto.randomUUID();
localStorage.setItem('minuto106:device-id', rankingDevice);
let primaryProfile = null;

async function rankingRequest(action, payload = {}) {
  const response = await fetch(rankingApi, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': rankingDevice },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo cargar la clasificación.');
  return body;
}

function rankingEscape(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}
function formatDifference(value) {
  return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : '—';
}

async function loadRanking() {
  const list = document.querySelector('#fullRanking');
  try {
    const stats = await rankingRequest('stats');
    const entries = stats.leaderboard || [];
    list.innerHTML = entries.length
      ? entries.map((entry, index) => `<li data-nick="${rankingEscape(entry.nick)}" tabindex="0"><span class="rank">#${index + 1}</span><span class="player">${rankingEscape(entry.nick)}<small>${entry.team === 'spain' ? 'España' : 'Argentina'} · ${(Number(entry.elapsedMs) / 1000).toFixed(3)} s</small></span><span class="difference">${formatDifference(entry.differenceMs)}</span></li>`).join('')
      : '<li class="empty">Todavía no hay resultados verificados.</li>';
  } catch (error) {
    list.innerHTML = `<li class="empty">${rankingEscape(error instanceof Error ? error.message : 'No se pudo cargar.')}</li>`;
  }
}

function renderProfile(profile, comparedProfile = null) {
  const card = document.querySelector('#rankingProfile');
  card.hidden = false;
  card.innerHTML = `
    <button class="ghost compact profile-close" id="closeRankingProfile" type="button">Cerrar</button>
    <p class="eyebrow">PERFIL PÚBLICO</p>
    <h2>${rankingEscape(profile.nick)}</h2>
    <div class="profile-grid">
      <div><span>Mejor marca</span><strong>${formatDifference(profile.bestDifferenceMs)}</strong></div>
      <div><span>Media</span><strong>${formatDifference(profile.averageDifferenceMs)}</strong></div>
      <div><span>Puesto global</span><strong>${profile.globalRankBest ? `#${profile.globalRankBest}` : '—'}</strong></div>
      <div><span>Intentos válidos</span><strong>${profile.verifiedAttempts || 0}</strong></div>
    </div>
    <section class="player-radar">
      <h3>${comparedProfile ? 'Comparación de jugadores' : 'Perfil de juego'}</h3>
      <div id="rankingRadar"></div>
      <div class="profile-compare">
        <input id="rankingCompareNick" maxlength="24" placeholder="Nick para comparar" aria-label="Nick para comparar">
        <button id="rankingCompareButton" class="secondary compact" type="button">Comparar</button>
      </div>
    </section>`;
  const series = [{ profile, label: profile.nick }];
  if (comparedProfile) series.push({ profile: comparedProfile, label: comparedProfile.nick });
  window.Minuto106PlayerStats?.renderPlayerRadar(document.querySelector('#rankingRadar'), series);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function showProfile(nick) {
  const profile = await rankingRequest('public-profile', { nick });
  if (!profile?.nick) throw new Error('No se encontró el jugador.');
  primaryProfile = profile;
  renderProfile(profile);
}

async function compareProfile() {
  const nick = document.querySelector('#rankingCompareNick')?.value.trim();
  if (!nick || !primaryProfile) return;
  const compared = await rankingRequest('public-profile', { nick });
  if (!compared?.nick) throw new Error('No se encontró el jugador para comparar.');
  renderProfile(primaryProfile, compared);
}

function closeProfile() {
  const card = document.querySelector('#rankingProfile');
  card.hidden = true;
  card.replaceChildren();
  primaryProfile = null;
}

document.querySelector('#fullRanking')?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-nick]');
  if (row) showProfile(row.dataset.nick).catch((error) => alert(error.message));
});
document.querySelector('#rankingSearchButton')?.addEventListener('click', () => {
  const nick = document.querySelector('#rankingSearch').value.trim();
  if (nick) showProfile(nick).catch((error) => alert(error.message));
});
document.querySelector('#rankingProfile')?.addEventListener('click', (event) => {
  if (event.target.closest('#closeRankingProfile')) closeProfile();
  if (event.target.closest('#rankingCompareButton')) compareProfile().catch((error) => alert(error.message));
});

const requestedNick = new URLSearchParams(location.search).get('nick')?.trim();
loadRanking().then(() => {
  if (requestedNick) showProfile(requestedNick).catch((error) => alert(error.message));
});