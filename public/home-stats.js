(() => {
  if (window.Minuto106HomeStats) return;

  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const nativeFetch = window.fetch.bind(window);
  const listeners = new Set();
  const CACHE_RETENTION_MS = 1_000;

  let cachedStatsResponse = null;
  let cachedStatsTimer = null;
  let latestStats = null;
  let presentationTimer = null;
  let presentationFrame = null;
  let presentationRevision = 0;

  function requestAction(init) {
    if (typeof init?.body !== 'string') return '';
    try {
      return String(JSON.parse(init.body)?.action || '');
    } catch {
      return '';
    }
  }

  function requestUrl(input) {
    if (typeof input === 'string') return input.replace(/\/$/, '');
    if (input instanceof URL) return input.toString().replace(/\/$/, '');
    if (input instanceof Request) return input.url.replace(/\/$/, '');
    return '';
  }

  function isHomeStatsRequest(input, init) {
    return Boolean(apiUrl) && requestUrl(input) === apiUrl && requestAction(init) === 'stats';
  }

  function clearCachedStatsResponse() {
    window.clearTimeout(cachedStatsTimer);
    cachedStatsTimer = null;
    cachedStatsResponse = null;
  }

  function retainCachedStatsResponse() {
    window.clearTimeout(cachedStatsTimer);
    cachedStatsTimer = window.setTimeout(clearCachedStatsResponse, CACHE_RETENTION_MS);
  }

  function fullNumber(value) {
    const formatter = window.Minuto106Format;
    if (formatter) return formatter.fullNumber(value);
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric).toLocaleString('es-ES') : '0';
  }

  function compactNumber(value) {
    const formatter = window.Minuto106Format;
    if (formatter) return formatter.compactNumber(value);
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    if (Math.abs(numeric) < 1_000) return Math.round(numeric).toLocaleString('es-ES');
    const compact = numeric / 1_000;
    return `${Number(compact.toFixed(compact < 100 && !Number.isInteger(compact) ? 1 : 0))}K`;
  }

  function setCompactValue(selector, value) {
    const target = document.querySelector(selector);
    if (!target) return;
    target.textContent = compactNumber(value);
    target.title = fullNumber(value);
  }

  function resolveTeam(team) {
    if (team === 'spain') return Object.freeze({ key: 'spain', name: 'España', flagClass: 'flag--spain' });
    if (team === 'argentina') return Object.freeze({ key: 'argentina', name: 'Argentina', flagClass: 'flag--argentina' });
    return null;
  }

  function createFlag(team) {
    const flag = document.createElement('span');
    flag.className = `flag ranking-flag ${team.flagClass}`;
    flag.setAttribute('role', 'img');
    flag.setAttribute('aria-label', team.name);
    return flag;
  }

  function createLeaderboardRow(entry, index) {
    const team = resolveTeam(entry.team);
    const nick = String(entry.nick || '').trim();
    const elapsedMs = Number(entry.elapsedMs);
    const differenceMs = Number(entry.differenceMs);
    if (!team || !nick || !Number.isFinite(elapsedMs) || !Number.isFinite(differenceMs)) return null;

    const row = document.createElement('li');
    row.className = `leaderboard-row${index === 0 ? ' leader' : ''}`;
    row.dataset.team = team.key;
    row.dataset.homeRankingReady = 'true';

    const anchor = document.createElement('a');
    anchor.className = 'leaderboard-row-link';
    anchor.href = window.Minuto106PlayerUI?.playerUrl(nick) || `./ranking.html?nick=${encodeURIComponent(nick)}`;
    anchor.dataset.playerNick = nick;
    anchor.setAttribute('aria-label', `Ver perfil de ${nick}`);

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = `#${index + 1}`;

    const player = document.createElement('span');
    player.className = 'player ranking-player ranking-player--home';

    const identity = document.createElement('span');
    identity.className = 'ranking-player__identity';
    const nickElement = document.createElement('span');
    nickElement.className = 'player-link__nick';
    nickElement.textContent = nick;
    identity.append(createFlag(team), nickElement);

    const time = document.createElement('small');
    time.className = 'ranking-time';
    time.textContent = `${(elapsedMs / 1_000).toFixed(3)}s`;
    player.append(identity, time);

    const difference = document.createElement('span');
    difference.className = 'difference';
    difference.textContent = `±${differenceMs.toLocaleString('es-ES')} ms`;

    anchor.append(rank, player, difference);
    row.append(anchor);
    return row;
  }

  function renderLeaderboard(stats) {
    const list = document.querySelector('#leaderboard');
    if (!list) return;

    const entries = Array.isArray(stats?.leaderboard) ? stats.leaderboard.slice(0, 10) : [];
    const rows = entries.map(createLeaderboardRow).filter(Boolean);
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Aún no hay marcas verificadas. Sé el primero.';
      list.replaceChildren(empty);
      list.removeAttribute('aria-busy');
      list.dataset.renderState = 'empty';
      return;
    }

    list.replaceChildren(...rows);
    list.removeAttribute('aria-busy');
    list.dataset.renderState = 'ready';
  }

  function renderStats(stats) {
    const teams = Array.isArray(stats?.teams) ? stats.teams : [];
    const spain = teams.find((team) => team.team === 'spain') ?? { score: 0 };
    const argentina = teams.find((team) => team.team === 'argentina') ?? { score: 0 };
    const spainScore = Number(spain.score || 0);
    const argentinaScore = Number(argentina.score || 0);
    const totalScore = spainScore + argentinaScore;
    const spainPercent = totalScore ? Math.round((spainScore / totalScore) * 100) : 50;

    setCompactValue('#spainScore', spainScore);
    setCompactValue('#argentinaScore', argentinaScore);
    setCompactValue('#globalPlayers', stats?.totalPlayers);
    setCompactValue('#verifiedAttempts', stats?.verifiedAttempts);
    setCompactValue('#perfectAttempts', stats?.perfectAttempts);

    const battleFill = document.querySelector('#battleFill');
    if (battleFill) battleFill.style.width = `${spainPercent}%`;
    const battlePercent = document.querySelector('#battlePercent');
    if (battlePercent) battlePercent.textContent = `${spainPercent}% · ${100 - spainPercent}%`;
    const battleTrack = document.querySelector('#battleTrack');
    if (battleTrack) battleTrack.setAttribute('aria-valuenow', String(spainPercent));
    const totalAttempts = document.querySelector('#totalAttempts');
    if (totalAttempts) totalAttempts.textContent = `${fullNumber(stats?.totalAttempts)} intentos`;

    renderLeaderboard(stats);
  }

  function notify(stats, source) {
    for (const listener of listeners) listener(stats, source);
    document.dispatchEvent(new CustomEvent('minuto106:home-stats-ready', {
      detail: Object.freeze({ stats, source }),
    }));
  }

  function schedulePresentation(stats, source) {
    const revision = ++presentationRevision;
    window.clearTimeout(presentationTimer);
    if (presentationFrame !== null) window.cancelAnimationFrame(presentationFrame);

    presentationTimer = window.setTimeout(() => {
      presentationFrame = window.requestAnimationFrame(() => {
        presentationFrame = window.requestAnimationFrame(() => {
          if (revision !== presentationRevision) return;
          renderStats(stats);
          notify(stats, source);
        });
      });
    }, 0);
  }

  function commit(stats, source = 'network') {
    if (!stats || typeof stats !== 'object') return;
    latestStats = stats;
    schedulePresentation(stats, source);
  }

  async function createCachedStatsResponse(input, init) {
    const response = await nativeFetch(input, init);
    const canonical = response.clone();
    if (!response.ok) {
      clearCachedStatsResponse();
      return canonical;
    }

    const stats = await response.clone().json().catch(() => null);
    if (stats) commit(stats, 'network');
    retainCachedStatsResponse();
    return canonical;
  }

  function fetchHomeStats(input, init) {
    if (!cachedStatsResponse) cachedStatsResponse = createCachedStatsResponse(input, init).catch((error) => {
      clearCachedStatsResponse();
      throw error;
    });

    return cachedStatsResponse.then((response) => {
      if (latestStats) schedulePresentation(latestStats, 'cache');
      return response.clone();
    });
  }

  window.fetch = function minuto106HomeStatsFetch(input, init = {}) {
    if (isHomeStatsRequest(input, init)) return fetchHomeStats(input, init);
    return nativeFetch(input, init);
  };

  document.addEventListener('minuto106:attempt-finished', (event) => {
    if (event.detail?.stats) commit(event.detail.stats, 'finish');
  });

  window.Minuto106HomeStats = Object.freeze({
    get snapshot() { return latestStats; },
    commit,
    subscribe(listener, { replay = true } = {}) {
      if (typeof listener !== 'function') throw new TypeError('Home stats listener must be a function.');
      listeners.add(listener);
      if (replay && latestStats) listener(latestStats, 'replay');
      return () => listeners.delete(listener);
    },
  });
})();
