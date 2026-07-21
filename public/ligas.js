const leagueConfig = window.__MINUTO106_CONFIG__ ?? {};
const leagueApi = String(leagueConfig.apiBaseUrl ?? '').replace(/\/$/, '');
const leagueDevice = localStorage.getItem('minuto106:device-id') || crypto.randomUUID();
localStorage.setItem('minuto106:device-id', leagueDevice);

async function leagueRequest(action, payload = {}) {
  const response = await fetch(leagueApi, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-id': leagueDevice }, body: JSON.stringify({ action, ...payload }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo cargar la miniliga.');
  return body;
}
function showLeagueError(error) {
  return window.Minuto106UI?.error({
    title: 'No se pudo consultar la miniliga',
    message: error instanceof Error ? error.message : String(error || 'Se produjo un error inesperado.'),
  }) ?? Promise.resolve();
}
function escapeLeague(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function hasValue(value) { return value !== null && value !== undefined; }
async function loadLeague() {
  const code = String(document.querySelector('#leagueLookupCode').value || new URLSearchParams(location.search).get('league') || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Introduce un código válido de seis caracteres.');
  const league = await leagueRequest('league', { code });
  const section = document.querySelector('#leagueLookupResult');
  section.hidden = false;
  document.querySelector('#leagueLookupTitle').textContent = `${league.name} · ${league.code}`;
  const remaining = Math.max(0, new Date(league.endsAt).getTime() - Date.now());
  document.querySelector('#leagueLookupEnds').textContent = remaining ? `Termina en ${Math.ceil(remaining / 3_600_000)} h` : 'Finalizada';
  document.querySelector('#leagueLookupList').innerHTML = league.leaderboard?.length
    ? league.leaderboard.map((entry) => `<li><span class="rank">#${entry.rank ?? '—'}</span><span class="player">${escapeLeague(entry.nick)}</span><span class="difference">${hasValue(entry.bestDifferenceMs) ? `±${entry.bestDifferenceMs} ms` : 'Sin marca'}</span></li>`).join('')
    : '<li class="empty">Todavía no hay participantes.</li>';
}
document.querySelector('#leagueLookupButton')?.addEventListener('click', () => loadLeague().catch(showLeagueError));
const initialCode = new URLSearchParams(location.search).get('league');
if (initialCode) {
  document.querySelector('#leagueLookupCode').value = initialCode.toUpperCase();
  loadLeague().catch(showLeagueError);
}