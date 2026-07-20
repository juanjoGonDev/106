const config = window.__MINUTO106_CONFIG__ ?? {};
const apiBaseUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
const configured = Boolean(apiBaseUrl) && !apiBaseUrl.includes('YOUR_PROJECT_REF');
const VISIBLE_TIMER_MS = 2_000;

const state = {
  phase: 'setup', team: null, nick: localStorage.getItem('minuto106:nick') ?? '',
  deviceId: getDeviceId(), challengeId: null, startedAt: 0, animationFrame: null,
  timerConcealed: false, lastResult: null, turnstileToken: '', turnstileWidgetId: null,
  stopPending: false, integrity: null,
};

const $ = (selector) => document.querySelector(selector);
const panels = ['setup', 'playing', 'result'];
const nickInput = $('#nick');
const startButton = $('#startButton');
const stopButton = $('#stopButton');
const timer = $('#timer');
const gameError = $('#gameError');

nickInput.value = state.nick;
$('#configWarning').hidden = configured;

function getDeviceId() {
  const key = 'minuto106:device-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function showPanel(id) {
  state.phase = id;
  panels.forEach((panel) => $(`#${panel}`).classList.toggle('active', panel === id));
}

function formatMs(value) { return (value / 1000).toFixed(3); }
function teamName(team) { return team === 'spain' ? 'España' : 'Argentina'; }
function teamFlagClass(team) { return team === 'spain' ? 'flag--spain' : 'flag--argentina'; }
function teamInlineHtml(team) { return `<span class="flag ${teamFlagClass(team)}" aria-hidden="true"></span><span>${teamName(team)}</span>`; }

function validateSetup() {
  const captchaReady = !config.turnstileSiteKey || Boolean(state.turnstileToken);
  startButton.disabled = !configured || nickInput.value.trim().length < 2 || !state.team || !captchaReady;
}

async function request(action, payload = {}) {
  if (!configured) throw new Error('Supabase aún no está configurado.');
  const response = await fetch(apiBaseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': state.deviceId },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación.');
  return body;
}

async function refreshNickStatus() {
  const nick = nickInput.value.trim();
  const status = $('#nickStatus');
  if (!configured) { status.textContent = 'Configura Supabase para activar los intentos y el ranking.'; return; }
  if (nick.length < 2) { status.textContent = 'Cada nick dispone de 5 intentos.'; return; }
  try {
    const data = await request('nick-status', { nick });
    status.textContent = data.attemptsLeft ? `${data.attemptsLeft} de 5 intentos disponibles para este nick.` : 'Este nick ya agotó sus intentos. Usa otro para volver a competir.';
  } catch { status.textContent = 'No se pudo comprobar el nick.'; }
}

function clearTimerFrame() {
  if (state.animationFrame !== null) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
}

function resetTimerPresentation() {
  clearTimerFrame();
  state.timerConcealed = false;
  timer.textContent = '0.000';
  timer.classList.remove('concealed');
  timer.setAttribute('aria-label', 'Cronómetro visible');
}

function concealTimer() {
  if (state.timerConcealed) return;
  clearTimerFrame();
  state.timerConcealed = true;
  timer.textContent = '';
  timer.classList.add('concealed');
  timer.setAttribute('aria-label', 'Cronómetro oculto');
  if (state.integrity) state.integrity.timerConcealed = true;
}

function updateTimer() {
  const elapsed = performance.now() - state.startedAt;
  if (elapsed >= VISIBLE_TIMER_MS) { concealTimer(); return; }
  timer.textContent = formatMs(elapsed);
  state.animationFrame = requestAnimationFrame(updateTimer);
}

function createIntegrityState(event) {
  return { trustedStart: event?.isTrusted === true, trustedFinish: false, timerConcealed: false, visibilityChanges: 0, focusLosses: 0 };
}

function showGameError(message) {
  gameError.textContent = message;
  gameError.hidden = !message;
}

