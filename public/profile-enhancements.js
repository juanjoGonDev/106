(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  localStorage.setItem(deviceKey, deviceId);

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

  function currentProfileNick(container) {
    return String(container.querySelector('h2')?.textContent || '').trim();
  }

  async function enhanceProfile(container) {
    if (!container || container.dataset.radarReady === 'true') return;
    const nick = currentProfileNick(container);
    if (!nick || !window.Minuto106PlayerStats) return;
    container.dataset.radarReady = 'true';

    const section = document.createElement('section');
    section.className = 'player-radar';
    const title = document.createElement('h3');
    title.textContent = 'Perfil de juego global';
    const radar = document.createElement('div');
    radar.className = 'player-radar-chart';
    const compare = document.createElement('div');
    compare.className = 'profile-compare';
    const input = document.createElement('input');
    input.maxLength = 24;
    input.placeholder = 'Nick para comparar';
    input.autocomplete = 'off';
    input.dataset.bwignore = 'true';
    input.setAttribute('aria-label', 'Nick del jugador para comparar');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary compact';
    button.textContent = 'Comparar';
    compare.append(input, button);
    section.append(title, radar, compare);
    container.append(section);

    const primary = await requestProfile(nick);
    window.Minuto106PlayerStats.renderPlayerRadar(radar, [{ profile: primary, label: primary.nick }]);

    button.addEventListener('click', async () => {
      const comparedNick = input.value.trim();
      if (!comparedNick) return;
      button.disabled = true;
      try {
        const secondary = await requestProfile(comparedNick);
        if (!secondary?.nick) throw new Error('No se encontró el jugador.');
        window.Minuto106PlayerStats.renderPlayerRadar(radar, [
          { profile: primary, label: primary.nick },
          { profile: secondary, label: secondary.nick },
        ]);
      } catch (error) {
        await window.Minuto106UI?.error({
          title: 'No se pudo comparar',
          message: error instanceof Error ? error.message : 'No se pudo cargar el segundo jugador.',
        });
      } finally {
        button.disabled = false;
      }
    });
  }

  const profileContent = document.querySelector('#publicProfileContent');
  if (!profileContent) return;
  const observer = new MutationObserver(() => {
    if (!profileContent.textContent?.trim()) {
      delete profileContent.dataset.radarReady;
      return;
    }
    enhanceProfile(profileContent).catch(() => {
      delete profileContent.dataset.radarReady;
    });
  });
  observer.observe(profileContent, { childList: true, subtree: true });
})();
