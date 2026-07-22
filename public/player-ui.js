(() => {
  const SECTIONS = Object.freeze(['overview', 'achievements', 'trophies']);
  const TEAMS = Object.freeze({
    spain: Object.freeze({ key: 'spain', name: 'España', flagClass: 'flag--spain' }),
    argentina: Object.freeze({ key: 'argentina', name: 'Argentina', flagClass: 'flag--argentina' }),
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function normalizeNick(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 24);
  }

  function normalizeSection(value) {
    return SECTIONS.includes(String(value)) ? String(value) : 'overview';
  }

  function resolveTeam(value, profile = null) {
    const direct = String(value ?? '');
    if (TEAMS[direct]) return TEAMS[direct];
    const profileTeam = String(profile?.team ?? '');
    if (TEAMS[profileTeam]) return TEAMS[profileTeam];
    const historyTeam = String(profile?.history?.find((attempt) => TEAMS[attempt?.team])?.team ?? '');
    return TEAMS[historyTeam] ?? null;
  }

  function teamHtml(value, profile = null, modifier = '') {
    const team = resolveTeam(value, profile);
    const className = ['player-team', modifier].filter(Boolean).join(' ');
    if (!team) return `<span class="${escapeHtml(`${className} player-team--unknown`)}">Selección no disponible</span>`;
    return `<span class="${escapeHtml(className)}"><span class="flag ${team.flagClass}" aria-hidden="true"></span><span>${team.name}</span></span>`;
  }

  function appBaseUrl(baseHref = globalThis.document?.baseURI ?? globalThis.location?.href ?? 'http://localhost/') {
    const url = new URL('./', baseHref);
    const playerIndex = url.pathname.indexOf('/player/');
    if (playerIndex >= 0) url.pathname = url.pathname.slice(0, playerIndex + 1);
    return url;
  }

  function playerUrl(nick, section = 'overview', baseHref) {
    const normalizedNick = normalizeNick(nick);
    const normalizedSection = normalizeSection(section);
    const suffix = normalizedSection === 'overview' ? '' : `/${normalizedSection}`;
    return new URL(`player/${encodeURIComponent(normalizedNick)}${suffix}`, appBaseUrl(baseHref)).toString();
  }

  function playerShellUrl(nick, section = 'overview', baseHref) {
    const url = new URL('player.html', appBaseUrl(baseHref));
    url.searchParams.set('nick', normalizeNick(nick));
    const normalizedSection = normalizeSection(section);
    if (normalizedSection !== 'overview') url.searchParams.set('section', normalizedSection);
    return url.toString();
  }

  function parsePlayerLocation(locationLike = globalThis.location) {
    const url = new URL(locationLike?.href ?? String(locationLike ?? 'http://localhost/'));
    const queryNick = normalizeNick(url.searchParams.get('nick'));
    const querySection = normalizeSection(url.searchParams.get('section'));
    if (queryNick) return Object.freeze({ nick: queryNick, section: querySection });

    const match = url.pathname.match(/\/player\/([^/]+)(?:\/(achievements|trophies))?\/?$/i);
    if (!match) return Object.freeze({ nick: '', section: 'overview' });
    let decodedNick = '';
    try {
      decodedNick = decodeURIComponent(match[1]);
    } catch {
      decodedNick = match[1];
    }
    return Object.freeze({ nick: normalizeNick(decodedNick), section: normalizeSection(match[2]) });
  }

  function edgeFunctionBaseUrl(apiBaseUrl, functionName) {
    const raw = String(apiBaseUrl ?? '').trim();
    if (!raw) return null;
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/[^/]+\/?$/, `/${functionName}`);
    url.search = '';
    url.hash = '';
    return url;
  }

  function shareUrl(apiBaseUrl, nick, section = 'overview') {
    const edgeUrl = edgeFunctionBaseUrl(apiBaseUrl, 'player-share');
    if (!edgeUrl) return playerUrl(nick, section);
    const normalizedSection = normalizeSection(section);
    edgeUrl.pathname += `/${encodeURIComponent(normalizeNick(nick))}`;
    if (normalizedSection !== 'overview') edgeUrl.pathname += `/${normalizedSection}`;
    return edgeUrl.toString();
  }

  function cardUrl(apiBaseUrl, nick, section = 'overview') {
    const edgeUrl = edgeFunctionBaseUrl(apiBaseUrl, 'player-share');
    if (!edgeUrl) return '';
    const normalizedSection = normalizeSection(section);
    edgeUrl.pathname += `/${encodeURIComponent(normalizeNick(nick))}/${normalizedSection === 'overview' ? 'card' : normalizedSection}.png`;
    return edgeUrl.toString();
  }

  function playerLinkHtml({ nick, team, profile, section = 'overview', className = 'player-link', content = null, baseHref }) {
    const normalizedNick = normalizeNick(nick);
    const label = content ?? `${teamHtml(team, profile)}<span class="player-link__nick">${escapeHtml(normalizedNick)}</span>`;
    return `<a class="${escapeHtml(className)}" href="${escapeHtml(playerUrl(normalizedNick, section, baseHref))}" data-player-nick="${escapeHtml(normalizedNick)}">${label}</a>`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  globalThis.Minuto106PlayerUI = Object.freeze({
    SECTIONS,
    TEAMS,
    appBaseUrl,
    cardUrl,
    edgeFunctionBaseUrl,
    escapeHtml,
    formatDate,
    normalizeNick,
    normalizeSection,
    parsePlayerLocation,
    playerLinkHtml,
    playerShellUrl,
    playerUrl,
    resolveTeam,
    shareUrl,
    teamHtml,
  });
})();