async function startGame(event) {
  if (event?.isTrusted !== true || state.phase === 'playing') return;
  startButton.disabled = true;
  startButton.textContent = 'Preparando reto…';
  state.nick = nickInput.value.trim();
  localStorage.setItem('minuto106:nick', state.nick);
  try {
    const challenge = await request('start', { nick: state.nick, team: state.team, turnstileToken: state.turnstileToken || undefined });
    state.challengeId = challenge.challengeId;
    state.integrity = createIntegrityState(event);
    state.stopPending = false;
    $('#playingTeam').innerHTML = teamInlineHtml(state.team);
    showGameError('');
    resetTimerPresentation();
    showPanel('playing');
    state.startedAt = performance.now();
    state.animationFrame = requestAnimationFrame(updateTimer);
  } catch (error) {
    alert(error.message);
    await refreshNickStatus();
  } finally {
    startButton.textContent = 'Comenzar';
    resetTurnstile();
    validateSetup();
  }
}

function resultCopy(differenceMs, team) {
  if (differenceMs === 0) return 'PERFECTO. Has clavado el minuto 106.';
  if (differenceMs <= 10) return 'Precisión histórica. Esto parece imposible.';
  if (differenceMs <= 50) return team === 'spain' ? 'El minuto 106 vuelve a ser español.' : 'Has neutralizado el minuto 106.';
  if (differenceMs <= 150) return 'Rozaste la gloria. Muy pocos estarán tan cerca.';
  if (differenceMs <= 400) return 'Buen intento, pero el reloj no perdona.';
  return 'Necesitas otra prórroga. Vuelve a intentarlo.';
}

async function stopGame(event) {
  if (state.phase !== 'playing' || state.stopPending) return;
  if (event?.isTrusted !== true) { showGameError('La parada debe proceder de una pulsación real del usuario.'); return; }
  state.stopPending = true;
  stopButton.disabled = true;
  state.integrity.trustedFinish = true;
  const clientElapsedMs = Math.round(performance.now() - state.startedAt);
  concealTimer();
  try {
    const data = await request('finish', { challengeId: state.challengeId, clientElapsedMs, clientSignals: state.integrity });
    state.lastResult = data.attempt;
    $('#resultTime').textContent = formatMs(data.attempt.elapsedMs);
    $('#resultMessage').textContent = `${resultCopy(data.attempt.differenceMs, state.team)} Te separaron ${data.attempt.differenceMs} ms.`;
    $('#verificationStatus').textContent = data.attempt.verified ? '✓ Intento validado por el servidor y apto para el ranking.' : 'Intento excluido del ranking por las comprobaciones anti-trampas.';
    $('#verificationStatus').classList.toggle('unverified', !data.attempt.verified);
    $('#attemptsLeft').textContent = data.attemptsLeft ? `Te quedan ${data.attemptsLeft} intentos con ${state.nick}.` : `${state.nick} ha agotado sus 5 intentos. Puedes usar otro nick.`;
    $('#retryButton').hidden = data.attemptsLeft === 0;
    showPanel('result');
    renderStats(data.stats);
  } catch (error) {
    alert(error.message);
    showPanel('setup');
    await refreshNickStatus();
  } finally {
    state.challengeId = null; state.integrity = null; state.stopPending = false; stopButton.disabled = false; clearTimerFrame();
  }
}

