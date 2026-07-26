const leagueConfig = window.__MINUTO106_CONFIG__ ?? {};
const gameApi = String(leagueConfig.apiBaseUrl ?? '').replace(/\/$/, '');
const leagueApi = gameApi.replace(/\/game-api$/, '/league-api');
const leagueSocialApi = gameApi.replace(/\/game-api$/, '/social-share');
const leagueDevice = localStorage.getItem('minuto106:device-id') || crypto.randomUUID();
const cleanRouteMatch = location.pathname.match(/^(.*\/)ligas\/([A-Z0-9]{6})\/?$/i);
const leagueBaseUrl = cleanRouteMatch ? new URL(cleanRouteMatch[1], location.origin) : new URL('./', location.href);
const directory = window.Minuto106LeagueDirectory;
const initialPublicId = directory.normalizeLeagueId(cleanRouteMatch?.[2] || new URLSearchParams(location.search).get('league'));
let selectedLeague = null;
let myLeagues = [];
let directoryLeagues = [];
let directorySequence = 0;
let directoryTimer = 0;
let statusTimer = 0;

localStorage.setItem('minuto106:device-id', leagueDevice);

function installStableBaseUrl() {
  let base = document.head.querySelector('base[data-minuto106-base]');
  if (!base) {
    base = document.createElement('base');
    base.dataset.minuto106Base = 'true';
    document.head.prepend(base);
  }
  base.href = leagueBaseUrl.toString();
}

installStableBaseUrl();

async function leagueRequest(action, payload = {}) {
  if (!leagueApi || leagueApi === gameApi) throw new Error('Supabase aún no está configurado para miniligas.');
  const response = await fetch(leagueApi, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': leagueDevice },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo cargar la miniliga.');
  return body;
}

function showLeagueError(error, title = 'No se pudo completar la operación') {
  return window.Minuto106UI?.error({
    title,
    message: error instanceof Error ? error.message : String(error || 'Se produjo un error inesperado.'),
  }) ?? Promise.resolve();
}

