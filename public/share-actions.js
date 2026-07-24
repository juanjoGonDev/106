(() => {
  if (window.__MINUTO106_SHARE_ACTIONS__) return;
  window.__MINUTO106_SHARE_ACTIONS__ = true;

  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const activeLeagueCode = String(new URLSearchParams(location.search).get('league') || '').trim().toUpperCase();
  let actionPending = false;
  let latestAttempt = window.__MINUTO106_LATEST_ATTEMPT__?.id
    ? window.__MINUTO106_LATEST_ATTEMPT__
    : null;

  localStorage.setItem(deviceKey, deviceId);

  function currentNick(selector = '#nick') {
    return String(document.querySelector(selector)?.value || localStorage.getItem('minuto106:nick') || '').trim();
  }

  function apiUrl() {
    const config = window.__MINUTO106_CONFIG__ ?? {};
    return String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  }

  async function request(action, payload = {}) {
    const url = apiUrl();
    if (!url || url.includes('YOUR_PROJECT_REF')) throw new Error('Supabase aún no está configurado.');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo preparar el contenido para compartir.');
    return body;
  }

  function normalizedRevision(value) {
    const revision = Number(value);
    return Number.isFinite(revision) && revision >= 0 ? Math.trunc(revision) : 0;
  }

  function socialShareUrl(kind, id, revision = 0, fallback = location.href) {
    const configuredApiUrl = apiUrl();
    if (!configuredApiUrl || configuredApiUrl.includes('YOUR_PROJECT_REF')) return fallback;
    const url = new URL(configuredApiUrl);
    url.pathname = url.pathname.replace(/\/[^/]+\/?$/, '/social-share');
    url.pathname += `/${kind}/${encodeURIComponent(id)}`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('v', String(normalizedRevision(revision)));
    return url.toString();
  }

  function profileCanonicalUrl(profile) {
    return window.Minuto106PlayerUI?.playerUrl(profile.nick)
      || new URL(`./ranking.html?nick=${encodeURIComponent(profile.nick)}`, location.href).toString();
  }

  function profileShareUrl(profile) {
    return window.Minuto106PlayerUI?.shareUrl(apiUrl(), profile.nick, 'overview', profile.profileRevision)
      || profileCanonicalUrl(profile);
  }

  function referralShareUrl(profile) {
    const fallback = new URL('./', location.href);
    fallback.searchParams.set('ref', profile.referralCode);
    return socialShareUrl('referral', profile.referralCode, profile.profileRevision, fallback.toString());
  }

  function leagueCanonicalUrl(code) {
    return new URL(`./ligas.html?league=${encodeURIComponent(code)}`, location.href).toString();
  }

  function leagueShareUrl(league) {
    return socialShareUrl('league', league.code, league.revision, leagueCanonicalUrl(league.code));
  }

  function duelCanonicalUrl(code) {
    const url = new URL('./', location.href);
    url.searchParams.set('duel', code);
    return url.toString();
  }

  function duelShareUrl(duel) {
    const revision = Date.parse(String(duel.expiresAt || '')) - (3 * 24 * 60 * 60 * 1000);
    return socialShareUrl('duel', duel.code, revision, duelCanonicalUrl(duel.code));
  }

  function resultShareUrl(attempt) {
    const fallback = new URL('./', location.href);
    fallback.searchParams.set('sharedResult', attempt.id);
    return socialShareUrl('result', attempt.id, Date.parse(String(attempt.createdAt || '')), fallback.toString());
  }

  async function shareProfile({ referral = false } = {}) {
    const nick = currentNick();
    if (nick.length < 2) throw new Error('Escribe primero tu nick.');
    const profile = await request('profile', { nick });
    const trophies = Number(profile.trophies?.total || 0);
    const achievements = Number(profile.achievements?.total || 0);
    const text = referral
      ? `⚽ ${profile.nick} te invita a Minuto 106. Completa tus 5 intentos válidos y ambos ganaréis un intento extra.`
      : `⚽ ${profile.nick} tiene ${trophies} trofeos y ${achievements} logros en Minuto 106. ¿Puedes superarle?`;
    await window.Minuto106UI.share({
      title: referral ? `${profile.nick} te invita · Minuto 106` : `${profile.nick} · Minuto 106`,
      text,
      url: referral ? referralShareUrl(profile) : profileShareUrl(profile),
    });
  }

  async function shareResult() {
    if (!latestAttempt?.id) {
      await shareProfile();
      return;
    }
    const elapsedSeconds = (Number(latestAttempt.elapsedMs) / 1000).toFixed(3);
    const competition = latestAttempt.competitionType === 'league' && latestAttempt.leagueName
      ? ` en la miniliga “${latestAttempt.leagueName}”`
      : '';
    await window.Minuto106UI.share({
      title: `${latestAttempt.nick}: ${elapsedSeconds} s · Minuto 106`,
      text: `⚽ He marcado ${elapsedSeconds} s${competition} y me he quedado a ${latestAttempt.differenceMs} ms del 10.600. ¿Puedes acercarte más?`,
      url: resultShareUrl(latestAttempt),
    });
  }

  async function createAndShareDuel() {
    const nick = currentNick();
    if (nick.length < 2) throw new Error('Escribe primero tu nick y completa al menos un intento válido.');
    const duel = await request('create-duel', { nick });
    const targetSeconds = (Number(duel.targetElapsedMs) / 1000).toFixed(3);
    await window.Minuto106UI.share({
      title: `${nick} te reta · Minuto 106`,
      text: `⚽ Te reto a superar mi tiempo verificado de ${targetSeconds} s (±${duel.targetDifferenceMs} ms del 10.600). Si me superas, ganas 3 intentos extra.`,
      url: duelShareUrl(duel),
    });
  }

  function selectedLeague() {
    const code = activeLeagueCode
      || document.querySelector('#leagueLookupCode')?.value?.trim().toUpperCase()
      || document.querySelector('[data-league-card].active')?.dataset.leagueCard
      || '';
    const name = document.querySelector('#leagueLookupTitle')?.textContent?.split(' · ')[0]
      || document.querySelector(`[data-league-card="${CSS.escape(code)}"] h3`)?.textContent
      || 'Miniliga';
    return { code, name };
  }

  async function shareLeague(leagueReference = selectedLeague()) {
    if (!/^[A-Z0-9]{6}$/.test(leagueReference.code)) throw new Error('Selecciona primero una miniliga válida.');
    const league = await request('league', { code: leagueReference.code });
    const name = String(league.name || leagueReference.name || 'Miniliga');
    const waiting = league.waiting === true;
    const text = waiting
      ? `⚽ Únete a mi miniliga “${name}” de Minuto 106. Empezará cuando haya 3 cuentas y 3 dispositivos únicos. Código ${league.code}.`
      : `⚽ Únete a mi miniliga “${name}” de Minuto 106. Tienes 5 intentos propios y no afectan al ranking global. Código ${league.code}.`;
    await window.Minuto106UI.share({
      title: `Miniliga ${name}`,
      text,
      url: leagueShareUrl(league),
    });
  }

  async function createAndShareLeague(form) {
    const nick = currentNick('#leagueNick');
    const nameInput = form.querySelector('#newLeagueName');
    const name = String(nameInput?.value || '').trim();
    if (nick.length < 2) throw new Error('Escribe el nick con el que crearás la miniliga.');
    if (name.length < 3) throw new Error('El nombre debe tener al menos 3 caracteres.');
    localStorage.setItem('minuto106:nick', nick);
    const league = await request('create-league', { nick, name });
    if (nameInput) nameInput.value = '';
    await shareLeague(league);
    location.assign(`./ligas.html?league=${encodeURIComponent(league.code)}`);
  }

  function showError(error) {
    return window.Minuto106UI?.error({
      title: 'No se pudo compartir',
      message: error instanceof Error ? error.message : 'No se pudo abrir el menú para compartir.',
    });
  }

  async function run(action) {
    if (actionPending) return;
    actionPending = true;
    try {
      await action();
    } catch (error) {
      await showError(error);
    } finally {
      actionPending = false;
    }
  }

  document.addEventListener('minuto106:attempt-finished', (event) => {
    latestAttempt = event.detail?.attempt?.id ? event.detail.attempt : null;
    window.__MINUTO106_LATEST_ATTEMPT__ = latestAttempt;
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('#createLeagueForm');
    if (!form || event.isTrusted !== true) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    run(() => createAndShareLeague(form));
  }, true);

  document.addEventListener('click', (event) => {
    if (event.isTrusted !== true) return;
    const target = event.target.closest('#shareButton, #copyReferralButton, #createDuelButton, #quickDuelButton, #shareLeagueButton, [data-share-league]');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (target.matches('#createDuelButton, #quickDuelButton')) {
      run(createAndShareDuel);
      return;
    }
    if (target.id === 'shareButton') {
      run(shareResult);
      return;
    }
    if (target.matches('#shareLeagueButton, [data-share-league]')) {
      const code = target.dataset.shareLeague;
      const card = target.closest('[data-league-card]');
      run(() => shareLeague(code ? {
        code,
        name: card?.querySelector('h3')?.textContent || 'Miniliga',
      } : selectedLeague()));
      return;
    }
    if (target.id === 'copyReferralButton' && activeLeagueCode) {
      run(() => shareLeague(selectedLeague()));
      return;
    }
    run(() => shareProfile({ referral: target.id === 'copyReferralButton' }));
  }, true);
})();
