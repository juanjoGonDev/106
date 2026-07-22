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

function showRankingError(error, title = 'No se pudo cargar el jugador') {
  return window.Minuto106UI?.error({
    title,
    message: error instanceof Error ? error.message : String(error || 'Se produjo un error inesperado.'),
  }) ?? Promise.resolve();
}

function rankingEscape(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function formatDifference(value) {
  return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : '—';
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function trophyName(type) {
  return ({ golden_boot: 'Bota de Oro', golden_glove: 'Guante de Oro', golden_ball: 'Balón de Oro' })[type] || 'Trofeo';
}

function renderPrecision(entries) {
  const list = document.querySelector('#fullRanking');
  list.innerHTML = entries.length
    ? entries.map((entry, index) => `<li data-nick="${rankingEscape(entry.nick)}" tabindex="0"><span class="rank">#${index + 1}</span><span class="player">${rankingEscape(entry.nick)}<small>${entry.team === 'spain' ? 'España' : 'Argentina'} · ${(Number(entry.elapsedMs) / 1000).toFixed(3)} s</small></span><span class="difference">${formatDifference(entry.differenceMs)}</span></li>`).join('')
    : '<li class="empty">Todavía no hay resultados verificados.</li>';
}

function renderTrophies(entries) {
  const list = document.querySelector('#trophyLeaderboard');
  list.innerHTML = entries.length
    ? entries.map((entry) => `<li data-nick="${rankingEscape(entry.nick)}" tabindex="0"><span class="rank">#${entry.rank}</span><span class="player">${rankingEscape(entry.nick)}<small>⚽ ${entry.goldenBoot} · 🧤 ${entry.goldenGlove} · 🏆 ${entry.goldenBall} · ${entry.trophyDays} días premiado</small></span><span class="difference">${entry.totalTrophies} trofeos</span></li>`).join('')
    : '<li class="empty">Todavía no hay trofeos diarios cerrados.</li>';
}

function renderAchievements(entries) {
  const list = document.querySelector('#achievementLeaderboard');
  list.innerHTML = entries.length
    ? entries.map((entry) => `<li data-nick="${rankingEscape(entry.nick)}" tabindex="0"><span class="rank">#${entry.rank}</span><span class="player">${rankingEscape(entry.nick)}<small>${entry.totalAchievements} logros · ${entry.totalTrophies} trofeos</small></span><span class="difference">${entry.achievementPoints} pt</span></li>`).join('')
    : '<li class="empty">Todavía no hay logros desbloqueados.</li>';
}

async function loadRanking() {
  try {
    const stats = await rankingRequest('stats');
    renderPrecision(Array.isArray(stats.leaderboard) ? stats.leaderboard : []);
    renderTrophies(Array.isArray(stats.honoursRankings?.trophies) ? stats.honoursRankings.trophies : []);
    renderAchievements(Array.isArray(stats.honoursRankings?.achievements) ? stats.honoursRankings.achievements : []);
  } catch (error) {
    const message = rankingEscape(error instanceof Error ? error.message : 'No se pudo cargar.');
    for (const selector of ['#fullRanking', '#trophyLeaderboard', '#achievementLeaderboard']) {
      document.querySelector(selector).innerHTML = `<li class="empty">${message}</li>`;
    }
  }
}

function profileShareUrl(profile) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('nick', profile.nick);
  url.hash = '';
  return url.toString();
}

async function shareProfile(profile) {
  const trophies = Number(profile.trophies?.total || 0);
  const achievements = Number(profile.achievements?.total || 0);
  await window.Minuto106UI?.share({
    title: `${profile.nick} · Minuto 106`,
    text: `Este es mi palmarés en Minuto 106: ${trophies} ${trophies === 1 ? 'trofeo' : 'trofeos'}, ${achievements} ${achievements === 1 ? 'logro' : 'logros'} y ${profile.achievements?.points || 0} puntos. ¿Me superas?`,
    url: profileShareUrl(profile),
  });
}

function renderProfile(profile, comparedProfile = null) {
  const card = document.querySelector('#rankingProfile');
  card.hidden = false;
  const trophies = profile.trophies || {};
  const achievements = profile.achievements || {};
  const trophyHistory = Array.isArray(trophies.history) ? trophies.history.slice(0, 20) : [];
  const achievementItems = Array.isArray(achievements.items) ? achievements.items.slice(0, 20) : [];
  card.innerHTML = `
    <button class="ghost compact profile-close" id="closeRankingProfile" type="button">Cerrar</button>
    <p class="eyebrow">PERFIL PÚBLICO GLOBAL</p>
    <h2>${rankingEscape(profile.nick)}</h2>
    <div class="profile-grid">
      <div><span>Mejor marca global</span><strong>${formatDifference(profile.bestDifferenceMs)}</strong></div>
      <div><span>Media global</span><strong>${formatDifference(profile.averageDifferenceMs)}</strong></div>
      <div><span>Puesto global</span><strong>${profile.globalRankBest ? `#${profile.globalRankBest}` : '—'}</strong></div>
      <div><span>Intentos válidos</span><strong>${profile.verifiedAttempts || 0}</strong></div>
    </div>
    <section class="honours-summary">
      <h3>Palmarés</h3>
      <div class="honours-counts">
        <div><span>Trofeos</span><strong>${trophies.total || 0}${trophies.rank ? ` · #${trophies.rank}` : ''}</strong></div>
        <div><span>Bota de Oro</span><strong>${trophies.goldenBoot || 0}</strong></div>
        <div><span>Guante de Oro</span><strong>${trophies.goldenGlove || 0}</strong></div>
        <div><span>Balón de Oro</span><strong>${trophies.goldenBall || 0}</strong></div>
        <div><span>Logros</span><strong>${achievements.total || 0}</strong></div>
        <div><span>Puntos</span><strong>${achievements.points || 0}${achievements.rank ? ` · #${achievements.rank}` : ''}</strong></div>
      </div>
      ${trophyHistory.length ? `<h3>Trofeos conseguidos</h3><ol class="honours-list">${trophyHistory.map((trophy) => `<li><span class="honours-badge">🏆</span><span><strong>${trophyName(trophy.type)}</strong><small>${formatDate(trophy.date)}</small></span><span>${trophy.type === 'golden_ball' ? `${trophy.value} intentos` : `±${trophy.value} ms`}</span></li>`).join('')}</ol>` : '<p class="empty">Sin trofeos cerrados.</p>'}
      ${achievementItems.length ? `<h3>Logros desbloqueados</h3><ol class="honours-list">${achievementItems.map((achievement) => `<li><span class="honours-badge">★</span><span><strong>${rankingEscape(achievement.title)}</strong><small>${rankingEscape(achievement.description)} · ${formatDate(achievement.date)}</small></span><span>${achievement.points} pt</span></li>`).join('')}</ol>` : '<p class="empty">Sin logros.</p>'}
      <button id="shareRankingProfile" class="secondary honours-share" type="button">Compartir palmarés</button>
    </section>
    <section class="player-radar">
      <h3>${comparedProfile ? 'Comparación de jugadores' : 'Perfil de juego global'}</h3>
      <div id="rankingRadar"></div>
      <div class="profile-compare">
        <input id="rankingCompareNick" maxlength="24" autocomplete="off" data-bwignore="true" data-1p-ignore placeholder="Nick para comparar" aria-label="Nick para comparar">
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

function selectRanking(tabName) {
  document.querySelectorAll('[data-ranking-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.rankingTab === tabName));
  });
  document.querySelectorAll('[data-ranking-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.rankingPanel !== tabName;
  });
}