function renderStats(stats) {
  const spain = stats.teams.find((team) => team.team === 'spain') ?? { score: 0 };
  const argentina = stats.teams.find((team) => team.team === 'argentina') ?? { score: 0 };
  const spainScore = Number(spain.score ?? 0);
  const argentinaScore = Number(argentina.score ?? 0);
  const totalScore = spainScore + argentinaScore;
  const spainPercent = totalScore ? Math.round((spainScore / totalScore) * 100) : 50;
  $('#spainScore').textContent = spainScore.toLocaleString('es-ES');
  $('#argentinaScore').textContent = argentinaScore.toLocaleString('es-ES');
  $('#battleFill').style.width = `${spainPercent}%`;
  $('#battlePercent').textContent = `${spainPercent}% · ${100 - spainPercent}%`;
  $('#battleTrack').setAttribute('aria-valuenow', String(spainPercent));
  $('#totalAttempts').textContent = `${Number(stats.totalAttempts ?? 0).toLocaleString('es-ES')} intentos`;
  const leaderboard = $('#leaderboard');
  if (!stats.leaderboard.length) { leaderboard.innerHTML = '<li class="empty">Aún no hay marcas verificadas. Sé el primero.</li>'; return; }
  leaderboard.innerHTML = stats.leaderboard.map((entry, index) => `<li><span class="rank">#${index + 1}</span><span class="player">${escapeHtml(entry.nick)}<small><span class="flag ${teamFlagClass(entry.team)}" aria-hidden="true"></span>${teamName(entry.team)} · ${formatMs(entry.elapsedMs)} s</small></span><span class="difference">±${entry.differenceMs} ms</span></li>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }

async function shareResult() {
  if (!state.lastResult) return;
  const text = `${teamName(state.lastResult.team)}: he parado el Minuto 106 en ${formatMs(state.lastResult.elapsedMs)} s, a solo ${state.lastResult.differenceMs} ms. ¿Puedes superarme?`;
  if (navigator.share) await navigator.share({ title: 'Minuto 106', text, url: location.href });
  else { await navigator.clipboard.writeText(`${text} ${location.href}`); $('#shareButton').textContent = 'Enlace copiado'; }
}

function resetTurnstile() {
  state.turnstileToken = '';
  if (state.turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(state.turnstileWidgetId);
}

function initializeTurnstile() {
  if (!config.turnstileSiteKey) return;
  $('#turnstileContainer').hidden = false;
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.defer = true;
  script.onload = () => { state.turnstileWidgetId = window.turnstile.render('#turnstileWidget', { sitekey: config.turnstileSiteKey, callback: (token) => { state.turnstileToken = token; validateSetup(); }, 'expired-callback': () => { state.turnstileToken = ''; validateSetup(); }, 'error-callback': () => { state.turnstileToken = ''; validateSetup(); } }); };
  document.head.append(script);
}

document.querySelectorAll('.team-button').forEach((button) => button.addEventListener('click', (event) => {
  if (!event.isTrusted) return;
  state.team = button.dataset.team;
  document.querySelectorAll('.team-button').forEach((item) => item.classList.toggle('selected', item === button));
  validateSetup();
}));

let nickDebounce;
nickInput.addEventListener('input', () => { validateSetup(); clearTimeout(nickDebounce); nickDebounce = setTimeout(refreshNickStatus, 300); });
document.addEventListener('visibilitychange', () => { if (state.phase === 'playing' && document.hidden && state.integrity) state.integrity.visibilityChanges += 1; });
window.addEventListener('blur', () => { if (state.phase === 'playing' && state.integrity) state.integrity.focusLosses += 1; });
startButton.addEventListener('click', (event) => startGame(event).catch(() => {}));
stopButton.addEventListener('pointerdown', (event) => { event.preventDefault(); stopGame(event).catch(() => {}); });
stopButton.addEventListener('keydown', (event) => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); stopGame(event).catch(() => {}); });
$('#retryButton').addEventListener('click', (event) => { if (!event.isTrusted) return; if (config.turnstileSiteKey) { showPanel('setup'); validateSetup(); } else startGame(event).catch(() => {}); });
$('#changeNickButton').addEventListener('click', (event) => { if (!event.isTrusted) return; showPanel('setup'); nickInput.focus(); refreshNickStatus(); });
$('#shareButton').addEventListener('click', (event) => { if (event.isTrusted) shareResult().catch(() => {}); });

initializeTurnstile();
if (configured) request('stats').then(renderStats).catch(() => {});
validateSetup();
refreshNickStatus();
