(() => {
  const VISIBILITIES = new Set(['all', 'public', 'private']);
  const LEAGUE_VISIBILITIES = new Set(['public', 'private']);
  const DAY_MS = 86_400_000;

  function normalizeLeagueId(value) {
    const publicId = String(value ?? '').trim().toUpperCase();
    return /^[A-Z0-9]{6}$/.test(publicId) ? publicId : '';
  }

  function normalizeVisibilityFilter(value) {
    const visibility = String(value ?? '').trim().toLowerCase();
    return VISIBILITIES.has(visibility) ? visibility : 'all';
  }

  function normalizeLeagueVisibility(value) {
    const visibility = String(value ?? '').trim().toLowerCase();
    return LEAGUE_VISIBILITIES.has(visibility) ? visibility : 'private';
  }

  function normalizeDurationDays(value) {
    const days = Number(value);
    return Number.isInteger(days) && days >= 1 && days <= 7 ? days : 3;
  }

  function normalizeMaxParticipants(value) {
    const maximum = Number(value);
    return Number.isInteger(maximum) && maximum >= 10 && maximum <= 100 && maximum % 10 === 0
      ? maximum
      : 10;
  }

  function leaguePhase(league, now = Date.now()) {
    const current = Number(now);
    const startsAt = Date.parse(String(league?.startsAt ?? ''));
    const endsAt = Date.parse(String(league?.endsAt ?? ''));
    if (league?.finished === true || (Number.isFinite(endsAt) && endsAt <= current)) return 'finished';
    if (league?.active === true || (Number.isFinite(startsAt) && startsAt <= current && (!Number.isFinite(endsAt) || endsAt > current))) return 'active';
    if (league?.scheduled === true || (Number.isFinite(startsAt) && startsAt > current)) return 'scheduled';
    return 'waiting';
  }

  function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000));
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    if (days > 0) return `${days} d ${hours} h`;
    if (hours > 0) return `${hours} h ${minutes} min`;
    if (minutes > 0) return `${minutes} min ${seconds} s`;
    return `${seconds} s`;
  }

  function leagueStatusLabel(league, now = Date.now()) {
    const phase = leaguePhase(league, now);
    if (phase === 'finished') return 'Finalizada';
    if (phase === 'active') {
      const remaining = Date.parse(String(league?.endsAt ?? '')) - Number(now);
      return Number.isFinite(remaining) ? `Termina en ${formatCountdown(remaining)}` : 'En juego';
    }
    if (phase === 'scheduled') {
      const remaining = Date.parse(String(league?.startsAt ?? '')) - Number(now);
      return Number.isFinite(remaining) ? `Empieza en ${formatCountdown(remaining)}` : 'Inicio programado';
    }
    const required = Number(league?.requiredParticipants ?? 3);
    const participants = Number(league?.participantCount ?? league?.members ?? 0);
    return `Esperando ${Math.max(0, required - participants)} participante${Math.max(0, required - participants) === 1 ? '' : 's'}`;
  }

  function canJoinLeague(league) {
    const members = Number(league?.participantCount ?? league?.members ?? 0);
    const maximum = normalizeMaxParticipants(league?.maxParticipants);
    return league?.visibility === 'public'
      && leaguePhase(league) !== 'finished'
      && members < maximum;
  }

  function canPlayLeague(league, membership) {
    return Boolean(membership)
      && leaguePhase(league) === 'active'
      && Number(membership?.attemptsLeft ?? 0) > 0;
  }

  function buildDirectoryPayload(search, visibility) {
    return {
      action: 'list-leagues',
      search: String(search ?? '').trim().slice(0, 80),
      visibility: normalizeVisibilityFilter(visibility),
    };
  }

  function buildCreatePayload({ nick, name, visibility, durationDays, maxParticipants }) {
    return {
      action: 'create-league',
      nick: String(nick ?? '').trim(),
      name: String(name ?? '').trim(),
      visibility: normalizeLeagueVisibility(visibility),
      durationDays: normalizeDurationDays(durationDays),
      maxParticipants: normalizeMaxParticipants(maxParticipants),
    };
  }

  function expectedDurationMilliseconds(league) {
    return normalizeDurationDays(league?.durationDays) * DAY_MS;
  }

  globalThis.Minuto106LeagueDirectory = Object.freeze({
    buildCreatePayload,
    buildDirectoryPayload,
    canJoinLeague,
    canPlayLeague,
    expectedDurationMilliseconds,
    formatCountdown,
    leaguePhase,
    leagueStatusLabel,
    normalizeDurationDays,
    normalizeLeagueId,
    normalizeLeagueVisibility,
    normalizeMaxParticipants,
    normalizeVisibilityFilter,
  });
})();