for (const selector of ['#fullRanking', '#trophyLeaderboard', '#achievementLeaderboard']) {
  document.querySelector(selector)?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-nick]');
    if (row) showProfile(row.dataset.nick).catch(showRankingError);
  });
  document.querySelector(selector)?.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const row = event.target.closest('[data-nick]');
    if (!row) return;
    event.preventDefault();
    showProfile(row.dataset.nick).catch(showRankingError);
  });
}

document.querySelector('.ranking-tabs')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-ranking-tab]');
  if (button) selectRanking(button.dataset.rankingTab);
});
document.querySelector('#rankingSearchButton')?.addEventListener('click', () => {
  const nick = document.querySelector('#rankingSearch').value.trim();
  if (nick) showProfile(nick).catch(showRankingError);
});
document.querySelector('#rankingSearch')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const nick = event.currentTarget.value.trim();
  if (nick) showProfile(nick).catch(showRankingError);
});
document.querySelector('#rankingProfile')?.addEventListener('click', (event) => {
  if (event.target.closest('#closeRankingProfile')) closeProfile();
  if (event.target.closest('#rankingCompareButton')) compareProfile().catch((error) => showRankingError(error, 'No se pudo comparar'));
  if (event.target.closest('#shareRankingProfile') && primaryProfile) shareProfile(primaryProfile).catch((error) => showRankingError(error, 'No se pudo compartir'));
});

const requestedNick = new URLSearchParams(location.search).get('nick')?.trim();
loadRanking().then(() => {
  if (requestedNick) showProfile(requestedNick).catch(showRankingError);
});
