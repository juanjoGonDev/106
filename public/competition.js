(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const requestedCode = String(new URLSearchParams(location.search).get('league') || '').trim().toUpperCase();
  const activeLeagueCode = /^[A-Z0-9]{6}$/.test(requestedCode) ? requestedCode : '';
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const originalFetch = window.fetch.bind(window);
  let activeLeague = null;
  let leagueStatus = null;
  let lastLeagueResult = null;
  let statusDebounce;

  localStorage.setItem(deviceKey, deviceId);

  function currentNick() {
    return String(document.querySelector('#nick')?.value || localStorage.getItem('minuto106:nick') || '').trim();
  }

  async function request(action, payload = {}) {
    if (!apiUrl) throw new Error('Supabase aún no está configurado.');
    const response = await originalFetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo cargar la competición.');
    return body;
  }

  function setCompactValue(selector, value) {
    const element = document.querySelector(selector);
    if (!element) return;
    const formatter = window.Minuto106Format;
    element.textContent = formatter?.compactNumber(value) ?? String(value ?? 0);
    element.title = formatter?.fullNumber(value) ?? String(value ?? 0);
  }

  function applyCompactStats(stats) {
    if (!stats?.teams) return;
    const spain = stats.teams.find((team) => team.team === 'spain') ?? { score: 0 };
    const argentina = stats.teams.find((team) => team.team === 'argentina') ?? { score: 0 };
    setCompactValue('#spainScore', spain.score);
    setCompactValue('#argentinaScore', argentina.score);
    setCompactValue('#globalPlayers', stats.totalPlayers);
    setCompactValue('#verifiedAttempts', stats.verifiedAttempts);
    setCompactValue('#perfectAttempts', stats.perfectAttempts);
  }

  function parseRequestBody(init) {
    if (typeof init?.body !== 'string') return null;
    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }

  function scheduleResponseEnhancement(action, response) {
    if (!['stats', 'finish'].includes(action)) return;
    response.clone().json().then((payload) => {
      window.setTimeout(() => {
        if (action === 'stats') applyCompactStats(payload);
        if (action === 'finish') {
          applyCompactStats(payload.stats);
          renderLeagueResult(payload);
        }
      }, 0);
    }).catch(() => {});
  }

  window.fetch = async (input, init = {}) => {
    const body = parseRequestBody(init);
    let nextInit = init;
    if (body?.action === 'start' && activeLeagueCode && !body.leagueCode) {
      nextInit = {
        ...init,
        body: JSON.stringify({ ...body, leagueCode: activeLeagueCode }),
      };
    }

    const response = await originalFetch(input, nextInit);
    scheduleResponseEnhancement(String(body?.action || ''), response);
    return response;
  };

  function contextLabel() {
    return activeLeague?.name ? `“${activeLeague.name}”` : activeLeagueCode;
  }

  function renderContext() {
    if (!activeLeagueCode) return;
    const context = document.querySelector('#competitionContext');
    if (context) {
      context.hidden = false;
      const title = context.querySelector('[data-competition-title]');
      const copy = context.querySelector('[data-competition-copy]');
      const link = context.querySelector('a');
      if (title) title.textContent = activeLeague?.name ? `${activeLeague.name} · ${activeLeagueCode}` : `Miniliga ${activeLeagueCode}`;
      if (copy) copy.textContent = 'Estás jugando una competición privada. Estas marcas solo cuentan aquí y nunca alteran el ranking global.';
      if (link) link.href = `./ligas.html?league=${encodeURIComponent(activeLeagueCode)}`;
    }

    const notice = document.querySelector('#leagueNotice');
    if (notice) {
      notice.hidden = false;
      notice.replaceChildren();
      notice.append(`Compites en ${contextLabel()}. Tus tiempos se guardarán únicamente en esta miniliga. `);
      const link = document.createElement('a');
      link.href = `./ligas.html?league=${encodeURIComponent(activeLeagueCode)}`;
      link.textContent = 'Ver clasificación y membresía';
      notice.append(link);
    }
  }

  function renderMembershipError(message) {
    const status = document.querySelector('#nickStatus');
    if (!status) return;
    status.replaceChildren();
    status.append(`${message} `);
    const link = document.createElement('a');
    link.href = `./ligas.html?league=${encodeURIComponent(activeLeagueCode)}`;
    link.textContent = 'Únete desde Miniligas';
    status.append(link);
  }

  function renderLeagueStatus() {
    if (!activeLeagueCode || !leagueStatus) return;
    const status = document.querySelector('#nickStatus');
    if (status) {
      status.textContent = leagueStatus.attemptsLeft > 0
        ? `${leagueStatus.attemptsLeft} de ${leagueStatus.maxAttempts} intentos disponibles en ${contextLabel()}. No afectan al global.`
        : `Has completado los ${leagueStatus.maxAttempts} intentos de ${contextLabel()}.`;
    }
    renderContext();
  }

  async function syncLeagueStatus() {
    if (!activeLeagueCode) return;
    const nick = currentNick();
    if (nick.length < 2) {
      const status = document.querySelector('#nickStatus');
      if (status) status.textContent = 'Escribe tu nick para comprobar tus 5 intentos de esta miniliga.';
      return;
    }

    try {
      leagueStatus = await request('league-status', { nick, code: activeLeagueCode });
      renderLeagueStatus();
    } catch (error) {
      leagueStatus = null;
      renderMembershipError(error instanceof Error ? error.message : 'No perteneces a esta miniliga.');
    }
  }

  function renderLeagueResult(payload) {
    if (payload?.competition?.type !== 'league') return;
    lastLeagueResult = payload;
    leagueStatus = {
      ...(leagueStatus || {}),
      attemptsLeft: Number(payload.attemptsLeft ?? 0),
      maxAttempts: Number(payload.maxAttempts ?? 5),
    };

    const verification = document.querySelector('#verificationStatus');
    if (verification) {
      verification.textContent = payload.attempt?.verified
        ? `✓ Intento válido para ${contextLabel()}. No suma puntos ni posiciones en el ranking global.`
        : 'Intento excluido de la miniliga por las comprobaciones anti-trampas.';
    }

    const attempts = document.querySelector('#attemptsLeft');
    if (attempts) {
      attempts.textContent = payload.attemptsLeft > 0
        ? `Te quedan ${payload.attemptsLeft} de ${payload.maxAttempts} intentos en ${contextLabel()}.`
        : `Has completado los ${payload.maxAttempts} intentos de ${contextLabel()}.`;
    }

    const retry = document.querySelector('#retryButton');
    if (retry) retry.hidden = Number(payload.attemptsLeft) === 0;

    const banner = document.querySelector('#achievementBanner');
    if (banner) {
      const rank = Number(payload.achievement?.leagueRank || 0);
      banner.className = 'achievement-banner league-achievement';
      banner.hidden = false;
      banner.textContent = rank === 1
        ? `LÍDER DE LA MINILIGA · Puesto #1 en ${contextLabel()}`
        : rank > 0
          ? `Puesto #${rank} en ${contextLabel()}`
          : `Marca registrada en ${contextLabel()}`;
    }

    renderLeagueStatus();
  }

  function leagueShareUrl() {
    return new URL(`./ligas.html?league=${encodeURIComponent(activeLeagueCode)}`, location.href).toString();
  }

  function leagueShareText() {
    const difference = lastLeagueResult?.attempt?.differenceMs;
    const result = Number.isFinite(Number(difference)) ? ` y me he quedado a ${difference} ms del 10.600` : '';
    return `⚽ Estoy compitiendo en la miniliga ${contextLabel()} de Minuto 106${result}. ¿Me superas?`;
  }

  async function shareLeague() {
    const text = leagueShareText();
    const url = leagueShareUrl();
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Minuto 106', text, url });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        throw error;
      }
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    await window.Minuto106UI?.success({ title: 'Enlace copiado', message: 'La invitación a la miniliga está lista para compartir.' });
  }

  function installLeagueShareOverrides() {
    if (!activeLeagueCode) return;
    for (const selector of ['#shareButton', '#copyReferralButton']) {
      document.querySelector(selector)?.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        shareLeague().catch((error) => window.Minuto106UI?.error({
          title: 'No se pudo compartir',
          message: error instanceof Error ? error.message : 'No se pudo copiar la invitación.',
        }));
      }, true);
    }
  }

  async function initializeLeagueContext() {
    if (!activeLeagueCode) return;
    try {
      activeLeague = await request('league', { code: activeLeagueCode });
      if (!activeLeague?.code) throw new Error('La miniliga no existe.');
      renderContext();
      await syncLeagueStatus();
    } catch (error) {
      renderMembershipError(error instanceof Error ? error.message : 'No se pudo cargar la miniliga.');
    }
  }

  function initialize() {
    installLeagueShareOverrides();
    const nickInput = document.querySelector('#nick');
    nickInput?.addEventListener('input', () => {
      window.clearTimeout(statusDebounce);
      statusDebounce = window.setTimeout(syncLeagueStatus, 450);
    });
    initializeLeagueContext().catch(() => {});
  }

  window.Minuto106Competition = Object.freeze({
    get activeLeagueCode() { return activeLeagueCode; },
    get activeLeague() { return activeLeague; },
    refresh: syncLeagueStatus,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
