import {
  dailyReferralProgress,
  exhaustedDailyLimitCopy,
  formatDailyCountdown,
  millisecondsUntilReset,
  normalizeDailyAttemptProfile,
} from './daily-attempt-limit.js';

let latestDetail = null;
let countdownTimer = 0;
let refreshPending = false;

function installStyles() {
  if (document.querySelector('link[data-daily-attempt-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './v19.css';
  link.dataset.dailyAttemptStyles = 'true';
  document.head.append(link);
}

function installCard() {
  if (document.querySelector('#dailyLimitCard')) return;
  const section = document.createElement('section');
  section.id = 'dailyLimitCard';
  section.className = 'daily-limit-card';
  section.hidden = true;
  section.setAttribute('aria-labelledby', 'dailyLimitTitle');
  section.innerHTML = '<div class="daily-limit-card__header"><div><p class="eyebrow">LÍMITE GLOBAL DIARIO</p><strong id="dailyLimitTitle">Vuelves a jugar en</strong></div><output id="dailyLimitCountdown" class="daily-limit-countdown" aria-live="polite">00:00:00</output></div><p id="dailyLimitCount" class="daily-limit-card__count"></p><p id="dailyLimitReferral" class="daily-limit-card__referral"></p>';
  const anchor = document.querySelector('#competitionPickerSection');
  anchor?.parentNode?.insertBefore(section, anchor);
}

function updateProductCopy() {
  const hero = document.querySelector('.game-hero .subtitle');
  if (hero) hero.textContent = 'Cada nick tiene 5 intentos globales diarios y otros 5 independientes por miniliga. Los referidos pueden elevar el límite global diario hasta 10.';
  const referralNotice = document.querySelector('#referralNotice');
  if (referralNotice) referralNotice.textContent = 'Has entrado desde una invitación. Completa 5 intentos globales válidos para aumentar en 1 el límite diario de quien te invitó, en todos sus nicks.';
  const pickerHint = document.querySelector('#competitionPickerSection .hint');
  if (pickerHint) pickerHint.textContent = 'El global se reinicia cada día según el servidor. Cada liga conserva su propio límite de 5 intentos durante toda la competición.';
}

function stopCountdown() {
  if (countdownTimer) window.clearInterval(countdownTimer);
  countdownTimer = 0;
}

function elements() {
  return {
    card: document.querySelector('#dailyLimitCard'),
    count: document.querySelector('#dailyLimitCount'),
    countdown: document.querySelector('#dailyLimitCountdown'),
    referral: document.querySelector('#dailyLimitReferral'),
    status: document.querySelector('#nickStatus'),
    result: document.querySelector('#attemptsLeft'),
    retry: document.querySelector('#retryButton'),
  };
}

function selectedGlobal(detail) {
  return detail?.selected?.type !== 'league';
}

async function refreshAfterReset() {
  if (refreshPending) return;
  refreshPending = true;
  try {
    await window.Minuto106Competition?.refresh?.('daily-limit-reset');
  } finally {
    refreshPending = false;
  }
}

function renderCountdown(profile, targets) {
  const state = normalizeDailyAttemptProfile(profile);
  const remaining = millisecondsUntilReset(state.resetAt);
  const formatted = formatDailyCountdown(remaining);
  if (targets.countdown) targets.countdown.textContent = formatted;
  if (remaining > 0) return;
  stopCountdown();
  if (targets.countdown) targets.countdown.textContent = '00:00:00';
  refreshAfterReset().catch(() => {});
}

function render(detail) {
  latestDetail = detail ?? null;
  const targets = elements();
  const profile = detail?.profile;
  const show = detail?.availability === 'owned'
    && selectedGlobal(detail)
    && profile?.nick
    && normalizeDailyAttemptProfile(profile).exhausted;

  stopCountdown();
  if (targets.card) targets.card.hidden = !show;
  if (!show) return;

  const state = normalizeDailyAttemptProfile(profile);
  const progress = dailyReferralProgress(state);
  if (targets.count) {
    targets.count.textContent = `${state.attemptsUsed} de ${state.maxAttempts} intentos usados hoy`;
  }
  if (targets.referral) {
    targets.referral.textContent = state.atCeiling
      ? progress.copy
      : `Tu cuenta tiene +${state.bonusAttempts} intentos diarios en todos sus nicks. ${progress.copy}`;
  }

  const copy = exhaustedDailyLimitCopy(profile);
  if (targets.status) targets.status.textContent = copy;
  if (targets.result && document.querySelector('#result')?.classList.contains('active')) {
    targets.result.textContent = copy;
  }
  if (targets.retry) targets.retry.hidden = true;

  renderCountdown(profile, targets);
  if (millisecondsUntilReset(state.resetAt) > 0) {
    countdownTimer = window.setInterval(() => renderCountdown(profile, targets), 1000);
  }
}

function referralUrl(profile) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (profile?.referralCode) url.searchParams.set('ref', profile.referralCode);
  return url.toString();
}

function invitationText(includeResult) {
  const profile = latestDetail?.profile;
  const attempt = window.__MINUTO106_LATEST_ATTEMPT__;
  const parts = [];
  if (includeResult && attempt?.competitionType !== 'league' && Number.isFinite(Number(attempt?.differenceMs))) {
    parts.push(`Me he quedado a ${attempt.differenceMs} ms del 10.600.`);
  } else {
    parts.push('¿Puedes clavar el Minuto 106?');
  }
  parts.push('Completa 5 intentos globales válidos y aumenta mi límite diario en todos mis nicks.');
  if (profile?.globalRankBest) parts.push(`Voy #${profile.globalRankBest}.`);
  return parts.join(' ');
}

async function shareInvitation(includeResult) {
  const profile = latestDetail?.profile;
  if (!profile?.referralCode) return;
  await window.Minuto106UI?.share({
    title: 'Minuto 106',
    text: invitationText(includeResult),
    url: referralUrl(profile),
  });
}

function installShareOverrides() {
  for (const [selector, includeResult] of [['#shareButton', true], ['#copyReferralButton', false]]) {
    document.querySelector(selector)?.addEventListener('click', (event) => {
      if (!event.isTrusted || window.Minuto106Competition?.selected?.type === 'league') return;
      if (!latestDetail?.profile?.referralCode) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      shareInvitation(includeResult).catch((error) => window.Minuto106UI?.error({
        title: 'No se pudo compartir',
        message: error instanceof Error ? error.message : 'No se pudo preparar la invitación.',
      }));
    }, true);
  }
}

function initialize() {
  installStyles();
  installCard();
  updateProductCopy();
  installShareOverrides();
  document.addEventListener('minuto106:player-context', (event) => render(event.detail));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && latestDetail) render(latestDetail);
  });
  window.addEventListener('pagehide', stopCountdown, { once: true });
  if (window.__MINUTO106_PLAYER_CONTEXT__) render(window.__MINUTO106_PLAYER_CONTEXT__);
}

initialize();
