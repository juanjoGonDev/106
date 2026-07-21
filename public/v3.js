const v3Config = window.__MINUTO106_CONFIG__ ?? {};
const v3ApiUrl = String(v3Config.apiBaseUrl ?? '').replace(/\/$/, '');
const v3DeviceKey = 'minuto106:device-id';
const v3DeviceId = localStorage.getItem(v3DeviceKey) || crypto.randomUUID();
localStorage.setItem(v3DeviceKey, v3DeviceId);
const v3Params = new URLSearchParams(location.search);
const duelCode = v3Params.get('duel') || '';
const leagueCodeFromUrl = (v3Params.get('league') || '').toUpperCase();

const v3$ = (selector) => document.querySelector(selector);

async function v3Request(action, payload = {}) {
  const response = await fetch(v3ApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': v3DeviceId },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación.');
  return body;
}

function showV3Error(error, title = 'No se pudo completar') {
  return window.Minuto106UI?.error({
    title,
    message: error instanceof Error ? error.message : String(error || 'Se produjo un error inesperado.'),
  }) ?? Promise.resolve();
}

function currentNick() {
  return String(v3$('#nick')?.value || localStorage.getItem('minuto106:nick') || '').trim();
}

function formatAward(award, suffix = ' ms') {
  if (!award?.nick) return 'Aún sin dueño';
  return `${award.nick} · ${Number(award.value).toLocaleString('es-ES')}${suffix}`;
}

async function loadAwards() {
  if (!v3ApiUrl) return;
  try {
    const stats = await v3Request('stats');
    v3$('#goldenBoot').textContent = formatAward(stats.awards?.goldenBoot);
    v3$('#goldenGlove').textContent = formatAward(stats.awards?.goldenGlove);
    v3$('#goldenBall').textContent = formatAward(stats.awards?.goldenBall, ' intentos');
  } catch {
    // Main app already handles the global error surface.
  }
}

function buildGameUrl(key, value) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set(key, value);
  return url.toString();
}

async function createDuel() {
  const nick = currentNick();
  if (nick.length < 2) throw new Error('Escribe primero tu nick y completa al menos un intento válido.');
  const duel = await v3Request('create-duel', { nick });
  const url = buildGameUrl('duel', duel.code);
  const text = `Te reto en Minuto 106. Mi marca objetivo está a ${duel.targetDifferenceMs} ms del tiempo perfecto. Si me superas, ganas 3 intentos extra. ${url}`;
  await navigator.clipboard.writeText(text);
  showV3Toast('Reto copiado', 'El enlace está listo para compartir. Si te superan, el rival gana 3 intentos; si resistes, tú ganas 1.', true);
}

async function resolveDuel() {
  const nick = currentNick();
  if (!nick || !duelCode) return;
  const result = await v3Request('resolve-duel', { nick, code: duelCode });
  const message = result.won
    ? `Has ganado el duelo y recibido ${result.rewardAttempts} intentos extra.`
    : `No superaste la marca. El retador recibe ${result.rewardAttempts} intento extra.`;
  showV3Toast(result.won ? 'Duelo ganado' : 'Duelo resuelto', message, result.won);
  await refreshCurrentProfile();
}

async function createLeague() {
  const nick = currentNick();
  const name = String(v3$('#leagueName')?.value || '').trim();
  if (nick.length < 2) throw new Error('Escribe tu nick antes de crear una miniliga.');
  const league = await v3Request('create-league', { nick, name });
  const url = buildGameUrl('league', league.code);
  await navigator.clipboard.writeText(`Únete a mi miniliga “${league.name}”. Dura 3 días. Código ${league.code}: ${url}`);
  showV3Toast('Miniliga creada', `Código ${league.code}. El enlace se ha copiado.`, true);
  await loadLeague(league.code);
}

async function joinLeague(code = String(v3$('#leagueCode')?.value || leagueCodeFromUrl).trim().toUpperCase()) {
  const nick = currentNick();
  if (nick.length < 2) throw new Error('Escribe tu nick antes de unirte.');
  const league = await v3Request('join-league', { nick, code });
  showV3Toast('Ya estás dentro', `Te has unido a “${league.name}”.`, false);
  await loadLeague(league.code);
}

function hasValue(value) {
  return value !== null && value !== undefined;
}

