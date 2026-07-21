const leagueConfig = window.__MINUTO106_CONFIG__ ?? {};
const leagueApi = String(leagueConfig.apiBaseUrl ?? '').replace(/\/$/, '');
const leagueDevice = localStorage.getItem('minuto106:device-id') || crypto.randomUUID();
const initialCode = String(new URLSearchParams(location.search).get('league') || '').trim().toUpperCase();
let selectedLeague = null;
let selectedStatus = null;

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

function remainingLabel(endsAt) {
  const remaining = Math.max(0, new Date(endsAt).getTime() - Date.now());
  if (!remaining) return 'Finalizada';
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours <= 24) return `Termina en ${hours} h`;
  return `Termina en ${Math.ceil(hours / 24)} días`;
}

function leagueShareUrl(code) {
  return new URL(`./ligas.html?league=${encodeURIComponent(code)}`, location.href).toString();
}

async function copyLeagueInvitation(league) {
  const text = `⚽ Únete a mi miniliga “${league.name}” de Minuto 106. Tienes 5 intentos propios y no afectan al ranking global. Código ${league.code}: ${leagueShareUrl(league.code)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `Miniliga ${league.name}`, text, url: leagueShareUrl(league.code) });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  await navigator.clipboard.writeText(text);
  await window.Minuto106UI?.success({ title: 'Invitación copiada', message: `Comparte el código ${league.code} con tus amigos.` });
}

function renderMyLeagueCard(league) {
  const active = league.active === true;
  const rank = league.rank ? `#${league.rank}` : '—';
  return `
    <article class="my-league-card${selectedLeague?.code === league.code ? ' active' : ''}" data-league-card="${escapeLeague(league.code)}">
      <header><div><h3>${escapeLeague(league.name)}</h3><code>${escapeLeague(league.code)}</code></div><span class="league-status">${escapeLeague(active ? remainingLabel(league.endsAt) : 'Finalizada')}</span></header>
      <div class="league-card-stats">
        <div><span>Puesto</span><strong>${rank}</strong></div>
        <div><span>Intentos</span><strong>${league.attemptsUsed ?? 0}/${league.maxAttempts ?? 5}</strong></div>
        <div><span>Mejor</span><strong>${formatDifference(league.bestDifferenceMs)}</strong></div>
      </div>
      <div class="league-card-actions"><button class="ghost compact" type="button" data-view-league="${escapeLeague(league.code)}">Ver clasificación</button>${active ? `<a class="primary compact" href="./?league=${encodeURIComponent(league.code)}">Competir</a>` : ''}<button class="secondary compact" type="button" data-share-league="${escapeLeague(league.code)}">Compartir</button></div>
    </article>`;
}

async function loadMyLeagues() {
  const container = document.querySelector('#myLeaguesList');
  const count = document.querySelector('#myLeaguesCount');
  const nick = persistNick();
  if (nick.length < 2) {
    container.innerHTML = '<p class="empty">Escribe tu nick para cargar tus miniligas.</p>';
    count.textContent = '0 ligas';
    return [];
  }

  container.innerHTML = '<p class="empty">Cargando tus miniligas…</p>';
  const leagues = await leagueRequest('player-leagues', { nick });
  count.textContent = `${compact(leagues.length)} ${leagues.length === 1 ? 'liga' : 'ligas'}`;
  container.innerHTML = leagues.length
    ? leagues.map(renderMyLeagueCard).join('')
    : '<p class="empty">Aún no participas en ninguna miniliga. Crea una o introduce un código.</p>';
  return leagues;
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
  selectedLeague = league;
  selectedStatus = status;
  const section = document.querySelector('#leagueLookupResult');
  section.hidden = false;
  document.querySelector('#leagueLookupTitle').textContent = `${league.name} · ${league.code}`;
  document.querySelector('#leagueLookupEnds').textContent = remainingLabel(league.endsAt);
  document.querySelector('#leagueLookupMeta').textContent = `${compact(league.members ?? 0)} participantes · ${compact(league.totalAttempts ?? 0)} intentos exclusivos de esta liga`;
  document.querySelector('#competeLeagueLink').href = `./?league=${encodeURIComponent(league.code)}`;
  document.querySelector('#competeLeagueLink').hidden = league.active === false || status?.member === false;

  const nickKey = currentNick().normalize('NFKC').trim().toLocaleLowerCase('es');
  document.querySelector('#leagueLookupList').innerHTML = league.leaderboard?.length
    ? league.leaderboard.map((entry) => `<li data-current="${String(entry.nick || '').normalize('NFKC').trim().toLocaleLowerCase('es') === nickKey}"><span class="rank">${entry.rank ? `#${entry.rank}` : '—'}</span><span class="player">${escapeLeague(entry.nick)}<small>${entry.attemptsUsed ?? 0}/5 intentos · ${entry.verifiedAttempts ?? 0} válidos</small></span><span class="difference">${formatDifference(entry.bestDifferenceMs)}</span></li>`).join('')
    : '<li class="empty">Todavía no hay participantes.</li>';

  renderLeagueAttempts(status);
  document.querySelectorAll('[data-league-card]').forEach((card) => {
    card.classList.toggle('active', card.dataset.leagueCard === league.code);
  });
}

async function loadLeague(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) throw new Error('Introduce un código válido de seis caracteres.');
  document.querySelector('#leagueLookupCode').value = normalized;
  const league = await leagueRequest('league', { code: normalized });
  if (!league?.code) throw new Error('La miniliga no existe.');

  let status = null;
  const nick = persistNick();
  if (nick.length >= 2) {
    try {
      status = await leagueRequest('league-status', { nick, code: normalized });
      status.member = true;
    } catch {
      status = { member: false };
    }
  }
  renderLeague(league, status);
  history.replaceState(null, '', `./ligas.html?league=${encodeURIComponent(normalized)}`);
  return league;
}

