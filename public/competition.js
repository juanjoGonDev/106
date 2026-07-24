(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const gameApiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const playerContextUrl = gameApiUrl.replace(/\/game-api$/, '/player-context');
  const deviceKey = 'minuto106:device-id';
  const selectionKey = 'minuto106:competition-v1';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const routeSelection = String(
    new URLSearchParams(location.search).get('competition')
    || new URLSearchParams(location.search).get('league')
    || '',
  ).trim().toUpperCase();

  let context = Object.freeze({ availability: 'unknown', profile: null, leagues: [] });
  let selectedValue = 'global';
  let contextPending = false;
  let debounceTimer = 0;
  let requestSequence = 0;
  let lastLeagueResult = null;

  localStorage.setItem(deviceKey, deviceId);

  function currentNick() {
    return String(document.querySelector('#nick')?.value || localStorage.getItem('minuto106:nick') || '').trim();
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

    const profile = context.profile;
    return Object.freeze({
      type: 'global',
      publicId: '',
      competitionCode: '',
      name: 'Ranking global',
      attemptsLeft: Number(profile?.attemptsLeft ?? 5),
      maxAttempts: Number(profile?.maxAttempts ?? 5),
      available: context.availability !== 'occupied' && Number(profile?.attemptsLeft ?? 5) > 0,
      waiting: false,
      finished: false,
    });
  }

  function canStart() {
    const scope = selectedScope();
    return !contextPending
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
        selected: selectedScope(),
        canStart: canStart(),
        pending: contextPending,
        source,
      }),
    }));
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
    globalOption.value = 'global';
    const globalLeft = Number(context.profile?.attemptsLeft ?? 5);
    const globalMax = Number(context.profile?.maxAttempts ?? 5);
    globalOption.textContent = `Global · ${globalLeft}/${globalMax} tiros`;
    globalOption.disabled = context.availability === 'occupied' || globalLeft <= 0;

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
    selectedValue = candidateOption?.value || [...select.options].find((option) => !option.disabled)?.value || 'global';
    select.value = selectedValue;
    select.disabled = contextPending || context.availability === 'occupied' || ![...select.options].some((option) => !option.disabled);
    section.hidden = false;
    renderContext();
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
    const status = document.querySelector('#nickStatus');
    if (!status) return;
    const nick = currentNick();

    if (nick.length < 2) {
      status.textContent = 'Escribe tu nick para comprobar su disponibilidad y tus competiciones.';
      return;
    }
    if (contextPending) {
      status.textContent = 'Comprobando nick y competiciones…';
      return;
    }
    if (context.availability === 'occupied') {
      status.textContent = 'Este nick ya está ocupado por otra cuenta. Importa su clave o elige otro antes de jugar.';
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

  async function requestPlayerContext(nick) {
    if (!playerContextUrl || playerContextUrl === gameApiUrl) {
      throw new Error('No se pudo preparar la comprobación del jugador.');
    }
    const response = await fetch(playerContextUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'player-context', nick }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo comprobar el jugador.');
    return body;
  }

  async function syncPlayerContext(source = 'manual') {
    const nick = currentNick();
    const sequence = ++requestSequence;
    window.clearTimeout(debounceTimer);

    if (nick.length < 2) {
      contextPending = false;
      context = Object.freeze({ availability: 'unknown', profile: null, leagues: [] });
      selectedValue = 'global';
      renderSelector();
      renderStatus();
      notify(source);
      return context;
    }

    contextPending = true;
    renderStatus();
    notify(`${source}:pending`);

    try {
      const response = await requestPlayerContext(nick);
      if (sequence !== requestSequence || nick !== currentNick()) return context;
      context = Object.freeze({
        availability: String(response.availability || 'unknown'),
        profile: response.profile?.nick ? response.profile : null,
        leagues: Object.freeze(Array.isArray(response.leagues) ? response.leagues : []),
      });
      renderSelector();
      renderStatus();
      notify(source);
      return context;
    } catch (error) {
      if (sequence !== requestSequence || nick !== currentNick()) return context;
      context = Object.freeze({ availability: 'unknown', profile: null, leagues: [] });
      const status = document.querySelector('#nickStatus');
      if (status) status.textContent = error instanceof Error ? error.message : 'No se pudo comprobar el jugador.';
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
