(() => {
  const SECTIONS = Object.freeze(['overview', 'achievements', 'trophies']);
  const TEAMS = Object.freeze({
    spain: Object.freeze({ key: 'spain', name: 'España', flagClass: 'flag--spain' }),
    argentina: Object.freeze({ key: 'argentina', name: 'Argentina', flagClass: 'flag--argentina' }),
  });
  const hasTeam = (value) => Object.hasOwn(TEAMS, String(value ?? ''));

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function normalizeNick(value) {
    const policy = globalThis.Minuto106NicknamePolicy;
    if (policy) return policy.normalizeNickname(value).slice(0, 24);
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 24);
  }

  function nicknameValidation(value) {
    const policy = globalThis.Minuto106NicknamePolicy;
    if (policy) return policy.validateNickname(value);
    const normalized = normalizeNick(value);
    return { valid: Array.from(normalized).length >= 3, normalized };
  }

  function isValidNickname(value) {
    return nicknameValidation(value).valid === true;
  }

  function normalizeSection(value) {
    return SECTIONS.includes(String(value)) ? String(value) : 'overview';
  }

  function normalizeRevision(value) {
    const revision = Number(value);
    return Number.isFinite(revision) && revision >= 0 ? Math.trunc(revision) : 0;
  }

  function resolveTeam(value, profile = null) {
    const direct = String(value ?? '');
    if (hasTeam(direct)) return TEAMS[direct];
    const profileTeam = String(profile?.team ?? '');
    if (hasTeam(profileTeam)) return TEAMS[profileTeam];
    const historyTeam = String(profile?.history?.find((attempt) => hasTeam(attempt?.team))?.team ?? '');
    return hasTeam(historyTeam) ? TEAMS[historyTeam] : null;
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

  function playerShellUrl(nick, section = 'overview', baseHref) {
    const url = new URL('player.html', appBaseUrl(baseHref));
    url.searchParams.set('nick', normalizeNick(nick));
    const normalizedSection = normalizeSection(section);
    if (normalizedSection !== 'overview') url.searchParams.set('section', normalizedSection);
    return url.toString();
  }

  function playerUrl(nick, section = 'overview', baseHref) {
    const validation = nicknameValidation(nick);
    const normalizedSection = normalizeSection(section);
    if (!validation.valid) return playerShellUrl(validation.normalized, normalizedSection, baseHref);
    const suffix = normalizedSection === 'overview' ? '' : `/${normalizedSection}`;
    return new URL(`player/${encodeURIComponent(validation.normalized)}${suffix}`, appBaseUrl(baseHref)).toString();
  }

  function parsePlayerLocation(locationLike = globalThis.location) {
    const url = new URL(locationLike?.href ?? String(locationLike ?? 'http://localhost/'));
    const queryValidation = nicknameValidation(url.searchParams.get('nick'));
    const querySection = normalizeSection(url.searchParams.get('section'));
    if (queryValidation.valid) return Object.freeze({ nick: queryValidation.normalized, section: querySection });
    if (url.searchParams.has('nick')) return Object.freeze({ nick: '', section: querySection });

    const match = url.pathname.match(/\/player\/([^/]+)(?:\/(achievements|trophies))?\/?$/i);
    if (!match) return Object.freeze({ nick: '', section: 'overview' });
    const decodedNick = (() => {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    })();
    const routeValidation = nicknameValidation(decodedNick);
    return Object.freeze({
      nick: routeValidation.valid ? routeValidation.normalized : '',
      section: normalizeSection(match[2]),
    });
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

  function shareUrl(baseUrl, nick, section = 'overview') {
    const raw = String(baseUrl ?? '').trim();
    const publicBaseUrl = raw && !raw.includes('/functions/') ? raw : undefined;
    return playerUrl(nick, section, publicBaseUrl);
  }

  function cardUrl(apiBaseUrl, nick, section = 'overview', revision = 0) {
    const edgeUrl = edgeFunctionBaseUrl(apiBaseUrl, 'player-share');
    if (!edgeUrl) return '';
    const validation = nicknameValidation(nick);
    if (!validation.valid) return '';
    const normalizedSection = normalizeSection(section);
    edgeUrl.pathname += `/${encodeURIComponent(validation.normalized)}/${normalizedSection === 'overview' ? 'card' : normalizedSection}.png`;
    edgeUrl.searchParams.set('v', String(normalizeRevision(revision)));
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
    isValidNickname,
    normalizeNick,
    normalizeRevision,
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