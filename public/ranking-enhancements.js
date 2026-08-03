import {
  formatDailyCountdown,
  millisecondsUntilReset,
} from './daily-attempt-limit.js?v=20260802-derived-budget';

(() => {
  const ui = window.Minuto106PlayerUI;
  const homeStats = window.Minuto106HomeStats;
  if (!ui || !homeStats) return;

  const COUNTDOWN_INTERVAL_MS = 1_000;
  let countdownTimer = 0;
  let refreshTimer = 0;
  let latestResetAt = '';
  let refreshPending = false;
  let refreshAttemptedFor = '';

  function resolveAward(award, suffix) {
    if (!award?.nick) return Object.freeze({ empty: true });
    const team = ui.resolveTeam(award.team);
    const formatter = window.Minuto106Format;
    return Object.freeze({
      empty: false,
      nick: String(award.nick),
      team,
      value: formatter?.fullNumber(award.value) ?? String(Number(award.value || 0)),
      suffix,
    });
  }

  function awardHtml(view) {
    if (view.empty) return 'Aún sin dueño';
    const flag = view.team
      ? `<span class="flag award-flag ${view.team.flagClass}" role="img" aria-label="${ui.escapeHtml(view.team.name)}"></span>`
      : '<span class="player-team--unknown">Selección no disponible</span>';
    return `<a class="award-player-link" href="${ui.escapeHtml(ui.playerUrl(view.nick))}" data-player-nick="${ui.escapeHtml(view.nick)}">${flag}<span>${ui.escapeHtml(view.nick)}</span><span>· ${view.value}${view.suffix}</span></a>`;
  }

  function stopCountdown() {
    if (countdownTimer) window.clearInterval(countdownTimer);
    countdownTimer = 0;
  }

  function dispose() {
    stopCountdown();
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = 0;
  }

  function validResetAt(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }

  function refreshAwards(resetAt) {
    if (refreshPending || refreshAttemptedFor === resetAt) return;
    refreshPending = true;
    refreshAttemptedFor = resetAt;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      homeStats.load()
        .catch(() => {
          refreshAttemptedFor = '';
        })
        .finally(() => {
          refreshPending = false;
        });
    }, 0);
  }

  function renderCountdown() {
    const target = document.querySelector('#awardsResetCountdown');
    if (!target) {
      stopCountdown();
      return;
    }
    if (!validResetAt(latestResetAt)) {
      stopCountdown();
      target.textContent = '—';
      target.removeAttribute('title');
      return;
    }

    const remaining = Math.max(0, millisecondsUntilReset(latestResetAt));
    const formatted = remaining === 0 ? '00:00:00' : formatDailyCountdown(remaining);
    target.textContent = formatted;
    target.title = `Los premios globales se reinician en ${formatted}`;
    if (remaining > 0) return;

    stopCountdown();
    refreshAwards(latestResetAt);
  }

  function scheduleCountdown(resetAt) {
    const normalized = validResetAt(resetAt) ? resetAt : '';
    if (normalized !== latestResetAt) {
      latestResetAt = normalized;
      if (refreshAttemptedFor !== normalized) refreshAttemptedFor = '';
    }
    stopCountdown();
    renderCountdown();
    if (millisecondsUntilReset(latestResetAt) > 0) {
      countdownTimer = window.setInterval(renderCountdown, COUNTDOWN_INTERVAL_MS);
    }
  }

  function renderAwards(stats) {
    if (!stats || !Object.hasOwn(stats, 'awards')) return;
    const awards = stats.awards || {};
    const views = [
      resolveAward(awards.goldenBoot, ' ms'),
      resolveAward(awards.goldenGlove, ' ms'),
      resolveAward(awards.goldenBall, ' intentos'),
    ];
    const selectors = ['#goldenBoot', '#goldenGlove', '#goldenBall'];
    for (let index = 0; index < selectors.length; index += 1) {
      const target = document.querySelector(selectors[index]);
      if (target) target.innerHTML = awardHtml(views[index]);
    }
    scheduleCountdown(awards.resetAt);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCountdown();
    else scheduleCountdown(latestResetAt);
  });
  window.addEventListener('pagehide', dispose, { once: true });
  homeStats.subscribe(renderAwards);
})();