async function loadLeague(code) {
  if (!code) return;
  const league = await v3Request('league', { code });
  if (!league?.code) return;
  const panel = v3$('#leaguePanel');
  panel.hidden = false;
  v3$('#leagueTitle').textContent = `${league.name} · ${league.code}`;
  const remaining = Math.max(0, new Date(league.endsAt).getTime() - Date.now());
  const hours = Math.ceil(remaining / 3_600_000);
  v3$('#leagueEnds').textContent = remaining ? `Termina en ${hours} h` : 'Finalizada';
  const list = v3$('#leagueLeaderboard');
  list.innerHTML = league.leaderboard?.length
    ? league.leaderboard.map((entry) => `<li><span class="rank">#${entry.rank ?? '—'}</span><span class="player">${escapeV3(entry.nick)}</span><span class="difference">${hasValue(entry.bestDifferenceMs) ? `±${entry.bestDifferenceMs} ms` : 'Sin marca'}</span></li>`).join('')
    : '<li class="empty">Todavía no hay participantes.</li>';
}

async function openPublicProfile(nick) {
  const profile = await v3Request('public-profile', { nick });
  if (!profile?.nick) throw new Error('No se encontró el perfil.');
  const dialog = v3$('#profileDialog');
  v3$('#publicProfileContent').innerHTML = `
    <p class="eyebrow">PERFIL PÚBLICO</p>
    <h2>${escapeV3(profile.nick)}</h2>
    <div class="public-profile-grid">
      <div><span>Mejor marca</span><strong>${hasValue(profile.bestDifferenceMs) ? `±${profile.bestDifferenceMs} ms` : '—'}</strong></div>
      <div><span>Media</span><strong>${hasValue(profile.averageDifferenceMs) ? `±${profile.averageDifferenceMs} ms` : '—'}</strong></div>
      <div><span>Puesto global</span><strong>${profile.globalRankBest ? `#${profile.globalRankBest}` : '—'}</strong></div>
      <div><span>Intentos válidos</span><strong>${profile.verifiedAttempts ?? 0}</strong></div>
      <div><span>Referidos</span><strong>${profile.completedReferrals ?? 0}</strong></div>
      <div><span>Intentos extra</span><strong>${profile.bonusAttempts ?? 0}</strong></div>
    </div>
    <h3>Últimos intentos</h3>
    <ol class="attempt-history">${profile.history?.length ? profile.history.slice(0, 10).map((attempt, index) => `<li><span class="history-number">${index + 1}</span><span>${(Number(attempt.elapsedMs) / 1000).toFixed(3)} s</span><strong>±${attempt.differenceMs} ms</strong><small class="${attempt.verified ? 'valid' : 'invalid'}">${attempt.verified ? 'Válido' : 'Excluido'}</small></li>`).join('') : '<li class="empty">Sin intentos.</li>'}</ol>`;
  dialog.showModal();
}

function extractLeaderboardNick(item) {
  const player = item.querySelector('.player');
  if (!player) return '';
  return Array.from(player.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)?.textContent?.trim() || '';
}

function drawResultCard(profile) {
  const canvas = v3$('#shareCanvas');
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, '#620018'); gradient.addColorStop(.5, '#08090c'); gradient.addColorStop(1, '#10285b');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createRadialGradient(600, 300, 20, 600, 300, 320);
  glow.addColorStop(0, 'rgba(244,201,93,.28)'); glow.addColorStop(1, 'rgba(244,201,93,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center'; ctx.fillStyle = '#f4c95d'; ctx.font = '700 28px Arial'; ctx.fillText('MINUTO 106', 600, 80);
  ctx.fillStyle = '#fff'; ctx.font = '900 82px Arial'; ctx.fillText(profile.nick || 'Jugador', 600, 185);
  ctx.font = '900 150px Arial'; ctx.fillText(hasValue(profile.bestDifferenceMs) ? `±${profile.bestDifferenceMs} ms` : '—', 600, 360);
  ctx.fillStyle = '#d4d7df'; ctx.font = '700 34px Arial';
  ctx.fillText(`Puesto global ${profile.globalRankBest ? `#${profile.globalRankBest}` : '—'} · Media ${hasValue(profile.averageDifferenceMs) ? `±${profile.averageDifferenceMs} ms` : '—'}`, 600, 440);
  ctx.font = '600 27px Arial'; ctx.fillText(`${profile.verifiedAttempts ?? 0} intentos válidos · ${profile.completedReferrals ?? 0} rivales completados`, 600, 495);
  ctx.fillStyle = '#f4c95d'; ctx.font = '700 26px Arial'; ctx.fillText('¿PUEDES SUPERARME?', 600, 560);
  return canvas;
}

async function downloadResultCard() {
  const nick = currentNick();
  if (!nick) throw new Error('Escribe tu nick.');
  const profile = await v3Request('profile', { nick });
  const canvas = drawResultCard(profile);
  const link = document.createElement('a');
  link.download = `minuto-106-${profile.nick}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function spawnConfetti(amount = 36) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = v3$('#confettiLayer');
  layer.innerHTML = '';
  const colors = ['#f4c95d', '#df1738', '#5ab4ef', '#ffffff'];
  for (let index = 0; index < amount; index += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.setProperty('--x', `${(Math.random() - .5) * 240}px`);
    piece.style.animationDelay = `${Math.random() * .45}s`;
    piece.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
    layer.append(piece);
  }
}

