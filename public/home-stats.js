(() => {
  if (window.Minuto106HomeStats) return;

  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const configured = Boolean(apiUrl) && !apiUrl.includes('YOUR_PROJECT_REF');
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const listeners = new Set();

  let latestStats = null;
  let loadPromise = null;

  localStorage.setItem(deviceKey, deviceId);

  function fullNumber(value) {
    const formatter = window.Minuto106Format;
    if (formatter) return formatter.fullNumber(value);
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(Math.round(numeric)) : '0';
  }

  function compactNumber(value) {
    const formatter = window.Minuto106Format;
    if (formatter) return formatter.compactNumber(value);
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    if (Math.abs(numeric) < 1_000) return String(Math.round(numeric));
    const compact = numeric / 1_000;
    return `${Number(compact.toFixed(compact < 100 && !Number.isInteger(compact) ? 1 : 0))}K`;
  }

  function setCompactValue(selector, value) {
    const target = document.querySelector(selector);
    if (!target) return;
    target.textContent = compactNumber(value);
    target.title = fullNumber(value);
  }

  function nonNegativeScore(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }

  function resolveBattleState(spainValue, argentinaValue) {
    const spainScore = nonNegativeScore(spainValue);
    const argentinaScore = nonNegativeScore(argentinaValue);
    const totalScore = spainScore + argentinaScore;
    if (totalScore <= 0) {
      return Object.freeze({
        spainScore,
        argentinaScore,
        spainPercent: 0,
        argentinaPercent: 0,
        empty: true,
        label: 'Sin puntos',
        accessibleLabel: 'Sin puntos globales verificados',
      });
    }

    const spainPercent = Math.max(0, Math.min(100, Math.round((spainScore / totalScore) * 100)));
    const argentinaPercent = 100 - spainPercent;
    return Object.freeze({
      spainScore,
      argentinaScore,
      spainPercent,
      argentinaPercent,
      empty: false,
      label: `${spainPercent}% · ${argentinaPercent}%`,
      accessibleLabel: `España ${spainPercent}%, Argentina ${argentinaPercent}%`,
    });
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
    difference.textContent = `±${fullNumber(differenceMs)} ms`;

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

  function renderBattle(stats) {
    const teams = Array.isArray(stats?.teams) ? stats.teams : [];
    const spain = teams.find((team) => team.team === 'spain') ?? { score: 0 };
    const argentina = teams.find((team) => team.team === 'argentina') ?? { score: 0 };
    const battle = resolveBattleState(spain.score, argentina.score);

    setCompactValue('#spainScore', battle.spainScore);
    setCompactValue('#argentinaScore', battle.argentinaScore);

    const battleFill = document.querySelector('#battleFill');
    if (battleFill) battleFill.style.width = `${battle.spainPercent}%`;
    const battlePercent = document.querySelector('#battlePercent');
    if (battlePercent) battlePercent.textContent = battle.label;
    const battleTrack = document.querySelector('#battleTrack');
    if (battleTrack) {
      battleTrack.classList.toggle('is-empty', battle.empty);
      battleTrack.setAttribute('aria-valuenow', String(battle.spainPercent));
      battleTrack.setAttribute('aria-valuetext', battle.accessibleLabel);
    }
  }

  function renderStats(stats) {
    renderBattle(stats);
    setCompactValue('#globalPlayers', stats?.totalPlayers);
    setCompactValue('#verifiedAttempts', stats?.verifiedAttempts);
    setCompactValue('#perfectAttempts', stats?.perfectAttempts);

    const totalAttempts = document.querySelector('#totalAttempts');
    if (totalAttempts) totalAttempts.textContent = `${fullNumber(stats?.totalAttempts)} intentos`;

    renderLeaderboard(stats);
  }

  function renderLoadError() {
    const totalAttempts = document.querySelector('#totalAttempts');
    if (totalAttempts) totalAttempts.textContent = 'No disponible';
    const list = document.querySelector('#leaderboard');
    if (!list) return;
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No se pudo cargar el ranking. Revisa la conexión.';
    list.replaceChildren(empty);
    list.removeAttribute('aria-busy');
    list.dataset.renderState = 'error';
  }

  function hasOwn(value, key) {
    return value && typeof value === 'object' && Object.hasOwn(value, key);
  }

  function preserveAwards(stats) {
    if (hasOwn(stats, 'awards') || !hasOwn(latestStats, 'awards')) return stats;
    return { ...stats, awards: latestStats.awards };
  }

  function notify(stats, source) {
    for (const listener of listeners) listener(stats, source);
    document.dispatchEvent(new CustomEvent('minuto106:home-stats-ready', {
      detail: Object.freeze({ stats, source }),
    }));
  }

  function commit(stats, source = 'manual') {
    if (!stats || typeof stats !== 'object') return false;
    const committedStats = preserveAwards(stats);
    latestStats = committedStats;
    renderStats(committedStats);
    notify(committedStats, source);
    return true;
  }

  async function requestStats() {
    if (!configured) throw new Error('Supabase aún no está configurado.');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action: 'stats' }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudieron cargar las estadísticas.');
    return body;
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = requestStats()
      .then((stats) => {
        commit(stats, 'network');
        return stats;
      })
      .catch((error) => {
        renderLoadError();
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  }

  window.Minuto106HomeStats = Object.freeze({
    get snapshot() { return latestStats; },
    commit,
    load,
    subscribe(listener, { replay = true } = {}) {
      if (typeof listener !== 'function') throw new TypeError('Home stats listener must be a function.');
      listeners.add(listener);
      if (replay && latestStats) listener(latestStats, 'replay');
      return () => listeners.delete(listener);
    },
  });

  load().catch(() => {});
})();
