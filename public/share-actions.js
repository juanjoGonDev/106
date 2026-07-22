(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const activeLeagueCode = String(new URLSearchParams(location.search).get('league') || '').trim().toUpperCase();
  let actionPending = false;

  localStorage.setItem(deviceKey, deviceId);

  function currentNick(selector = '#nick') {
    return String(document.querySelector(selector)?.value || localStorage.getItem('minuto106:nick') || '').trim();
  }

  async function request(action, payload = {}) {
    if (!apiUrl || apiUrl.includes('YOUR_PROJECT_REF')) throw new Error('Supabase aún no está configurado.');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo preparar el contenido para compartir.');
    return body;
  }

  function profileUrl(profile, referral = false) {
    const url = new URL(referral ? './' : './ranking.html', location.href);
    if (referral && profile?.referralCode) url.searchParams.set('ref', profile.referralCode);
    if (!referral && profile?.nick) url.searchParams.set('nick', profile.nick);
    return url.toString();
  }

  function leagueUrl(code) {
    return new URL(`./ligas.html?league=${encodeURIComponent(code)}`, location.href).toString();
  }

  async function shareProfile({ referral = false } = {}) {
    const nick = currentNick();
    if (nick.length < 2) throw new Error('Escribe primero tu nick.');
    const profile = await request('profile', { nick });
    const history = Array.isArray(profile.history) ? profile.history : [];
    const latest = history[0];
    const trophies = Number(profile.trophies?.total || 0);
    const achievements = Number(profile.achievements?.total || 0);
    const text = referral
      ? `⚽ Te reto en Minuto 106. Completa tus 5 intentos válidos y ambos ganaremos un intento extra. Mi palmarés: ${trophies} trofeos y ${achievements} logros.`
      : `⚽ Mi marca en Minuto 106 es ${latest ? `±${latest.differenceMs} ms` : 'un reto pendiente'}. Tengo ${trophies} trofeos y ${achievements} logros. ¿Me superas?`;
    await window.Minuto106UI.share({
      title: `${profile.nick} · Minuto 106`,
      text,
      url: profileUrl(profile, referral),
    });
  }

  async function createAndShareDuel() {
    const nick = currentNick();
    if (nick.length < 2) throw new Error('Escribe primero tu nick y completa al menos un intento válido.');
    const duel = await request('create-duel', { nick });
    const url = new URL('./', location.href);
    url.searchParams.set('duel', duel.code);
    await window.Minuto106UI.share({
      title: 'Reto directo · Minuto 106',
      text: `Te reto en Minuto 106. Mi marca objetivo está a ${duel.targetDifferenceMs} ms del tiempo perfecto. Si me superas, ganas 3 intentos extra.`,
      url: url.toString(),
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

  async function shareLeague(league = selectedLeague()) {
    if (!/^[A-Z0-9]{6}$/.test(league.code)) throw new Error('Selecciona primero una miniliga válida.');
    await window.Minuto106UI.share({
      title: `Miniliga ${league.name}`,
      text: `⚽ Únete a mi miniliga “${league.name}” de Minuto 106. Tienes 5 intentos propios y no afectan al ranking global. Código ${league.code}.`,
      url: leagueUrl(league.code),
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
    if (target.matches('#shareLeagueButton, [data-share-league]') || activeLeagueCode) {
      const code = target.dataset.shareLeague;
      const card = target.closest('[data-league-card]');
      run(() => shareLeague(code ? {
        code,
        name: card?.querySelector('h3')?.textContent || 'Miniliga',
      } : selectedLeague()));
      return;
    }
    run(() => shareProfile({ referral: target.id === 'copyReferralButton' }));
  }, true);
})();