function showV3Toast(title, text, major = false) {
  const celebration = v3$('#celebration');
  v3$('#celebrationTitle').textContent = title;
  v3$('#celebrationText').textContent = text;
  v3$('#celebrationIcon').textContent = major ? '★' : '⚽';
  celebration.hidden = false;
  spawnConfetti(major ? 52 : 22);
  requestAnimationFrame(() => celebration.classList.add('active'));
  setTimeout(() => {
    celebration.classList.remove('active');
    setTimeout(() => { celebration.hidden = true; }, 350);
  }, major ? 3400 : 2300);
}

async function refreshCurrentProfile() {
  const nick = currentNick();
  if (!nick) return;
  const profile = await v3Request('profile', { nick });
  const attempts = v3$('#profileAttempts');
  if (attempts && profile?.nick) attempts.textContent = `${profile.attemptsUsed} / ${profile.maxAttempts} intentos`;
}

function escapeV3(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

const achievementObserver = new MutationObserver(() => {
  const banner = v3$('#achievementBanner');
  if (!banner || banner.hidden) return;
  if (banner.classList.contains('record')) spawnConfetti(60);
  else if (banner.classList.contains('top10')) spawnConfetti(30);
});
if (v3$('#achievementBanner')) achievementObserver.observe(v3$('#achievementBanner'), { attributes: true, childList: true, subtree: true });

v3$('#leaderboard')?.addEventListener('click', (event) => {
  const item = event.target.closest('li');
  const nick = item ? extractLeaderboardNick(item) : '';
  if (nick) openPublicProfile(nick).catch((error) => showV3Error(error, 'No se pudo abrir el perfil'));
});
v3$('#closeProfileDialog')?.addEventListener('click', () => v3$('#profileDialog').close());
v3$('#createDuelButton')?.addEventListener('click', () => createDuel().catch((error) => showV3Error(error, 'No se pudo crear el reto')));
v3$('#quickDuelButton')?.addEventListener('click', () => createDuel().catch((error) => showV3Error(error, 'No se pudo crear el reto')));
v3$('#createLeagueButton')?.addEventListener('click', () => createLeague().catch((error) => showV3Error(error, 'No se pudo crear la miniliga')));
v3$('#joinLeagueButton')?.addEventListener('click', () => joinLeague().catch((error) => showV3Error(error, 'No se pudo entrar en la miniliga')));
v3$('#downloadCardButton')?.addEventListener('click', () => downloadResultCard().catch((error) => showV3Error(error, 'No se pudo generar la tarjeta')));

if (duelCode) {
  const notice = v3$('#duelNotice');
  notice.hidden = false;
  notice.innerHTML = 'Has aceptado un reto directo. Completa tus intentos y después <button id="resolveDuelButton" class="ghost compact" type="button">comprobar si ganaste</button>.';
  notice.querySelector('#resolveDuelButton').addEventListener('click', () => resolveDuel().catch((error) => showV3Error(error, 'No se pudo resolver el duelo')));
}
if (leagueCodeFromUrl) {
  v3$('#leagueNotice').textContent = `Has abierto la miniliga ${leagueCodeFromUrl}. Escribe tu nick y pulsa “Unirme”.`;
  v3$('#leagueCode').value = leagueCodeFromUrl;
  loadLeague(leagueCodeFromUrl).catch(() => {});
}

loadAwards();