function escapeLeague(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function currentNick() {
  return String(
    document.querySelector('#leagueDetailNick')?.value
    || document.querySelector('#leagueNick')?.value
    || localStorage.getItem('minuto106:nick')
    || '',
  ).trim();
}

function persistNick() {
  const nick = currentNick();
  if (nick) localStorage.setItem('minuto106:nick', nick);
  return nick;
}

function compact(value) {
  return window.Minuto106Format?.compactNumber(value) ?? String(value ?? 0);
}

function formatDifference(value) {
  return value === null || value === undefined ? 'Sin marca' : `±${Number(value).toLocaleString('es-ES')} ms`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

function leaguePublicUrl(publicId) {
  return new URL(`ligas/${encodeURIComponent(publicId)}`, leagueBaseUrl).toString();
}

function competitionUrl(publicId) {
  const url = new URL(leagueBaseUrl);
  url.searchParams.set('competition', publicId);
  return url.toString();
}

function membershipFor(publicId) {
  return myLeagues.find((league) => league.publicId === publicId) ?? null;
}

function upsertMeta(attribute, key, value) {
  let element = document.head.querySelector(`meta[${attribute}="${CSS.escape(key)}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = value;
}

function updateLeagueMetadata(league) {
  const canonicalUrl = leaguePublicUrl(league.publicId);
  const imageUrl = `${leagueSocialApi}/league/${encodeURIComponent(league.publicId)}/card.png?v=${Math.max(0, Number(league.revision || 0))}`;
  const description = `${league.name}: ${directory.leagueStatusLabel(league).toLocaleLowerCase('es')}, ${Number(league.participantCount ?? league.members ?? 0)} participantes.`;
  document.title = `${league.name} · Minuto 106`;
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.append(canonical);
  }
  canonical.href = canonicalUrl;
  upsertMeta('property', 'og:url', canonicalUrl);
  upsertMeta('property', 'og:title', `${league.name} · Minuto 106`);
  upsertMeta('property', 'og:description', description);
  upsertMeta('property', 'og:image', imageUrl);
  upsertMeta('property', 'og:image:secure_url', imageUrl);
  upsertMeta('name', 'twitter:title', `${league.name} · Minuto 106`);
  upsertMeta('name', 'twitter:description', description);
  upsertMeta('name', 'twitter:image', imageUrl);
  upsertMeta('name', 'twitter:image:src', imageUrl);
}

async function shareLeaguePage(league) {
  await window.Minuto106UI?.share({
    title: `${league.name} · Minuto 106`,
    text: `Consulta “${league.name}”. ${directory.leagueStatusLabel(league)}.`,
    url: leaguePublicUrl(league.publicId),
  });
}

async function shareLeagueInvitation(league) {
  if (!league.joinCode) return shareLeaguePage(league);
  await window.Minuto106UI?.share({
    title: `Invitación a ${league.name}`,
    text: `Únete a mi liga privada “${league.name}” de Minuto 106. Código privado: ${league.joinCode}.`,
    url: leaguePublicUrl(league.publicId),
  });
}

function accessLabel(league) {
  return league.visibility === 'public' ? 'Pública' : '🔒 Privada';
}

function configMarkup(league) {
  const participants = Number(league.participantCount ?? league.members ?? 0);
  const maximum = Number(league.maxParticipants ?? 10);
  const duration = Number(league.durationDays ?? 3);
  return [
    `<span class="league-config-chip">${participants}/${maximum} participantes</span>`,
    `<span class="league-config-chip">${duration} ${duration === 1 ? 'día' : 'días'}</span>`,
    '<span class="league-config-chip">5 intentos por persona</span>',
  ].join('');
}

function renderDirectoryCard(league) {
  const membership = membershipFor(league.publicId);
  const canJoin = !membership && directory.canJoinLeague(league);
  return `<article class="league-directory-card" data-directory-league="${escapeLeague(league.publicId)}">
    <header><div><h3>${escapeLeague(league.name)}</h3><small>${escapeLeague(league.publicId)}</small></div><span class="league-access-badge" data-visibility="${escapeLeague(league.visibility)}">${accessLabel(league)}</span></header>
    <p class="league-card-summary">${escapeLeague(directory.leagueStatusLabel(league))}</p>
    <div class="league-config-list">${configMarkup(league)}</div>
    <div class="league-card-actions"><a class="ghost compact" href="${escapeLeague(leaguePublicUrl(league.publicId))}">Ver liga</a>${canJoin ? `<button class="primary compact" type="button" data-join-public="${escapeLeague(league.publicId)}">Unirme</button>` : ''}</div>
  </article>`;
}

function renderDirectory() {
  const container = document.querySelector('#leagueDirectoryList');
  const count = document.querySelector('#leagueDirectoryCount');
  if (!container || !count) return;
  count.textContent = `${compact(directoryLeagues.length)} ${directoryLeagues.length === 1 ? 'liga' : 'ligas'}`;
  container.innerHTML = directoryLeagues.length
    ? directoryLeagues.map(renderDirectoryCard).join('')
    : '<p class="empty">No hay ligas que coincidan con la búsqueda.</p>';
}

async function loadDirectory() {
  const sequence = ++directorySequence;
  const search = document.querySelector('#leagueSearch')?.value;
  const visibility = document.querySelector('#leagueVisibilityFilter')?.value;
  const container = document.querySelector('#leagueDirectoryList');
  if (container) container.innerHTML = '<p class="empty">Cargando ligas…</p>';
  const leagues = await leagueRequest('list-leagues', directory.buildDirectoryPayload(search, visibility));
  if (sequence !== directorySequence) return;
  directoryLeagues = Array.isArray(leagues) ? leagues : [];
  renderDirectory();
}

function renderMyLeagueCard(league) {
  const rank = league.rank ? `#${league.rank}` : '—';
  const play = directory.canPlayLeague(league, league)
    ? `<a class="primary compact" href="${escapeLeague(competitionUrl(league.publicId))}">Jugar</a>`
    : '';
  return `<article class="my-league-card" data-league-card="${escapeLeague(league.publicId)}">
    <header><div><h3>${escapeLeague(league.name)}</h3><small>${escapeLeague(league.publicId)}</small></div><span class="league-access-badge" data-visibility="${escapeLeague(league.visibility)}">${accessLabel(league)}</span></header>
    <p class="league-card-summary">${escapeLeague(directory.leagueStatusLabel(league))}</p>
    <div class="league-config-list">${configMarkup(league)}<span class="league-config-chip">Puesto ${rank}</span><span class="league-config-chip">${league.attemptsUsed ?? 0}/${league.maxAttempts ?? 5} intentos</span></div>
    <div class="league-card-actions"><a class="ghost compact" href="${escapeLeague(leaguePublicUrl(league.publicId))}">Ver liga</a>${play}<button class="secondary compact" type="button" data-share-league="${escapeLeague(league.publicId)}">${league.joinCode ? 'Compartir invitación' : 'Compartir liga'}</button></div>
  </article>`;
}

async function loadMyLeagues() {
  const container = document.querySelector('#myLeaguesList');
  const count = document.querySelector('#myLeaguesCount');
  const nick = persistNick();
  if (nick.length < 2) {
    myLeagues = [];
    if (container) container.innerHTML = '<p class="empty">Escribe tu nick para cargar tus ligas.</p>';
    if (count) count.textContent = '0 ligas';
    return myLeagues;
  }
  if (container) container.innerHTML = '<p class="empty">Cargando tus ligas…</p>';
  try {
    const leagues = await leagueRequest('player-leagues', { nick });
    myLeagues = Array.isArray(leagues) ? leagues : [];
  } catch {
    myLeagues = [];
  }
  if (count) count.textContent = `${compact(myLeagues.length)} ${myLeagues.length === 1 ? 'liga' : 'ligas'}`;
  if (container) container.innerHTML = myLeagues.length ? myLeagues.map(renderMyLeagueCard).join('') : '<p class="empty">Aún no participas en ninguna liga.</p>';
  return myLeagues;
}

function renderLeagueAttempts(status) {
  const section = document.querySelector('#myLeagueAttempts');
  const list = document.querySelector('#myLeagueAttemptList');
  if (!status?.member) {
    section.hidden = true;
    list.replaceChildren();
    return;
  }
  section.hidden = false;
  list.innerHTML = status.history?.length
    ? status.history.map((attempt, index) => `<li><span class="history-number">${status.attemptsUsed - index}</span><span>${(Number(attempt.elapsedMs) / 1000).toFixed(3)} s</span><strong>${formatDifference(attempt.differenceMs)}</strong><small class="${attempt.verified ? 'valid' : 'invalid'}">${attempt.verified ? 'Válido' : 'Excluido'}</small></li>`).join('')
    : '<li class="empty">Todavía no has realizado intentos en esta liga.</li>';
}

function updateSelectedStatus() {
  if (!selectedLeague) return;
  document.querySelector('#leagueLookupEnds').textContent = directory.leagueStatusLabel(selectedLeague);
  const phase = directory.leaguePhase(selectedLeague);
  const start = formatDate(selectedLeague.startsAt);
  const end = formatDate(selectedLeague.endsAt);
  document.querySelector('#leagueMembershipMessage').textContent = phase === 'waiting'
    ? 'La cuenta atrás de 23 horas se programará al alcanzar el mínimo de identidades válidas.'
    : phase === 'scheduled'
      ? `Inicio programado: ${start}.`
      : phase === 'active'
        ? `En juego hasta ${end}.`
        : `Finalizó el ${end}.`;
}

function renderLeague(league, status = null) {
  const membership = membershipFor(league.publicId);
  selectedLeague = { ...league, ...membership, ...status };
  const section = document.querySelector('#leagueLookupResult');
  section.hidden = false;
  document.querySelector('#leagueLookupEyebrow').textContent = accessLabel(league).toUpperCase();
  document.querySelector('#leagueLookupTitle').textContent = league.name;
  document.querySelector('#leagueLookupPublicId').textContent = `Liga ${league.publicId}`;
  document.querySelector('#leagueLookupMeta').textContent = `${compact(league.participantCount ?? league.members ?? 0)} participantes · ${compact(league.totalAttempts ?? 0)} intentos registrados`;
  document.querySelector('#leagueLookupConfig').innerHTML = configMarkup(league);

  const competeLink = document.querySelector('#competeLeagueLink');
  competeLink.href = competitionUrl(league.publicId);
  competeLink.hidden = !directory.canPlayLeague(league, status || membership);

  const publicJoin = document.querySelector('#joinPublicLeagueButton');
  publicJoin.hidden = Boolean(membership) || !directory.canJoinLeague(league);
  publicJoin.dataset.publicId = league.publicId;
  document.querySelector('#leagueDetailNickRow').hidden = publicJoin.hidden || currentNick().length >= 2;

  document.querySelector('#shareLeagueButton').textContent = membership?.joinCode ? 'Compartir invitación privada' : 'Compartir liga';
  const nickKey = currentNick().normalize('NFKC').trim().toLocaleLowerCase('es');
  document.querySelector('#leagueLookupList').innerHTML = league.leaderboard?.length
    ? league.leaderboard.map((entry) => `<li data-current="${String(entry.nick || '').normalize('NFKC').trim().toLocaleLowerCase('es') === nickKey}"><span class="rank">${entry.rank ? `#${entry.rank}` : '—'}</span><span class="player">${escapeLeague(entry.nick)}<small>${entry.attemptsUsed ?? 0}/5 intentos · ${entry.verifiedAttempts ?? 0} válidos</small></span><span class="difference">${formatDifference(entry.bestDifferenceMs)}</span></li>`).join('')
    : `<li class="empty">${directory.leaguePhase(league) === 'active' ? 'Todavía no hay participantes con marca.' : 'La clasificación se abrirá cuando empiece la liga.'}</li>`;

  renderLeagueAttempts(status);
  updateSelectedStatus();
  updateLeagueMetadata(league);
  window.clearInterval(statusTimer);
  statusTimer = window.setInterval(updateSelectedStatus, 1_000);
}

async function loadLeague(publicId) {
  const normalized = directory.normalizeLeagueId(publicId);
  if (!normalized) throw new Error('El identificador público de la liga no es válido.');
  const league = await leagueRequest('league', { publicId: normalized });
  const resolvedPublicId = directory.normalizeLeagueId(league.publicId);
  if (!resolvedPublicId) throw new Error('La liga no existe.');
  league.publicId = resolvedPublicId;

  let status = null;
  const membership = membershipFor(resolvedPublicId);
  const nick = persistNick();
  if (membership && nick.length >= 2) {
    try {
      status = await leagueRequest('league-status', { nick, publicId: resolvedPublicId });
    } catch {
      status = null;
    }
  }
  renderLeague(league, status);
  history.replaceState(null, '', leaguePublicUrl(resolvedPublicId));
  return selectedLeague;
}

async function joinLeague(payload) {
  const nick = persistNick();
  if (nick.length < 2) throw new Error('Escribe el nick con el que competirás.');
  const result = await leagueRequest('join-league', { nick, ...payload });
  const publicId = directory.normalizeLeagueId(result.publicId);
  if (!publicId) throw new Error('La liga no devolvió un identificador válido.');
  location.assign(leaguePublicUrl(publicId));
}

function scheduleDirectoryLoad() {
  window.clearTimeout(directoryTimer);
  directoryTimer = window.setTimeout(() => loadDirectory().catch(showLeagueError), 250);
}

function bindEvents() {
  document.querySelector('#leagueNick')?.addEventListener('change', async () => {
    await loadMyLeagues();
    if (selectedLeague) await loadLeague(selectedLeague.publicId);
    else if (!initialPublicId) renderDirectory();
  });
  document.querySelector('#leagueDetailNick')?.addEventListener('change', async (event) => {
    const nick = String(event.target.value || '').trim();
    const directoryInput = document.querySelector('#leagueNick');
    if (directoryInput) directoryInput.value = nick;
    persistNick();
    await loadMyLeagues();
    if (selectedLeague) await loadLeague(selectedLeague.publicId);
  });
  document.querySelector('#leagueSearch')?.addEventListener('input', scheduleDirectoryLoad);
  document.querySelector('#leagueVisibilityFilter')?.addEventListener('change', () => loadDirectory().catch(showLeagueError));

  document.querySelector('#createLeagueForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = directory.buildCreatePayload({
        nick: persistNick(),
        name: document.querySelector('#newLeagueName')?.value,
        visibility: document.querySelector('#newLeagueVisibility')?.value,
        durationDays: document.querySelector('#newLeagueDuration')?.value,
        maxParticipants: document.querySelector('#newLeagueMaxParticipants')?.value,
      });
      if (payload.nick.length < 2) throw new Error('Escribe el nick con el que competirás.');
      if (payload.name.length < 3) throw new Error('El nombre debe tener entre 3 y 40 caracteres.');
      const league = await leagueRequest('create-league', payload);
      location.assign(leaguePublicUrl(league.publicId));
    } catch (error) {
      await showLeagueError(error, 'No se pudo crear la liga');
    }
  });

  document.querySelector('#joinLeagueForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await joinLeague({ code: document.querySelector('#leagueJoinCode')?.value });
    } catch (error) {
      await showLeagueError(error, 'No se pudo entrar en la liga');
    }
  });

  document.addEventListener('click', async (event) => {
    const joinButton = event.target.closest('[data-join-public], #joinPublicLeagueButton');
    if (joinButton) {
      try {
        await joinLeague({ publicId: joinButton.dataset.publicId || joinButton.dataset.joinPublic });
      } catch (error) {
        await showLeagueError(error, 'No se pudo entrar en la liga pública');
      }
      return;
    }
    const shareButton = event.target.closest('[data-share-league], #shareLeagueButton');
    if (!shareButton) return;
    const publicId = shareButton.dataset.shareLeague || selectedLeague?.publicId;
    const league = membershipFor(publicId) || selectedLeague || directoryLeagues.find((entry) => entry.publicId === publicId);
    if (league) await shareLeagueInvitation(league);
  });
}

async function bootLeagues() {
  const storedNick = localStorage.getItem('minuto106:nick') || '';
  const input = document.querySelector('#leagueNick');
  const detailInput = document.querySelector('#leagueDetailNick');
  if (input) input.value = storedNick;
  if (detailInput) detailInput.value = storedNick;
  bindEvents();
  await loadMyLeagues();
  if (initialPublicId) {
    document.documentElement.dataset.leagueMode = 'detail';
    await loadLeague(initialPublicId);
    return;
  }
  await loadDirectory();
}

bootLeagues().catch((error) => showLeagueError(error, 'No se pudieron cargar las ligas'));
