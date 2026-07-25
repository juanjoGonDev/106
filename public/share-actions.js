(() => {
  if (window.__MINUTO106_SHARE_ACTIONS__) return;
  window.__MINUTO106_SHARE_ACTIONS__ = true;

  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
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

  function profileCanonicalUrl(profile) {
    return window.Minuto106PlayerUI?.playerUrl(profile.nick)
      || new URL(`./ranking.html?nick=${encodeURIComponent(profile.nick)}`, location.href).toString();
  }

  function referralShareUrl(profile) {
    const url = new URL('./', location.href);
    url.searchParams.set('ref', profile.referralCode);
    return url.toString();
  }

  function leagueCanonicalUrl(publicId) {
    return new URL(`./ligas/${encodeURIComponent(publicId)}`, location.href).toString();
  }

  function duelCanonicalUrl(code) {
    const url = new URL('./', location.href);
    url.searchParams.set('duel', code);
    return url.toString();
  }

  function resultShareUrl(attempt) {
    const url = new URL('./', location.href);
    url.searchParams.set('sharedResult', attempt.id);
    return url.toString();
  }

  function cachedOwnedProfile() {
    const context = window.Minuto106Competition?.context;
    return context?.availability === 'owned' && context.profile?.nick ? context.profile : null;
  }

  async function resolveProfile() {
    const cached = cachedOwnedProfile();
    if (cached) return cached;
    const nick = currentNick();
    if (nick.length < 2) throw new Error('Escribe primero tu nick.');
    return request('profile', { nick });
  }

  async function shareProfile({ referral = false } = {}) {
    const profile = await resolveProfile();
    const trophies = Number(profile.trophies?.total || 0);
    const achievements = Number(profile.achievements?.total || 0);
    const text = referral
      ? `⚽ ${profile.nick} te invita a Minuto 106. Completa tus 5 intentos válidos y ambos ganaréis un intento extra.`
      : `⚽ ${profile.nick} tiene ${trophies} trofeos y ${achievements} logros en Minuto 106. ¿Puedes superarle?`;
    await window.Minuto106UI.share({
      title: referral ? `${profile.nick} te invita · Minuto 106` : `${profile.nick} · Minuto 106`,
      text,
      url: referral ? referralShareUrl(profile) : profileCanonicalUrl(profile),
    });
  }

  function selectedLeague() {
    const selected = window.Minuto106Competition?.selected;
    if (selected?.type !== 'league' || !/^[A-Z0-9]{6}$/.test(String(selected.publicId || ''))) return null;
    return selected;
  }

  async function shareSelectedLeague() {
    const league = selectedLeague();
    if (!league) throw new Error('Selecciona primero una liga válida.');
    const suffix = Number.isFinite(Number(latestAttempt?.differenceMs))
      ? ` Mi última marca se quedó a ${Number(latestAttempt.differenceMs)} ms del 10.600.`
      : '';
    await window.Minuto106UI.share({
      title: `${league.name} · Minuto 106`,
      text: `⚽ Estoy compitiendo en “${league.name}”. Consulta la clasificación pública y trata de superarme.${suffix}`,
      url: leagueCanonicalUrl(league.publicId),
    });
  }

  async function shareResult() {
    if (!latestAttempt?.id) {
      await shareProfile();
      return;
    }
    const elapsedSeconds = (Number(latestAttempt.elapsedMs) / 1000).toFixed(3);
    const competition = latestAttempt.competitionType === 'league' && latestAttempt.leagueName
      ? ` en la liga “${latestAttempt.leagueName}”`
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
      url: duelCanonicalUrl(duel.code),
    });
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

  document.addEventListener('click', (event) => {
    if (event.isTrusted !== true) return;
    const target = event.target.closest('#shareButton, #copyReferralButton, #createDuelButton, #quickDuelButton');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (target.matches('#createDuelButton, #quickDuelButton')) {
      run(createAndShareDuel);
      return;
    }
    if (selectedLeague()) {
      run(shareSelectedLeague);
      return;
    }
    if (target.id === 'shareButton') {
      run(shareResult);
      return;
    }
    run(() => shareProfile({ referral: true }));
  }, true);
})();
