const rankingConfig = window.__MINUTO106_CONFIG__ ?? {};
const rankingApi = String(rankingConfig.apiBaseUrl ?? '').replace(/\/$/, '');
const rankingDevice = localStorage.getItem('minuto106:device-id') || crypto.randomUUID();
const playerUi = window.Minuto106PlayerUI;
localStorage.setItem('minuto106:device-id', rankingDevice);

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

function escape(value) {
  return playerUi.escapeHtml(value);
}

function formatDifference(value) {
  return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : '—';
}

function playerRow({ rank, nick, team, summary, metric, leader = false, section = 'overview' }) {
  const href = playerUi.playerUrl(nick, section);
  return `<li class="leaderboard-row${leader ? ' leader' : ''}" data-nick="${escape(nick)}" data-team="${escape(team || '')}"><a class="leaderboard-row-link" href="${escape(href)}" data-player-nick="${escape(nick)}"><span class="rank">#${rank}</span><span class="ranking-player"><span>${escape(nick)}</span>${playerUi.teamHtml(team)}<small>${escape(summary)}</small></span><span class="difference">${escape(metric)}</span></a></li>`;
}

function renderPrecision(entries) {
  const list = document.querySelector('#fullRanking');
  list.innerHTML = entries.length
    ? entries.map((entry, index) => playerRow({
      rank: index + 1,
      nick: entry.nick,
      team: entry.team,
      summary: `${(Number(entry.elapsedMs) / 1000).toFixed(3)} s`,
      metric: formatDifference(entry.differenceMs),
      leader: index === 0,
    })).join('')
    : '<li class="empty">Todavía no hay resultados verificados.</li>';
}

function renderTrophies(entries) {
  const list = document.querySelector('#trophyLeaderboard');
  list.innerHTML = entries.length
    ? entries.map((entry) => playerRow({
      rank: entry.rank,
      nick: entry.nick,
      team: entry.team,
      summary: `⚽ ${entry.goldenBoot} · 🧤 ${entry.goldenGlove} · 🏆 ${entry.goldenBall} · ${entry.trophyDays} días premiado`,
      metric: `${entry.totalTrophies} trofeos`,
      section: 'trophies',
    })).join('')
    : '<li class="empty">Todavía no hay trofeos diarios cerrados.</li>';
}

function renderAchievements(entries) {
  const list = document.querySelector('#achievementLeaderboard');
  list.innerHTML = entries.length
    ? entries.map((entry) => playerRow({
      rank: entry.rank,
      nick: entry.nick,
      team: entry.team,
      summary: `${entry.totalAchievements} logros · ${entry.totalTrophies} trofeos`,
      metric: `${entry.achievementPoints} pt`,
      section: 'achievements',
    })).join('')
    : '<li class="empty">Todavía no hay logros desbloqueados.</li>';
}

async function loadRanking() {
  try {
    const stats = await rankingRequest('stats');
    renderPrecision(Array.isArray(stats.leaderboard) ? stats.leaderboard : []);
    renderTrophies(Array.isArray(stats.honoursRankings?.trophies) ? stats.honoursRankings.trophies : []);
    renderAchievements(Array.isArray(stats.honoursRankings?.achievements) ? stats.honoursRankings.achievements : []);
  } catch (error) {
    const message = escape(error instanceof Error ? error.message : 'No se pudo cargar.');
    for (const selector of ['#fullRanking', '#trophyLeaderboard', '#achievementLeaderboard']) {
      document.querySelector(selector).innerHTML = `<li class="empty">${message}</li>`;
    }
  }
}

function selectRanking(tabName) {
  const selected = ['precision', 'trophies', 'achievements'].includes(tabName) ? tabName : 'precision';
  document.querySelectorAll('[data-ranking-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.rankingTab === selected));
    button.tabIndex = button.dataset.rankingTab === selected ? 0 : -1;
  });
  document.querySelectorAll('[data-ranking-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.rankingPanel !== selected;
  });
  history.replaceState(null, '', selected === 'precision' ? location.pathname : `#${selected}`);
}

function openSearchedPlayer() {
  const nick = document.querySelector('#rankingSearch')?.value.trim();
  if (nick) location.assign(playerUi.playerUrl(nick));
}

document.querySelector('.ranking-tabs')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-ranking-tab]');
  if (button) selectRanking(button.dataset.rankingTab);
});
document.querySelector('#rankingSearchButton')?.addEventListener('click', openSearchedPlayer);
document.querySelector('#rankingSearch')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') openSearchedPlayer();
});

const requestedNick = new URLSearchParams(location.search).get('nick')?.trim();
if (requestedNick) location.replace(playerUi.playerUrl(requestedNick));
else {
  selectRanking(location.hash.replace('#', ''));
  loadRanking();
}