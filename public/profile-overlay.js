(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const overlay = document.querySelector('#profileDialog');
  const content = document.querySelector('#publicProfileContent');
  const closeButton = document.querySelector('#closeProfileDialog');
  let lastFocusedElement = null;

  localStorage.setItem(deviceKey, deviceId);
  if (!overlay || !content) return;

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function hasValue(value) {
    return value !== null && value !== undefined;
  }

  async function requestProfile(nick) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action: 'public-profile', nick }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo cargar el perfil.');
    return body;
  }

  function extractNick(item) {
    const player = item?.querySelector('.player');
    if (!player) return '';
    return Array.from(player.childNodes)
      .find((node) => node.nodeType === Node.TEXT_NODE)
      ?.textContent?.trim() || '';
  }

  function openOverlay() {
    lastFocusedElement = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add('profile-open');
    closeButton?.focus();
  }

  function closeOverlay() {
    overlay.hidden = true;
    document.documentElement.classList.remove('profile-open');
    content.replaceChildren();
    delete content.dataset.radarReady;
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
    lastFocusedElement = null;
  }

  function renderProfile(profile) {
    content.innerHTML = `
      <p class="eyebrow">PERFIL PÚBLICO</p>
      <h2 id="publicProfileTitle">${escapeHtml(profile.nick)}</h2>
      <div class="public-profile-grid">
        <div><span>Mejor marca global</span><strong>${hasValue(profile.bestDifferenceMs) ? `±${profile.bestDifferenceMs} ms` : '—'}</strong></div>
        <div><span>Media global</span><strong>${hasValue(profile.averageDifferenceMs) ? `±${profile.averageDifferenceMs} ms` : '—'}</strong></div>
        <div><span>Puesto global</span><strong>${profile.globalRankBest ? `#${profile.globalRankBest}` : '—'}</strong></div>
        <div><span>Intentos globales válidos</span><strong>${profile.verifiedAttempts ?? 0}</strong></div>
        <div><span>Referidos</span><strong>${profile.completedReferrals ?? 0}</strong></div>
        <div><span>Intentos extra globales</span><strong>${profile.bonusAttempts ?? 0}</strong></div>
      </div>
      <h3>Últimos intentos globales</h3>
      <ol class="attempt-history">${profile.history?.length
        ? profile.history.slice(0, 10).map((attempt, index) => `<li><span class="history-number">${index + 1}</span><span>${(Number(attempt.elapsedMs) / 1000).toFixed(3)} s</span><strong>±${attempt.differenceMs} ms</strong><small class="${attempt.verified ? 'valid' : 'invalid'}">${attempt.verified ? 'Válido' : 'Excluido'}</small></li>`).join('')
        : '<li class="empty">Sin intentos globales.</li>'}</ol>`;
  }

  async function openProfile(nick) {
    if (!nick || !apiUrl) return;
    openOverlay();
    content.innerHTML = '<p class="empty profile-loading">Cargando perfil…</p>';
    delete content.dataset.radarReady;
    try {
      const profile = await requestProfile(nick);
      if (!profile?.nick) throw new Error('No se encontró el jugador.');
      renderProfile(profile);
    } catch (error) {
      content.innerHTML = `<p class="empty">${escapeHtml(error instanceof Error ? error.message : 'No se pudo cargar el perfil.')}</p>`;
    }
  }

  const leaderboard = document.querySelector('#leaderboard');
  leaderboard?.addEventListener('click', (event) => {
    const item = event.target.closest('li');
    const nick = extractNick(item);
    if (!nick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openProfile(nick);
  }, true);

  leaderboard?.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const item = event.target.closest('li');
    const nick = extractNick(item);
    if (!nick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openProfile(nick);
  }, true);

  closeButton?.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) closeOverlay();
  });
})();
