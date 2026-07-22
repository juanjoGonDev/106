(() => {
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  let refreshTimer = 0;
  let requestPending = false;
  let lastSignature = '';

  localStorage.setItem(deviceKey, deviceId);

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function trophyName(type) {
    return ({ golden_boot: 'Bota de Oro', golden_glove: 'Guante de Oro', golden_ball: 'Balón de Oro' })[type] || 'Trofeo';
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Date(`${value}T12:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function profileUrl(profile) {
    const url = new URL('./ranking.html', location.href);
    url.searchParams.set('nick', profile.nick);
    return url.toString();
  }

  function currentNick() {
    return String(document.querySelector('#nick')?.value || localStorage.getItem('minuto106:nick') || '').trim();
  }

  async function requestProfile(nick) {
    const config = window.__MINUTO106_CONFIG__ ?? {};
    const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
    if (!apiUrl || apiUrl.includes('YOUR_PROJECT_REF')) return null;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action: 'profile', nick }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo cargar el palmarés.');
    return body;
  }

  async function shareProfile(profile) {
    const trophies = Number(profile.trophies?.total || 0);
    const achievements = Number(profile.achievements?.total || 0);
    await window.Minuto106UI?.share({
      title: `${profile.nick} · Minuto 106`,
      text: `Este es mi palmarés en Minuto 106: ${trophies} ${trophies === 1 ? 'trofeo' : 'trofeos'}, ${achievements} ${achievements === 1 ? 'logro' : 'logros'} y ${profile.achievements?.points || 0} puntos. ¿Me superas?`,
      url: profileUrl(profile),
    });
  }

  function render(profile) {
    const card = document.querySelector('#profileCard');
    if (!card || !profile?.nick) return;
    const trophies = profile.trophies || {};
    const achievements = profile.achievements || {};
    const history = Array.isArray(trophies.history) ? trophies.history.slice(0, 6) : [];
    const items = Array.isArray(achievements.items) ? achievements.items.slice(0, 6) : [];
    const signature = JSON.stringify({
      nick: profile.nick,
      trophies: [trophies.total, trophies.rank, history],
      achievements: [achievements.total, achievements.points, achievements.rank, items],
    });
    if (signature === lastSignature && card.querySelector('#ownHonours')) return;
    lastSignature = signature;

    let section = card.querySelector('#ownHonours');
    if (!section) {
      section = document.createElement('section');
      section.id = 'ownHonours';
      section.className = 'honours-summary';
      card.querySelector('.profile-summary')?.after(section);
    }
    section.innerHTML = `
      <h3>Tu palmarés</h3>
      <div class="honours-counts">
        <div><span>Trofeos</span><strong>${trophies.total || 0}${trophies.rank ? ` · #${trophies.rank}` : ''}</strong></div>
        <div><span>Logros</span><strong>${achievements.total || 0}</strong></div>
        <div><span>Puntos</span><strong>${achievements.points || 0}${achievements.rank ? ` · #${achievements.rank}` : ''}</strong></div>
        <div><span>Bota de Oro</span><strong>${trophies.goldenBoot || 0}</strong></div>
        <div><span>Guante de Oro</span><strong>${trophies.goldenGlove || 0}</strong></div>
        <div><span>Balón de Oro</span><strong>${trophies.goldenBall || 0}</strong></div>
      </div>
      ${history.length ? `<ol class="honours-list">${history.map((trophy) => `<li><span class="honours-badge">🏆</span><span><strong>${trophyName(trophy.type)}</strong><small>${formatDate(trophy.date)}</small></span><span>${trophy.type === 'golden_ball' ? `${trophy.value} intentos` : `±${trophy.value} ms`}</span></li>`).join('')}</ol>` : '<p class="empty">Los trofeos se consolidan al cerrar el día.</p>'}
      ${items.length ? `<ol class="honours-list">${items.map((achievement) => `<li><span class="honours-badge">★</span><span><strong>${escapeHtml(achievement.title)}</strong><small>${escapeHtml(achievement.description)}</small></span><span>${achievement.points} pt</span></li>`).join('')}</ol>` : ''}
      <button id="shareOwnHonours" class="secondary honours-share" type="button">Compartir palmarés</button>`;
    section.querySelector('#shareOwnHonours')?.addEventListener('click', () => {
      shareProfile(profile).catch((error) => window.Minuto106UI?.error({
        title: 'No se pudo compartir',
        message: error instanceof Error ? error.message : 'No se pudo abrir el menú para compartir.',
      }));
    });
  }

  async function refresh() {
    const card = document.querySelector('#profileCard');
    const nick = currentNick();
    if (!card || nick.length < 2 || requestPending) return;
    requestPending = true;
    try {
      const profile = await requestProfile(nick);
      if (profile?.nick) render(profile);
    } catch {
      // Existing profile surfaces own connection errors; honours is progressive enhancement.
    } finally {
      requestPending = false;
    }
  }

  function scheduleRefresh(delay = 0) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, delay);
  }

  function ensureShareActions() {
    if (document.querySelector('script[data-minuto106-share-actions]')) return;
    const script = document.createElement('script');
    script.src = './share-actions.js';
    script.async = false;
    script.dataset.minuto106ShareActions = 'true';
    document.head.append(script);
  }

  function initialize() {
    ensureShareActions();
    const card = document.querySelector('#profileCard');
    if (!card) return;
    const referralButton = document.querySelector('#copyReferralButton');
    if (referralButton) referralButton.textContent = 'Compartir invitación';
    const startButton = document.querySelector('#startButton');
    if (startButton) startButton.textContent = 'Verificar para jugar';
    scheduleRefresh();
    document.querySelector('#nick')?.addEventListener('input', () => scheduleRefresh(500));
    const observer = new MutationObserver(() => scheduleRefresh(60));
    observer.observe(card, { attributes: true, childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
