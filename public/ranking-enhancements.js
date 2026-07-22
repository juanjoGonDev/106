(() => {
  const ui = window.Minuto106PlayerUI;
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
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
          const country = small.textContent.split('·')[0]?.trim();
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

  async function awardTeam(award) {
    if (!award?.nick) return null;
    const direct = ui.resolveTeam(award.team);
    if (direct) return direct;
    const profile = await request('public-profile', { nick: award.nick }).catch(() => null);
    return ui.resolveTeam(null, profile);
  }

  async function renderAward(selector, award, suffix) {
    const target = document.querySelector(selector);
    if (!target) return;
    if (!award?.nick) {
      target.textContent = 'Aún sin dueño';
      return;
    }
    const team = await awardTeam(award);
    const flag = team ? `<span class="flag ${team.flagClass}" aria-hidden="true"></span>` : '';
    target.innerHTML = `<a class="award-player-link" href="${ui.escapeHtml(ui.playerUrl(award.nick))}" data-player-nick="${ui.escapeHtml(award.nick)}">${flag}<span>${ui.escapeHtml(award.nick)}</span><span>· ${Number(award.value || 0).toLocaleString('es-ES')}${suffix}</span></a>`;
  }

  async function renderAwards(stats) {
    const requestId = ++awardsRequest;
    const awards = stats?.awards || {};
    const values = await Promise.all([
      renderAward('#goldenBoot', awards.goldenBoot, ' ms'),
      renderAward('#goldenGlove', awards.goldenGlove, ' ms'),
      renderAward('#goldenBall', awards.goldenBall, ' intentos'),
    ]);
    if (requestId !== awardsRequest) return null;
    return values;
  }

  async function refreshAwards(preloadedStats = null) {
    if (preloadedStats?.awards) await renderAwards(preloadedStats);
    const stats = await request('stats').catch(() => null);
    if (stats?.awards) await renderAwards(stats);
  }

  function initialize() {
    enhanceLeaderboard();
    const leaderboard = document.querySelector('#leaderboard');
    if (leaderboard) new MutationObserver(enhanceLeaderboard).observe(leaderboard, { childList: true });
    refreshAwards();
    document.addEventListener('minuto106:attempt-finished', (event) => refreshAwards(event.detail?.stats));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();