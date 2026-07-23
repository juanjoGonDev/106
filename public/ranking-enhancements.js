(() => {
  const ui = window.Minuto106PlayerUI;
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const teamCache = new Map();
  let awardsRequest = 0;

  localStorage.setItem(deviceKey, deviceId);
  if (!ui) return;

  function extractNick(item) {
    const player = item.querySelector('.player');
    if (!player) return '';
    return Array.from(player.childNodes)
      .find((node) => node.nodeType === Node.TEXT_NODE)
      ?.textContent?.trim() || player.querySelector('.player-link__nick')?.textContent?.trim() || '';
  }

  function extractTeam(item) {
    if (item.querySelector('.flag--spain')) return 'spain';
    if (item.querySelector('.flag--argentina')) return 'argentina';
    return '';
  }

  function enhanceLeaderboard() {
    const list = document.querySelector('#leaderboard');
    if (!list) return;
    for (const item of list.querySelectorAll('li:not(.empty)')) {
      if (item.querySelector(':scope > .leaderboard-row-link')) continue;
      const nick = extractNick(item);
      if (!nick) continue;
      const anchor = document.createElement('a');
      anchor.className = 'leaderboard-row-link';
      anchor.href = ui.playerUrl(nick);
      anchor.dataset.playerNick = nick;
      anchor.setAttribute('aria-label', `Ver perfil de ${nick}`);
      while (item.firstChild) anchor.append(item.firstChild);
      const player = anchor.querySelector('.player');
      const team = extractTeam(anchor);
      if (team) teamCache.set(nick.toLocaleLowerCase('es'), team);
      if (player && !player.querySelector('.player-team')) {
        const name = Array.from(player.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
        if (name) {
          const nickSpan = document.createElement('span');
          nickSpan.className = 'player-link__nick';
          nickSpan.textContent = name.textContent.trim();
          name.replaceWith(nickSpan);
        }
        const small = player.querySelector('small');
        if (small && team) {
          const country = small.textContent.split('·')[0]?.trim() || '';
          small.innerHTML = `${ui.teamHtml(team)}<span>${ui.escapeHtml(small.textContent.replace(country, '').replace(/^\s*·\s*/, ''))}</span>`;
        }
      }
      item.classList.add('leaderboard-row');
      item.append(anchor);
    }
  }

  async function request(action, payload = {}) {
    if (!apiUrl) return null;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudieron actualizar los premios.');
    return body;
  }

  async function resolveAwardTeam(award) {
    if (!award?.nick) return null;
    const cacheKey = String(award.nick).toLocaleLowerCase('es');
    const direct = ui.resolveTeam(award.team);
    if (direct) {
      teamCache.set(cacheKey, direct.key);
      return direct;
    }
    const cached = ui.resolveTeam(teamCache.get(cacheKey));
    if (cached) return cached;
    const profile = await request('public-profile', { nick: award.nick }).catch(() => null);
    const resolved = ui.resolveTeam(null, profile);
    if (resolved) teamCache.set(cacheKey, resolved.key);
    return resolved;
  }

  async function resolveAward(award, suffix) {
    if (!award?.nick) return Object.freeze({ empty: true });
    const team = await resolveAwardTeam(award);
    return Object.freeze({
      empty: false,
      nick: String(award.nick),
      team,
      value: Number(award.value || 0).toLocaleString('es-ES'),
      suffix,
    });
  }

  function awardHtml(view) {
    if (view.empty) return 'Aún sin dueño';
    const flag = view.team
      ? `<span class="flag award-flag ${view.team.flagClass}" role="img" aria-label="${ui.escapeHtml(view.team.name)}"></span>`
      : '<span class="player-team--unknown">Selección no disponible</span>';
    return `<a class="award-player-link" href="${ui.escapeHtml(ui.playerUrl(view.nick))}" data-player-nick="${ui.escapeHtml(view.nick)}">${flag}<span>${ui.escapeHtml(view.nick)}</span><span>· ${view.value}${view.suffix}</span></a>`;
  }

  async function renderAwards(stats) {
    const requestId = ++awardsRequest;
    const awards = stats?.awards || {};
    const views = await Promise.all([
      resolveAward(awards.goldenBoot, ' ms'),
      resolveAward(awards.goldenGlove, ' ms'),
      resolveAward(awards.goldenBall, ' intentos'),
    ]);
    if (requestId !== awardsRequest) return false;

    const selectors = ['#goldenBoot', '#goldenGlove', '#goldenBall'];
    for (let index = 0; index < selectors.length; index += 1) {
      const target = document.querySelector(selectors[index]);
      if (target) target.innerHTML = awardHtml(views[index]);
    }
    return true;
  }

  async function refreshAwards(preloadedStats = null) {
    if (preloadedStats?.awards) {
      await renderAwards(preloadedStats);
      return;
    }
    const stats = await request('stats').catch(() => null);
    if (stats?.awards) await renderAwards(stats);
  }

  function stopLegacyProfileHandler(event) {
    if (event.target.closest('.leaderboard-row-link')) event.stopImmediatePropagation();
  }

  function initialize() {
    enhanceLeaderboard();
    const leaderboard = document.querySelector('#leaderboard');
    if (leaderboard) {
      new MutationObserver(enhanceLeaderboard).observe(leaderboard, { childList: true });
      leaderboard.addEventListener('click', stopLegacyProfileHandler, true);
    }
    refreshAwards();
    document.addEventListener('minuto106:attempt-finished', (event) => refreshAwards(event.detail?.stats));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
