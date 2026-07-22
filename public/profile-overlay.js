(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const overlay = document.querySelector('#profileDialog');
  const content = document.querySelector('#publicProfileContent');
  const closeButton = document.querySelector('#closeProfileDialog');
  let lastFocusedElement = null;
  let currentProfile = null;

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

  function trophyName(type) {
    return ({ golden_boot: 'Bota de Oro', golden_glove: 'Guante de Oro', golden_ball: 'Balón de Oro' })[type] || 'Trofeo';
  }

  function trophyMetric(trophy) {
    return trophy.type === 'golden_ball' ? `${trophy.value} intentos` : `±${trophy.value} ms`;
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
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
    currentProfile = null;
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
    lastFocusedElement = null;
  }

  function profileShareUrl(profile) {
    const url = new URL('./ranking.html', location.href);
    url.searchParams.set('nick', profile.nick);
    return url.toString();
  }

  async function shareProfile() {
    if (!currentProfile) return;
    const trophies = Number(currentProfile.trophies?.total || 0);
    const achievements = Number(currentProfile.achievements?.total || 0);
    await window.Minuto106UI?.share({
      title: `${currentProfile.nick} · Minuto 106`,
      text: `Mira mi palmarés en Minuto 106: ${trophies} ${trophies === 1 ? 'trofeo' : 'trofeos'} y ${achievements} ${achievements === 1 ? 'logro' : 'logros'}. ¿Me superas?`,
      url: profileShareUrl(currentProfile),
    });
  }

  function renderHonours(profile) {
    const trophies = profile.trophies || {};
    const achievements = profile.achievements || {};
    const trophyHistory = Array.isArray(trophies.history) ? trophies.history.slice(0, 12) : [];
    const achievementItems = Array.isArray(achievements.items) ? achievements.items.slice(0, 12) : [];
    return `
      <section class="honours-summary">
        <h3>Palmarés público</h3>
        <div class="honours-counts">
          <div><span>Trofeos</span><strong>${trophies.total || 0}${trophies.rank ? ` · #${trophies.rank}` : ''}</strong></div>
          <div><span>Logros</span><strong>${achievements.total || 0}</strong></div>
          <div><span>Puntos de logro</span><strong>${achievements.points || 0}${achievements.rank ? ` · #${achievements.rank}` : ''}</strong></div>
          <div><span>Bota de Oro</span><strong>${trophies.goldenBoot || 0}</strong></div>
          <div><span>Guante de Oro</span><strong>${trophies.goldenGlove || 0}</strong></div>
          <div><span>Balón de Oro</span><strong>${trophies.goldenBall || 0}</strong></div>
        </div>
        ${trophyHistory.length ? `<h3>Trofeos conseguidos</h3><ol class="honours-list">${trophyHistory.map((trophy) => `<li><span class="honours-badge">🏆</span><span><strong>${trophyName(trophy.type)}</strong><small><time datetime="${trophy.date}">${formatDate(trophy.date)}</time></small></span><span>${trophyMetric(trophy)}</span></li>`).join('')}</ol>` : '<p class="empty">Todavía no tiene trofeos cerrados.</p>'}
        ${achievementItems.length ? `<h3>Logros desbloqueados</h3><ol class="honours-list">${achievementItems.map((achievement) => `<li><span class="honours-badge">★</span><span><strong>${escapeHtml(achievement.title)}</strong><small>${escapeHtml(achievement.description)} · ${formatDate(achievement.date)}</small></span><span>${achievement.points} pt</span></li>`).join('')}</ol>` : '<p class="empty">Todavía no tiene logros.</p>'}
        <button class="secondary honours-share" id="sharePublicProfile" type="button">Compartir palmarés</button>
      </section>`;
  }

  function renderProfile(profile) {
    currentProfile = profile;
    content.innerHTML = `
      <p class="eyebrow">PERFIL PÚBLICO GLOBAL</p>
      <h2 id="publicProfileTitle">${escapeHtml(profile.nick)}</h2>
      <div class="public-profile-grid">
        <div><span>Mejor marca global</span><strong>${hasValue(profile.bestDifferenceMs) ? `±${profile.bestDifferenceMs} ms` : '—'}</strong></div>
        <div><span>Media global</span><strong>${hasValue(profile.averageDifferenceMs) ? `±${profile.averageDifferenceMs} ms` : '—'}</strong></div>
        <div><span>Puesto global</span><strong>${profile.globalRankBest ? `#${profile.globalRankBest}` : '—'}</strong></div>
        <div><span>Intentos globales válidos</span><strong>${profile.verifiedAttempts ?? 0}</strong></div>
      </div>
      ${renderHonours(profile)}
      <h3>Últimos intentos globales</h3>
      <ol class="attempt-history">${profile.history?.length
        ? profile.history.slice(0, 10).map((attempt, index) => `<li><span class="history-number">${index + 1}</span><span>${(Number(attempt.elapsedMs) / 1000).toFixed(3)} s</span><strong>±${attempt.differenceMs} ms</strong><small class="${attempt.verified ? 'valid' : 'invalid'}">${attempt.verified ? 'Válido' : 'Excluido'}</small></li>`).join('')
        : '<li class="empty">Sin intentos globales.</li>'}</ol>`;
    content.querySelector('#sharePublicProfile')?.addEventListener('click', () => {
      shareProfile().catch((error) => window.Minuto106UI?.error({
        title: 'No se pudo compartir',
        message: error instanceof Error ? error.message : 'No se pudo abrir el menú para compartir.',
      }));
    });
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

  closeButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeOverlay();
  }, true);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) closeOverlay();
  });
})();