async function createLeague() {
  const nick = persistNick();
  const name = String(document.querySelector('#newLeagueName').value || '').trim();
  if (nick.length < 2) throw new Error('Escribe el nick con el que crearás la miniliga.');
  if (name.length < 3) throw new Error('El nombre debe tener al menos 3 caracteres.');
  const league = await leagueRequest('create-league', { nick, name });
  document.querySelector('#newLeagueName').value = '';
  await loadMyLeagues();
  await loadLeague(league.code);
  await copyLeagueInvitation(league);
}

async function joinLeague() {
  const nick = persistNick();
  const code = String(document.querySelector('#leagueLookupCode').value || '').trim().toUpperCase();
  if (nick.length < 2) throw new Error('Escribe el nick con el que te unirás.');
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Introduce un código válido de seis caracteres.');
  const league = await leagueRequest('join-league', { nick, code });
  await loadMyLeagues();
  await loadLeague(league.code);
  await window.Minuto106UI?.success({ title: 'Ya estás dentro', message: `Dispones de 5 intentos propios en “${league.name}”.` });
}

async function initializeLeagues() {
  const nickInput = document.querySelector('#leagueNick');
  nickInput.value = localStorage.getItem('minuto106:nick') || '';
  if (initialCode) document.querySelector('#leagueLookupCode').value = initialCode;

  await loadMyLeagues().catch((error) => showLeagueError(error, 'No se pudieron cargar tus miniligas'));
  if (initialCode) await loadLeague(initialCode).catch((error) => showLeagueError(error, 'No se pudo consultar la miniliga'));

  let nickDebounce;
  nickInput.addEventListener('input', () => {
    window.clearTimeout(nickDebounce);
    nickDebounce = window.setTimeout(() => loadMyLeagues().catch((error) => showLeagueError(error, 'No se pudieron cargar tus miniligas')), 400);
  });
}

document.querySelector('#createLeagueForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  createLeague().catch((error) => showLeagueError(error, 'No se pudo crear la miniliga'));
});
document.querySelector('#joinLeagueForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  joinLeague().catch((error) => showLeagueError(error, 'No se pudo entrar en la miniliga'));
});
document.querySelector('#leagueLookupButton')?.addEventListener('click', () => {
  loadLeague(document.querySelector('#leagueLookupCode').value).catch((error) => showLeagueError(error, 'No se pudo consultar la miniliga'));
});
document.querySelector('#shareLeagueButton')?.addEventListener('click', () => {
  if (selectedLeague) copyLeagueInvitation(selectedLeague).catch((error) => showLeagueError(error, 'No se pudo compartir la miniliga'));
});
document.querySelector('#myLeaguesList')?.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view-league]');
  const shareButton = event.target.closest('[data-share-league]');
  if (viewButton) loadLeague(viewButton.dataset.viewLeague).catch((error) => showLeagueError(error, 'No se pudo consultar la miniliga'));
  if (shareButton) {
    const card = shareButton.closest('[data-league-card]');
    const code = card?.dataset.leagueCard;
    const league = code === selectedLeague?.code
      ? selectedLeague
      : { code, name: card?.querySelector('h3')?.textContent || 'Miniliga' };
    copyLeagueInvitation(league).catch((error) => showLeagueError(error, 'No se pudo compartir la miniliga'));
  }
});

initializeLeagues().catch((error) => showLeagueError(error));
