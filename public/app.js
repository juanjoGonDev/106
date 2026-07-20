const TARGET_MS = 10_600;

const state = {
  team: null,
  nick: localStorage.getItem('minuto106:nick') ?? '',
  startedAt: 0,
  animationFrame: null,
  lastResult: null,
};

const $ = (selector) => document.querySelector(selector);
const panels = ['setup', 'playing', 'result'];

const nickInput = $('#nick');
const startButton = $('#startButton');
const stopButton = $('#stopButton');
const timer = $('#timer');

nickInput.value = state.nick;

function showPanel(id) {
  panels.forEach((panel) => $(`#${panel}`).classList.toggle('active', panel === id));
}

function formatMs(value) {
  return (value / 1000).toFixed(3);
}

function teamLabel(team) {
  return team === 'spain' ? '🇪🇸 España' : '🇦🇷 Argentina';
}

function validateSetup() {
  startButton.disabled = nickInput.value.trim().length < 2 || !state.team;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación.');
  return body;
}

async function refreshNickStatus() {
  const nick = nickInput.value.trim();
  const status = $('#nickStatus');
  if (nick.length < 2) {
    status.textContent = 'Cada nick dispone de 5 intentos.';
    return;
  }

  try {
    const data = await request(`/api/nicks/${encodeURIComponent(nick)}`);
    status.textContent = data.attemptsLeft
      ? `${data.attemptsLeft} de 5 intentos disponibles para este nick.`
      : 'Este nick ya agotó sus intentos. Usa otro para volver a competir.';
  } catch {
    status.textContent = 'No se pudo comprobar el nick.';
  }
}

function updateTimer() {
  const elapsed = performance.now() - state.startedAt;
  timer.textContent = formatMs(elapsed);
  if (elapsed >= 2_000) timer.classList.add('hidden');
  state.animationFrame = requestAnimationFrame(updateTimer);
}

function startGame() {
  state.nick = nickInput.value.trim();
  localStorage.setItem('minuto106:nick', state.nick);
  $('#playingTeam').textContent = teamLabel(state.team);
  timer.textContent = '0.000';
  timer.classList.remove('hidden');
  showPanel('playing');
  state.startedAt = performance.now();
  state.animationFrame = requestAnimationFrame(updateTimer);
}

function resultCopy(differenceMs, team) {
  if (differenceMs === 0) return 'PERFECTO. Has clavado el minuto 106.';
  if (differenceMs <= 10) return 'Precisión histórica. Esto parece imposible.';
  if (differenceMs <= 50) return team === 'spain' ? 'El minuto 106 vuelve a ser español.' : 'Has neutralizado el minuto 106.';
  if (differenceMs <= 150) return 'Rozaste la gloria. Muy pocos estarán tan cerca.';
  if (differenceMs <= 400) return 'Buen intento, pero el reloj no perdona.';
  return 'Necesitas otra prórroga. Vuelve a intentarlo.';
}

async function stopGame() {
  stopButton.disabled = true;
  cancelAnimationFrame(state.animationFrame);
  const elapsedMs = Math.round(performance.now() - state.startedAt);

  try {
    const data = await request('/api/attempts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nick: state.nick, team: state.team, elapsedMs }),
    });

    state.lastResult = data.attempt;
    $('#resultTime').textContent = formatMs(data.attempt.elapsedMs);
    $('#resultMessage').textContent = `${resultCopy(data.attempt.differenceMs, state.team)} Te separaron ${data.attempt.differenceMs} ms.`;
    $('#attemptsLeft').textContent = data.attemptsLeft
      ? `Te quedan ${data.attemptsLeft} intentos con ${state.nick}.`
      : `${state.nick} ha agotado sus 5 intentos. Puedes usar otro nick.`;
    $('#retryButton').hidden = data.attemptsLeft === 0;
    showPanel('result');
    renderStats(data.stats);
  } catch (error) {
    alert(error.message);
    showPanel('setup');
    await refreshNickStatus();
  } finally {
    stopButton.disabled = false;
  }
}

function renderStats(stats) {
  const spain = stats.teams.find((team) => team.team === 'spain');
  const argentina = stats.teams.find((team) => team.team === 'argentina');
  const totalScore = spain.score + argentina.score;
  const spainPercent = totalScore ? Math.round((spain.score / totalScore) * 100) : 50;

  $('#spainScore').textContent = spain.score.toLocaleString('es-ES');
  $('#argentinaScore').textContent = argentina.score.toLocaleString('es-ES');
  $('#battleFill').style.width = `${spainPercent}%`;
  $('#battlePercent').textContent = `${spainPercent} / ${100 - spainPercent}`;
  $('#totalAttempts').textContent = `${stats.totalAttempts.toLocaleString('es-ES')} intentos`;

  const leaderboard = $('#leaderboard');
  if (!stats.leaderboard.length) {
    leaderboard.innerHTML = '<li class="empty">Aún no hay marcas. Sé el primero.</li>';
    return;
  }

  leaderboard.innerHTML = stats.leaderboard.map((entry, index) => `
    <li>
      <span class="rank">#${index + 1}</span>
      <span class="player">${escapeHtml(entry.nick)}<small>${teamLabel(entry.team)} · ${formatMs(entry.elapsedMs)} s</small></span>
      <span class="difference">±${entry.differenceMs} ms</span>
    </li>
  `).join('');
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

async function shareResult() {
  if (!state.lastResult) return;
  const text = `${teamLabel(state.lastResult.team)} He parado el Minuto 106 en ${formatMs(state.lastResult.elapsedMs)} s: solo ${state.lastResult.differenceMs} ms de diferencia. ¿Puedes superarme?`;
  if (navigator.share) {
    await navigator.share({ title: 'Minuto 106', text, url: location.href });
  } else {
    await navigator.clipboard.writeText(`${text} ${location.href}`);
    $('#shareButton').textContent = 'Enlace copiado';
  }
}

document.querySelectorAll('.team-button').forEach((button) => {
  button.addEventListener('click', () => {
    state.team = button.dataset.team;
    document.querySelectorAll('.team-button').forEach((item) => item.classList.toggle('selected', item === button));
    validateSetup();
  });
});

let nickDebounce;
nickInput.addEventListener('input', () => {
  validateSetup();
  clearTimeout(nickDebounce);
  nickDebounce = setTimeout(refreshNickStatus, 300);
});

startButton.addEventListener('click', startGame);
stopButton.addEventListener('click', stopGame);
$('#retryButton').addEventListener('click', startGame);
$('#changeNickButton').addEventListener('click', () => {
  nickInput.focus();
  showPanel('setup');
  refreshNickStatus();
});
$('#shareButton').addEventListener('click', () => shareResult().catch(() => {}));

request('/api/stats').then(renderStats).catch(() => {});
validateSetup();
refreshNickStatus();
