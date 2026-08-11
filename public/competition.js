import { resolveDailyAttemptState } from './daily-attempt-limit.js?v=20260802-derived-budget';
import {
  formatRestrictionCountdown,
  normalizePlayRestriction,
  restrictionEndText,
  restrictionReasonText,
  restrictionRemainingSeconds,
  restrictionScopeLabel,
  restrictionSourceLabel,
} from './play-restriction-state.js';

(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const gameApiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const playerContextUrl = gameApiUrl.replace(/\/game-api$/, '/player-context');
  const deviceKey = 'minuto106:device-id';
  const selectionKey = 'minuto106:competition-v1';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const restrictionStylesHref = new URL('./play-restriction.css', import.meta.url).href;
  const routeSelection = String(
    new URLSearchParams(location.search).get('competition')
    || new URLSearchParams(location.search).get('league')
    || '',
  ).trim().toUpperCase();

  let context = emptyContext();
  let selectedValue = 'global';
  let contextPending = false;
  let debounceTimer = 0;
  let requestSequence = 0;
  let lastLeagueResult = null;
  let restrictionTimer = 0;
  let restrictionRefreshPending = false;
  let restrictionRefreshFailed = false;

  localStorage.setItem(deviceKey, deviceId);

  function emptyContext(accountPolicy = null, restriction = null) {
    return Object.freeze({
      availability: 'unknown',
      profile: null,
      leagues: [],
      accountPolicy,
      restriction: restriction?.active === true ? Object.freeze({ ...restriction }) : null,
    });
  }

  function currentNick() {
    return String(document.querySelector('#nick')?.value || localStorage.getItem('minuto106:nick') || '').trim();
  }

  function localAccountToken() {
    return window.Minuto106Access?.getAccountToken?.(false) || '';
  }

  function accountDailyAttemptPolicy() {
    return context.accountPolicy ?? window.Minuto106Access?.getAccountDailyAttemptPolicy?.() ?? null;
  }

  function globalAttemptState() {
    return resolveDailyAttemptState(context.profile, accountDailyAttemptPolicy());
  }

  function leaguePublicUrl(publicId) {
    return new URL(`./ligas/${encodeURIComponent(publicId)}`, location.href).toString();
  }

  function selectedLeague() {
    const publicId = selectedValue.startsWith('league:') ? selectedValue.slice('league:'.length) : '';
    return context.leagues.find((league) => league.publicId === publicId) ?? null;
  }

  function selectedScope() {
    const league = selectedLeague();
    if (league) {
      return Object.freeze({
        type: 'league',
        publicId: String(league.publicId || ''),
        competitionCode: String(league.competitionCode || ''),
        name: String(league.name || 'Miniliga'),
        attemptsLeft: Number(league.attemptsLeft ?? 0),
        maxAttempts: Number(league.maxAttempts ?? 5),
        available: league.active === true && Number(league.attemptsLeft ?? 0) > 0,
        waiting: league.waiting === true,
        finished: league.finished === true,
      });
    }

    const state = globalAttemptState();
    return Object.freeze({
      type: 'global',
      publicId: '',
      competitionCode: '',
      name: 'Ranking global',
      attemptsLeft: state.attemptsLeft,
      maxAttempts: state.maxAttempts,
      available: context.availability !== 'occupied' && state.attemptsLeft > 0,
      waiting: false,
      finished: false,
    });
  }

  function canStart() {
    const scope = selectedScope();
    return !contextPending
      && !restrictionRefreshPending
      && !restrictionRefreshFailed
      && context.restriction?.active !== true
      && context.availability !== 'occupied'
      && scope.available
      && Boolean(scope.type === 'global' || scope.competitionCode);
  }

  function notify(source) {
    document.dispatchEvent(new CustomEvent('minuto106:player-context', {
      detail: Object.freeze({
        availability: context.availability,
        profile: context.profile,
        leagues: context.leagues,
        restriction: context.restriction,
        dailyAttemptPolicy: accountDailyAttemptPolicy(),
        selected: selectedScope(),
        canStart: canStart(),
        pending: contextPending || restrictionRefreshPending,
        source,
      }),
    }));
  }

  function ensureRestrictionUi() {
    if (!document.querySelector('link[data-play-restriction-styles]')) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = restrictionStylesHref;
      stylesheet.dataset.playRestrictionStyles = 'true';
      document.head.append(stylesheet);
    }

    let panel = document.querySelector('#playRestriction');
    if (panel) return panel;
    const startButton = document.querySelector('#startButton');
    if (!startButton?.parentElement) return null;

    panel = document.createElement('section');
    panel.id = 'playRestriction';
    panel.className = 'play-restriction';
    panel.hidden = true;
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-labelledby', 'playRestrictionTitle');

    const heading = document.createElement('div');
    heading.className = 'play-restriction__heading';
    const title = document.createElement('strong');
    title.id = 'playRestrictionTitle';
    title.textContent = 'Acceso competitivo bloqueado';
    const source = document.createElement('span');
    source.id = 'playRestrictionSource';
    source.className = 'play-restriction__source';
    heading.append(title, source);

    const reason = document.createElement('p');
    reason.id = 'playRestrictionReason';
    reason.className = 'play-restriction__reason';

    const time = document.createElement('div');
    time.className = 'play-restriction__time';
    const timeLabel = document.createElement('span');
    timeLabel.textContent = 'Disponible de nuevo en';
    const countdown = document.createElement('output');
    countdown.id = 'playRestrictionCountdown';
    countdown.setAttribute('aria-label', 'Tiempo restante de la restricción');
    time.append(timeLabel, countdown);

    const end = document.createElement('p');
    end.id = 'playRestrictionEnd';
    end.className = 'play-restriction__end';
    panel.append(heading, reason, time, end);
    startButton.before(panel);
    return panel;
  }

  function restoreStartButtonLabel() {
    const startButton = document.querySelector('#startButton');
    if (!startButton?.dataset.restrictionPreviousLabel) return;
    startButton.textContent = startButton.dataset.restrictionPreviousLabel;
    delete startButton.dataset.restrictionPreviousLabel;
  }

  function markStartButtonRestricted() {
    const startButton = document.querySelector('#startButton');
    if (!startButton) return;
    if (!startButton.dataset.restrictionPreviousLabel) {
      startButton.dataset.restrictionPreviousLabel = startButton.textContent || 'Comenzar';
    }
    startButton.textContent = 'Acceso bloqueado';
    startButton.disabled = true;
  }

  function clearRestrictionTimer() {
    if (!restrictionTimer) return;
    window.clearInterval(restrictionTimer);
    restrictionTimer = 0;
  }

  function scheduleRestrictionTimer(restriction) {
    if (restrictionTimer || restriction?.permanent) return;
    restrictionTimer = window.setInterval(() => renderRestriction(), 1_000);
  }

  function refreshExpiredRestriction() {
    if (restrictionRefreshPending || restrictionRefreshFailed) return;
    restrictionRefreshPending = true;
    contextPending = true;
    clearRestrictionTimer();
    renderRestriction();
    renderStatus();
    notify('restriction-expired:pending');
    syncPlayerContext('restriction-expired')
      .catch(() => {})
      .finally(() => {
        restrictionRefreshPending = false;
        contextPending = false;
        renderRestriction();
        renderStatus();
        notify('restriction-expired:settled');
      });
  }

  function renderRestriction() {
    const panel = ensureRestrictionUi();
    if (!panel) return;
    const raw = context.restriction;
    if (raw?.active !== true) {
      clearRestrictionTimer();
      panel.hidden = true;
      restoreStartButtonLabel();
      return;
    }

    markStartButtonRestricted();
    panel.hidden = false;
    const restriction = normalizePlayRestriction(raw);
    const source = panel.querySelector('#playRestrictionSource');
    const reason = panel.querySelector('#playRestrictionReason');
    const countdown = panel.querySelector('#playRestrictionCountdown');
    const time = panel.querySelector('.play-restriction__time');
    const end = panel.querySelector('#playRestrictionEnd');

    if (!restriction) {
      clearRestrictionTimer();
      if (restrictionRefreshFailed) {
        if (source) source.textContent = 'Comprobación pendiente';
        if (reason) reason.textContent = 'No se pudo confirmar con el servidor que la restricción haya terminado. El acceso seguirá bloqueado hasta una comprobación correcta.';
        if (time) time.hidden = true;
        if (end) end.textContent = 'Vuelve a intentarlo cuando haya conexión con el servidor.';
        return;
      }
      if (source) source.textContent = 'Comprobando';
      if (reason) reason.textContent = 'La restricción ha llegado a su hora de finalización. Estamos confirmando con el servidor si ya puedes volver a jugar.';
      if (time) time.hidden = true;
      if (end) end.textContent = '';
      refreshExpiredRestriction();
      return;
    }

    if (source) source.textContent = `${restrictionSourceLabel(restriction.source)} · ${restrictionScopeLabel(restriction.scope)}`;
    if (reason) reason.textContent = restrictionReasonText(restriction);
    if (end) end.textContent = restrictionEndText(restriction);
    if (restriction.permanent) {
      clearRestrictionTimer();
      if (time) time.hidden = false;
      if (countdown) countdown.textContent = 'Permanente';
      const timeLabel = time?.querySelector('span');
      if (timeLabel) timeLabel.textContent = 'Duración';
      return;
    }

    if (time) time.hidden = false;
    const timeLabel = time?.querySelector('span');
    if (timeLabel) timeLabel.textContent = 'Disponible de nuevo en';
    const remaining = restrictionRemainingSeconds(restriction);
    if (countdown) countdown.textContent = formatRestrictionCountdown(remaining);
    scheduleRestrictionTimer(restriction);
  }

  function optionLabel(league) {
    const attempts = `${Number(league.attemptsLeft ?? 0)}/${Number(league.maxAttempts ?? 5)} tiros`;
    if (league.waiting === true) return `${league.name} · esperando participantes`;
    if (league.finished === true) return `${league.name} · finalizada`;
    if (Number(league.attemptsLeft ?? 0) <= 0) return `${league.name} · sin tiros`;
    return `${league.name} · ${attempts}`;
  }

  function validStoredSelection() {
    const stored = String(localStorage.getItem(selectionKey) || 'global');
    if (stored === 'global') return stored;
    const league = context.leagues.find((candidate) => `league:${candidate.publicId}` === stored);
    return league?.active === true ? stored : 'global';
  }

  function resolveSelection() {
    if (routeSelection) {
      const league = context.leagues.find((candidate) => candidate.publicId === routeSelection);
      if (league?.active === true) return `league:${league.publicId}`;
    }
    return validStoredSelection();
  }

  function renderSelector() {
    const section = document.querySelector('#competitionPickerSection');
    const select = document.querySelector('#competitionPicker');
    if (!section || !select) return;

    const globalOption = document.createElement('option');
    const globalState = globalAttemptState();
    globalOption.value = 'global';
    globalOption.textContent = `Global · ${globalState.attemptsLeft}/${globalState.maxAttempts} tiros`;
    globalOption.disabled = context.availability === 'occupied' || globalState.attemptsLeft <= 0;

    const leagueOptions = context.leagues.map((league) => {
      const option = document.createElement('option');
      option.value = `league:${league.publicId}`;
      option.textContent = optionLabel(league);
      option.disabled = league.active !== true || Number(league.attemptsLeft ?? 0) <= 0 || !league.competitionCode;
      return option;
    });

    select.replaceChildren(globalOption, ...leagueOptions);
    const candidate = resolveSelection();
    const candidateOption = [...select.options].find((option) => option.value === candidate && !option.disabled);
    selectedValue = candidateOption?.value || 'global';
    select.value = selectedValue;
    select.disabled = contextPending || context.availability === 'occupied' || ![...select.options].some((option) => !option.disabled);
    section.hidden = false;
    renderContext();
    renderRestriction();
  }

  function renderContext() {
    const competitionContext = document.querySelector('#competitionContext');
    const leagueNotice = document.querySelector('#leagueNotice');
    const scope = selectedScope();

    if (competitionContext) {
      competitionContext.hidden = scope.type !== 'league';
      const title = competitionContext.querySelector('[data-competition-title]');
      const copy = competitionContext.querySelector('[data-competition-copy]');
      const link = competitionContext.querySelector('a');
      if (title) title.textContent = scope.name;
      if (copy) copy.textContent = 'Este intento contará únicamente en esta liga pública y no alterará el ranking global.';
      if (link && scope.publicId) link.href = `./ligas/${encodeURIComponent(scope.publicId)}`;
    }

    if (leagueNotice) {
      leagueNotice.hidden = scope.type !== 'league';
      if (scope.type === 'league') {
        leagueNotice.replaceChildren();
        leagueNotice.append(`Compites en “${scope.name}”. Te quedan ${scope.attemptsLeft} de ${scope.maxAttempts} tiros. `);
        const link = document.createElement('a');
        link.href = `./ligas/${encodeURIComponent(scope.publicId)}`;
        link.textContent = 'Ver clasificación';
        leagueNotice.append(link);
      }
    }
  }

  function renderStatus() {
    renderRestriction();
    const status = document.querySelector('#nickStatus');
    if (!status) return;
    const nick = currentNick();

    if (nick.length < 2) {
      status.textContent = context.restriction?.active === true
        ? 'Tu acceso competitivo está restringido. Consulta el detalle antes de elegir un nick.'
        : 'Escribe tu nick para comprobar su disponibilidad y tus competiciones.';
      return;
    }
    if (contextPending || restrictionRefreshPending) {
      status.textContent = restrictionRefreshPending ? 'Comprobando si la restricción ya ha terminado…' : 'Comprobando nick y competiciones…';
      return;
    }
    if (restrictionRefreshFailed) {
      status.textContent = 'No se pudo confirmar que la restricción haya terminado. El acceso sigue bloqueado hasta conectar de nuevo con el servidor.';
      return;
    }
    if (context.availability === 'occupied') {
      status.textContent = 'Este nick ya está ocupado por otra cuenta. Importa su clave o elige otro antes de jugar.';
      return;
    }
    if (context.restriction?.active === true) {
      status.textContent = 'El juego competitivo está bloqueado para este acceso. La cuenta atrás y el motivo aparecen debajo.';
      return;
    }

    const scope = selectedScope();
    if (scope.waiting) {
      status.textContent = `“${scope.name}” todavía espera participantes y no admite intentos.`;
      return;
    }
    if (scope.finished) {
      status.textContent = `“${scope.name}” ya finalizó. Selecciona otra competición.`;
      return;
    }
    if (scope.attemptsLeft <= 0) {
      status.textContent = scope.type === 'global'
        ? `Has agotado los ${scope.maxAttempts} intentos globales. Comparte tu invitación para conseguir otro.`
        : `Has agotado los ${scope.maxAttempts} intentos de “${scope.name}”. Selecciona otra competición.`;
      return;
    }

    status.textContent = scope.type === 'global'
      ? `${scope.attemptsLeft} de ${scope.maxAttempts} intentos globales disponibles.`
      : `${scope.attemptsLeft} de ${scope.maxAttempts} intentos disponibles en “${scope.name}”.`;
  }

  async function requestContext(action, nick = '') {
    if (!playerContextUrl || playerContextUrl === gameApiUrl) {
      throw new Error('No se pudo preparar la comprobación del jugador.');
    }
    const headers = { 'content-type': 'application/json', 'x-device-id': deviceId };
    const accountToken = localAccountToken();
    if (accountToken) headers['x-account-token'] = accountToken;
    const body = nick ? { action, nick } : { action };
    const response = await fetch(playerContextUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'No se pudo comprobar el jugador.');
    return payload;
  }

  function requestPlayerContext(nick) {
    return requestContext('player-context', nick);
  }

  function requestAccountContext() {
    return requestContext('account-context');
  }

  async function syncAccountContext(sequence, source) {
    selectedValue = 'global';
    contextPending = true;
    renderSelector();
    renderStatus();
    notify(`${source}:pending`);

    try {
      const response = await requestAccountContext();
      if (sequence !== requestSequence || currentNick().length >= 2) return context;
      restrictionRefreshFailed = false;
      context = emptyContext(response.dailyAttemptPolicy ?? null, response.restriction ?? null);
      return context;
    } catch {
      if (sequence !== requestSequence || currentNick().length >= 2) return context;
      if (source === 'restriction-expired') restrictionRefreshFailed = true;
      notify(`${source}:error`);
      return context;
    } finally {
      if (sequence === requestSequence && currentNick().length < 2) {
        contextPending = false;
        renderSelector();
        renderStatus();
        notify(`${source}:settled`);
      }
    }
  }

  async function syncPlayerContext(source = 'manual') {
    const nick = currentNick();
    const sequence = ++requestSequence;
    window.clearTimeout(debounceTimer);

    if (nick.length < 2) return syncAccountContext(sequence, source);

    contextPending = true;
    renderStatus();
    notify(`${source}:pending`);

    try {
      const response = await requestPlayerContext(nick);
      if (sequence !== requestSequence || nick !== currentNick()) return context;
      restrictionRefreshFailed = false;
      context = Object.freeze({
        availability: String(response.availability || 'unknown'),
        profile: response.profile?.nick ? response.profile : null,
        leagues: Object.freeze(Array.isArray(response.leagues) ? response.leagues : []),
        accountPolicy: response.dailyAttemptPolicy ?? null,
        restriction: response.restriction?.active === true ? Object.freeze({ ...response.restriction }) : null,
      });
      renderSelector();
      renderStatus();
      notify(source);
      return context;
    } catch (error) {
      if (sequence !== requestSequence || nick !== currentNick()) return context;
      if (source === 'restriction-expired') restrictionRefreshFailed = true;
      const status = document.querySelector('#nickStatus');
      if (status && source !== 'restriction-expired') {
        status.textContent = error instanceof Error ? error.message : 'No se pudo comprobar el jugador.';
      }
      notify(`${source}:error`);
      return context;
    } finally {
      if (sequence === requestSequence) {
        contextPending = false;
        renderSelector();
        renderStatus();
        notify(`${source}:settled`);
      }
    }
  }

  function schedulePlayerContext(source = 'input') {
    window.clearTimeout(debounceTimer);
    requestSequence += 1;
    restrictionRefreshFailed = false;
    contextPending = true;
    renderStatus();
    notify(`${source}:debounce`);
    debounceTimer = window.setTimeout(() => {
      syncPlayerContext(source).catch(() => {});
    }, 350);
  }

  function leagueAchievementText(payload) {
    const league = selectedLeague();
    const rank = Number(payload.achievement?.leagueRank || 0);
    if (rank === 1) return `LÍDER DE LA LIGA · Puesto #1 en ${league?.name || 'tu liga'}`;
    if (rank > 0) return `Puesto #${rank} en ${league?.name || 'tu liga'}`;
    return `Marca registrada en ${league?.name || 'tu liga'}`;
  }

  function renderLeagueResult(payload) {
    if (payload?.competition?.type !== 'league') {
      if (payload?.profile?.nick) {
        context = Object.freeze({ ...context, profile: payload.profile });
        renderSelector();
        renderStatus();
        notify('finish:global');
      }
      return;
    }

    lastLeagueResult = payload;
    const league = selectedLeague();
    if (league) {
      const leagues = context.leagues.map((candidate) => candidate.publicId === league.publicId
        ? {
          ...candidate,
          attemptsLeft: Number(payload.attemptsLeft ?? 0),
          attemptsUsed: Number(payload.maxAttempts ?? 5) - Number(payload.attemptsLeft ?? 0),
          maxAttempts: Number(payload.maxAttempts ?? 5),
        }
        : candidate);
      context = Object.freeze({ ...context, leagues: Object.freeze(leagues) });
    }

    const verification = document.querySelector('#verificationStatus');
    if (verification) {
      verification.textContent = payload.attempt?.verified
        ? `✓ Intento válido para “${league?.name || 'la liga'}”. No altera el ranking global.`
        : 'Intento excluido de la liga por las comprobaciones anti-trampas.';
    }

    const attempts = document.querySelector('#attemptsLeft');
    if (attempts) {
      attempts.textContent = Number(payload.attemptsLeft) > 0
        ? `Te quedan ${payload.attemptsLeft} de ${payload.maxAttempts} intentos en “${league?.name || 'la liga'}”.`
        : `Has completado los ${payload.maxAttempts} intentos de “${league?.name || 'la liga'}”.`;
    }

    const retry = document.querySelector('#retryButton');
    if (retry) retry.hidden = Number(payload.attemptsLeft) === 0;

    const banner = document.querySelector('#achievementBanner');
    if (banner) {
      banner.className = 'achievement-banner league-achievement';
      banner.hidden = false;
      banner.textContent = leagueAchievementText(payload);
    }

    renderSelector();
    renderStatus();
    notify('finish:league');
  }

  function leagueShareText() {
    const league = selectedLeague();
    const difference = lastLeagueResult?.attempt?.differenceMs;
    const result = Number.isFinite(Number(difference)) ? ` y me he quedado a ${difference} ms del 10.600` : '';
    return `Estoy compitiendo en “${league?.name || 'una liga'}” de Minuto 106${result}. ¿Me superas?`;
  }

  async function shareLeague() {
    const league = selectedLeague();
    if (!league?.publicId) return;
    await window.Minuto106UI?.share({
      title: `${league.name} · Minuto 106`,
      text: leagueShareText(),
      url: leaguePublicUrl(league.publicId),
    });
  }

  function installLeagueShareOverrides() {
    for (const selector of ['#shareButton', '#copyReferralButton']) {
      document.querySelector(selector)?.addEventListener('click', (event) => {
        if (!event.isTrusted || selectedScope().type !== 'league') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        shareLeague().catch((error) => window.Minuto106UI?.error({
          title: 'No se pudo compartir',
          message: error instanceof Error ? error.message : 'No se pudo compartir la liga.',
        }));
      }, true);
    }
  }

  function initialize() {
    ensureRestrictionUi();
    installLeagueShareOverrides();
    const nickInput = document.querySelector('#nick');
    nickInput?.addEventListener('input', () => schedulePlayerContext('input'));
    document.querySelector('#competitionPicker')?.addEventListener('change', (event) => {
      const value = String(event.target.value || 'global');
      selectedValue = value;
      localStorage.setItem(selectionKey, value);
      renderContext();
      renderStatus();
      notify('selection');
    });
    document.addEventListener('minuto106:account-updated', () => {
      restrictionRefreshFailed = false;
      syncPlayerContext('account-updated').catch(() => {});
    });
    syncPlayerContext('initial').catch(() => {});
  }

  window.Minuto106Competition = Object.freeze({
    get activeLeagueCode() { return selectedScope().competitionCode; },
    get activeLeague() { return selectedLeague(); },
    get selected() { return selectedScope(); },
    get context() { return context; },
    get canStart() { return canStart(); },
    handleResult: renderLeagueResult,
    refresh: syncPlayerContext,
    scheduleRefresh: schedulePlayerContext,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();