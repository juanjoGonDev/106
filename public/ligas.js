const leagueConfig = window.__MINUTO106_CONFIG__ ?? {};
const leagueApi = String(leagueConfig.apiBaseUrl ?? '').replace(/\/$/, '');
const leagueSocialApi = leagueApi.replace(/\/game-api$/, '/social-share');
const leagueDevice = localStorage.getItem('minuto106:device-id') || crypto.randomUUID();
const pathMatch = location.pathname.match(/\/ligas\/([A-Z0-9]{6})\/?$/i);
const initialPublicId = String(pathMatch?.[1] || new URLSearchParams(location.search).get('league') || '').trim().toUpperCase();
let selectedLeague = null;
let myLeagues = [];

localStorage.setItem('minuto106:device-id', leagueDevice);

async function leagueRequest(action, payload = {}) {
  if (!leagueApi) throw new Error('Supabase aún no está configurado.');
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
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function hasValue(value) {
  return value !== null && value !== undefined;
}

function normalizeLeagueId(value) {
  const publicId = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(publicId) ? publicId : '';
}

function currentNick() {
  return String(document.querySelector('#leagueNick')?.value || '').trim();
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
  return hasValue(value) ? `±${Number(value).toLocaleString('es-ES')} ms` : 'Sin marca';
}

function remainingLabel(league) {
  if (league?.waiting === true) return 'En espera de participantes';
  const remaining = Math.max(0, new Date(league?.endsAt).getTime() - Date.now());
  if (!remaining) return 'Finalizada';
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours <= 24) return `Termina en ${hours} h`;
  return `Termina en ${Math.ceil(hours / 24)} días`;
}

function eligibilityLabel(league) {
  return `${Number(league?.eligibleOwners || 0)}/3 cuentas · ${Number(league?.eligibleDevices || 0)}/3 dispositivos`;
}

function leaguePublicUrl(publicId) {
  return new URL(`./ligas/${encodeURIComponent(publicId)}`, location.href).toString();
}

function privateLeague(publicId) {
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
  const description = league.waiting === true
    ? `${league.name} espera tres cuentas y tres dispositivos únicos para comenzar.`
    : `${league.name}: ${Number(league.members || 0)} participantes y ${Number(league.totalAttempts || 0)} intentos.`;
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
    text: league.waiting === true
      ? `Consulta “${league.name}”. La competición empieza al alcanzar tres cuentas y tres dispositivos únicos.`
      : `Consulta la clasificación pública de “${league.name}” en Minuto 106.`,
    url: leaguePublicUrl(league.publicId),
  });
}

async function shareLeagueInvitation(league) {
  if (!league.joinCode) return shareLeaguePage(league);
  const text = league.waiting === true
    ? `Únete a mi liga “${league.name}” de Minuto 106. Empezará con 3 cuentas y 3 dispositivos únicos. Código privado: ${league.joinCode}.`
    : `Únete a mi liga “${league.name}” de Minuto 106. Tendrás 5 intentos propios. Código privado: ${league.joinCode}.`;
  await window.Minuto106UI?.share({
    title: `Invitación a ${league.name}`,
    text,
    url: leaguePublicUrl(league.publicId),
  });
}

function renderMyLeagueCard(league) {
  const active = league.active === true;
  const waiting = league.waiting === true;
  const rank = league.rank ? `#${league.rank}` : '—';
  const status = waiting ? `${remainingLabel(league)} · ${eligibilityLabel(league)}` : remainingLabel(league);
  const shareLabel = league.joinCode ? 'Compartir invitación' : 'Compartir liga';
  return `
    <article class="my-league-card${selectedLeague?.publicId === league.publicId ? ' active' : ''}" data-league-card="${escapeLeague(league.publicId)}">
      <header><div><h3>${escapeLeague(league.name)}</h3><small>Vista pública ${escapeLeague(league.publicId)}</small></div><span class="league-status">${escapeLeague(status)}</span></header>
      <div class="league-card-stats">
        <div><span>Puesto</span><strong>${rank}</strong></div>
        <div><span>Intentos</span><strong>${league.attemptsUsed ?? 0}/${league.maxAttempts ?? 5}</strong></div>
        <div><span>Mejor</span><strong>${formatDifference(league.bestDifferenceMs)}</strong></div>
      </div>
      <div class="league-card-actions"><button class="ghost compact" type="button" data-view-league="${escapeLeague(league.publicId)}">Ver clasificación</button>${active && Number(league.attemptsLeft ?? 0) > 0 ? `<a class="primary compact" href="./?competition=${encodeURIComponent(league.publicId)}">Competir</a>` : ''}<button class="secondary compact" type="button" data-share-league="${escapeLeague(league.publicId)}">${shareLabel}</button></div>
    </article>`;
}

async function loadMyLeagues() {
  const container = document.querySelector('#myLeaguesList');
  const count = document.querySelector('#myLeaguesCount');
  const nick = persistNick();
  if (nick.length < 2) {
    myLeagues = [];
    container.innerHTML = '<p class="empty">Escribe tu nick para cargar tus ligas.</p>';
    count.textContent = '0 ligas';
    return myLeagues;
  }

  container.innerHTML = '<p class="empty">Cargando tus ligas…</p>';
  const leagues = await leagueRequest('player-leagues', { nick });
  myLeagues = Array.isArray(leagues) ? leagues : [];
  count.textContent = `${compact(myLeagues.length)} ${myLeagues.length === 1 ? 'liga' : 'ligas'}`;
  container.innerHTML = myLeagues.length
    ? myLeagues.map(renderMyLeagueCard).join('')
    : '<p class="empty">Aún no participas en ninguna liga. Crea una o introduce una clave de invitación.</p>';
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

function renderLeague(league, status = null) {
  const membership = privateLeague(league.publicId);
  selectedLeague = { ...league, ...membership };
  const waiting = league.waiting === true;
  const section = document.querySelector('#leagueLookupResult');
  section.hidden = false;
  document.querySelector('#leagueLookupTitle').textContent = league.name;
  document.querySelector('#leagueLookupPublicId').textContent = `Liga pública ${league.publicId}`;
  document.querySelector('#leagueLookupEnds').textContent = waiting ? 'La cuenta atrás aún no ha empezado' : remainingLabel(league);
  document.querySelector('#leagueLookupMeta').textContent = waiting
    ? `${compact(league.members ?? 0)} participantes · ${eligibilityLabel(league)} · empieza al alcanzar tres identidades válidas`
    : `${compact(league.members ?? 0)} participantes · ${compact(league.totalAttempts ?? 0)} intentos exclusivos de esta liga`;

  const competeLink = document.querySelector('#competeLeagueLink');
  competeLink.href = `./?competition=${encodeURIComponent(league.publicId)}`;
  competeLink.hidden = league.active !== true || !membership || Number(membership.attemptsLeft ?? 0) <= 0;
  document.querySelector('#shareLeagueButton').textContent = membership?.joinCode ? 'Compartir invitación privada' : 'Compartir liga';

  const nickKey = currentNick().normalize('NFKC').trim().toLocaleLowerCase('es');
  document.querySelector('#leagueLookupList').innerHTML = league.leaderboard?.length
    ? league.leaderboard.map((entry) => `<li data-current="${String(entry.nick || '').normalize('NFKC').trim().toLocaleLowerCase('es') === nickKey}"><span class="rank">${entry.rank ? `#${entry.rank}` : '—'}</span><span class="player">${escapeLeague(entry.nick)}<small>${entry.attemptsUsed ?? 0}/5 intentos · ${entry.verifiedAttempts ?? 0} válidos</small></span><span class="difference">${formatDifference(entry.bestDifferenceMs)}</span></li>`).join('')
    : `<li class="empty">${waiting ? 'La clasificación se abrirá cuando empiece la liga.' : 'Todavía no hay participantes con marca.'}</li>`;

  renderLeagueAttempts(status);
  document.querySelectorAll('[data-league-card]').forEach((card) => {
    card.classList.toggle('active', card.dataset.leagueCard === league.publicId);
  });
  updateLeagueMetadata(league);
}

async function loadLeague(publicId) {
  const normalized = normalizeLeagueId(publicId);
  if (!normalized) throw new Error('El identificador público de la liga no es válido.');
  const league = await leagueRequest('league', { code: normalized });
  const resolvedPublicId = normalizeLeagueId(league.publicId || league.code);
  if (!resolvedPublicId) throw new Error('La liga no existe.');
  league.publicId = resolvedPublicId;

  let status = null;
  const nick = persistNick();
  const membership = privateLeague(resolvedPublicId);
  if (nick.length >= 2 && membership?.competitionCode) {
    try {
      status = await leagueRequest('league-status', { nick, code: membership.competitionCode });
      status.member = true;
    } catch {
      status = { member: false };
    }
  }

  renderLeague(league, status);
  history.replaceState(null, '', `./ligas/${encodeURIComponent(resolvedPublicId)}`);
  return selectedLeague;
}

async function createLeague() {
  const nick = persistNick();
  const name = String(document.querySelector('#newLeagueName').value || '').trim();
  if (nick.length < 2) throw new Error('Escribe el nick con el que crearás la liga.');
  if (name.length < 3) throw new Error('El nombre debe tener al menos 3 caracteres.');
  const created = await leagueRequest('create-league', { nick, name });
  document.querySelector('#newLeagueName').value = '';
  await loadMyLeagues();
  const league = await loadLeague(created.publicId);
  await shareLeagueInvitation({ ...league, joinCode: created.joinCode });
}

async function joinLeague() {
  const nick = persistNick();
  const code = String(document.querySelector('#leagueJoinCode').value || '').trim().toUpperCase();
  if (nick.length < 2) throw new Error('Escribe el nick con el que te unirás.');
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Introduce una clave privada válida de seis caracteres.');
  const joined = await leagueRequest('join-league', { nick, code });
  document.querySelector('#leagueJoinCode').value = '';
  await loadMyLeagues();
  const league = await loadLeague(joined.publicId);
  const message = league.active === true
    ? `La liga “${league.name}” ya está activa. Dispones de 5 intentos propios.`
    : `Ya formas parte de “${league.name}”. ${eligibilityLabel(league)} para comenzar.`;
  await window.Minuto106UI?.success({ title: league.active === true ? 'Liga activada' : 'Ya estás dentro', message });
}

async function initializeLeagues() {
  const nickInput = document.querySelector('#leagueNick');
  nickInput.value = localStorage.getItem('minuto106:nick') || '';

  await loadMyLeagues().catch((error) => showLeagueError(error, 'No se pudieron cargar tus ligas'));
  if (initialPublicId) await loadLeague(initialPublicId).catch((error) => showLeagueError(error, 'No se pudo consultar la liga'));

  let nickDebounce;
  nickInput.addEventListener('input', () => {
    window.clearTimeout(nickDebounce);
    nickDebounce = window.setTimeout(async () => {
      await loadMyLeagues().catch((error) => showLeagueError(error, 'No se pudieron cargar tus ligas'));
      if (selectedLeague?.publicId) await loadLeague(selectedLeague.publicId).catch(() => {});
    }, 400);
  });
}

document.querySelector('#createLeagueForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  createLeague().catch((error) => showLeagueError(error, 'No se pudo crear la liga'));
});
document.querySelector('#joinLeagueForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  joinLeague().catch((error) => showLeagueError(error, 'No se pudo entrar en la liga'));
});
document.querySelector('#shareLeagueButton')?.addEventListener('click', () => {
  if (!selectedLeague) return;
  const share = selectedLeague.joinCode ? shareLeagueInvitation : shareLeaguePage;
  share(selectedLeague).catch((error) => showLeagueError(error, 'No se pudo compartir la liga'));
});
document.querySelector('#myLeaguesList')?.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view-league]');
  const shareButton = event.target.closest('[data-share-league]');
  if (viewButton) loadLeague(viewButton.dataset.viewLeague).catch((error) => showLeagueError(error, 'No se pudo consultar la liga'));
  if (shareButton) {
    const league = privateLeague(shareButton.dataset.shareLeague);
    if (!league) return;
    const share = league.joinCode ? shareLeagueInvitation : shareLeaguePage;
    share(league).catch((error) => showLeagueError(error, 'No se pudo compartir la liga'));
  }
});

initializeLeagues().catch((error) => showLeagueError(error));
