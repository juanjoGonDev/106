(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const ui = window.Minuto106PlayerUI;
  const route = ui?.parsePlayerLocation(location) ?? { nick: '', section: 'overview' };
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const absoluteSchemePattern = /^[a-z][a-z0-9+.-]*:/i;

  localStorage.setItem(deviceKey, deviceId);

  const $ = (selector) => document.querySelector(selector);
  const hasValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const formatDifference = (value) => hasValue(value) ? `±${Number(value).toLocaleString('es-ES')} ms` : '—';
  const formatTime = (value) => hasValue(value) ? `${(Number(value) / 1000).toFixed(3)} s` : '—';
  const trophyName = (type) => ({
    golden_boot: 'Bota de Oro',
    golden_glove: 'Guante de Oro',
    golden_ball: 'Balón de Oro',
    league_champion: 'Campeón de liga',
  })[type] || 'Trofeo';
  const trophyMetric = (trophy) => trophy.type === 'golden_ball' ? `${Number(trophy.value || 0)} intentos` : formatDifference(trophy.value);

  function escape(value) {
    return ui.escapeHtml(value);
  }

  function normalizeSiteChromeLinks() {
    const appBaseUrl = ui.appBaseUrl();
    const links = document.querySelectorAll('.site-header a[href], .site-footer a[href], #cookieBanner a[href]');
    for (const anchor of links) {
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('//') || absoluteSchemePattern.test(href)) continue;
      anchor.href = new URL(href, appBaseUrl).toString();
    }
  }

  function upsertMeta(attribute, key, content) {
    let meta = document.head.querySelector(`meta[${attribute}="${CSS.escape(key)}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute(attribute, key);
      document.head.append(meta);
    }
    meta.setAttribute('content', content);
  }

  async function requestProfile(nick) {
    if (!apiUrl) throw new Error('No se ha configurado el servidor de perfiles.');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action: 'public-profile', nick }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo cargar el jugador.');
    if (!body?.nick) throw new Error('No se encontró el jugador.');
    return body;
  }

  function setMetadata(player) {
    const title = `${player.nick} · Minuto 106`;
    const description = `Perfil público de ${player.nick}: estadísticas, trofeos y logros en Minuto 106.`;
    const canonicalUrl = ui.playerUrl(player.nick, route.section);
    const shareUrl = ui.shareUrl('', player.nick, route.section);
    const cardUrl = ui.cardUrl(apiUrl, player.nick, route.section, player.profileRevision);
    const imageAlt = `Tarjeta actualizada de ${player.nick} con estadísticas, trofeos y logros de Minuto 106.`;

    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.append(canonical);
    }
    canonical.href = canonicalUrl;

    upsertMeta('property', 'og:locale', 'es_ES');
    upsertMeta('property', 'og:type', 'profile');
    upsertMeta('property', 'og:site_name', 'Minuto 106');
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', shareUrl);
    if (cardUrl) {
      upsertMeta('property', 'og:image', cardUrl);
      upsertMeta('property', 'og:image:url', cardUrl);
      upsertMeta('property', 'og:image:secure_url', cardUrl);
      upsertMeta('property', 'og:image:type', 'image/png');
      upsertMeta('property', 'og:image:width', '1200');
      upsertMeta('property', 'og:image:height', '630');
      upsertMeta('property', 'og:image:alt', imageAlt);
    }
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    if (cardUrl) {
      upsertMeta('name', 'twitter:image', cardUrl);
      upsertMeta('name', 'twitter:image:src', cardUrl);
      upsertMeta('name', 'twitter:image:alt', imageAlt);
    }

    history.replaceState(null, '', shareUrl);
    normalizeSiteChromeLinks();
  }

  function renderTabs(player) {
    const labels = { overview: 'Resumen', achievements: 'Logros', trophies: 'Trofeos' };
    $('#playerTabs').innerHTML = ui.SECTIONS.map((section) => `<a href="${escape(ui.playerUrl(player.nick, section))}" ${section === route.section ? 'aria-current="page"' : ''}>${labels[section]}</a>`).join('');
    document.querySelectorAll('[data-player-section]').forEach((section) => {
      section.hidden = section.dataset.playerSection !== route.section;
    });
  }

  function renderOverview(player) {
    $('#playerStats').innerHTML = [
      ['Mejor marca', formatDifference(player.bestDifferenceMs)],
      ['Media global', formatDifference(player.averageDifferenceMs)],
      ['Puesto global', player.globalRankBest ? `#${player.globalRankBest}` : '—'],
      ['Intentos válidos', Number(player.verifiedAttempts || 0).toLocaleString('es-ES')],
      ['Trofeos', Number(player.trophies?.total || 0).toLocaleString('es-ES')],
      ['Logros', Number(player.achievements?.total || 0).toLocaleString('es-ES')],
      ['Puntos', Number(player.achievements?.points || 0).toLocaleString('es-ES')],
      ['Ligas ganadas', Number(player.trophies?.leagueChampion || 0).toLocaleString('es-ES')],
    ].map(([label, value]) => `<div><span>${label}</span><strong>${escape(value)}</strong></div>`).join('');

    const attempts = Array.isArray(player.history) ? player.history : [];
    $('#playerHistory').innerHTML = attempts.length
      ? attempts.slice(0, 20).map((attempt, index) => `<li><span class="player-list__icon">${index + 1}</span><span class="player-list__copy"><strong>${ui.teamHtml(attempt.team, player)}</strong><small>${formatTime(attempt.elapsedMs)} · ${attempt.verified ? 'Válido' : 'Excluido'}</small></span><span class="player-list__metric">${formatDifference(attempt.differenceMs)}</span></li>`).join('')
      : '<li class="player-empty">Todavía no hay intentos globales.</li>';
  }

  function renderAchievements(player) {
    const achievements = player.achievements || {};
    const items = Array.isArray(achievements.items) ? achievements.items : [];
    $('#achievementTotal').textContent = `${Number(achievements.total || 0)} logros · ${Number(achievements.points || 0)} pt`;
    $('#playerAchievements').innerHTML = items.length
      ? items.map((achievement) => `<li><span class="player-list__icon">★</span><span class="player-list__copy"><strong>${escape(achievement.title)}</strong><small>${escape(achievement.description)}</small><time datetime="${escape(achievement.date)}">${escape(ui.formatDate(achievement.date))}</time></span><span class="player-list__metric">${Number(achievement.points || 0)} pt</span></li>`).join('')
      : '<li class="player-empty">Todavía no ha desbloqueado logros.</li>';
  }

  function renderTrophies(player) {
    const trophies = player.trophies || {};
    const history = Array.isArray(trophies.history) ? trophies.history : [];
    $('#trophyTotal').textContent = `${Number(trophies.total || 0)} trofeos · ${Number(trophies.days || 0)} días · ${Number(trophies.leagueChampion || 0)} ligas`;
    $('#playerTrophies').innerHTML = history.length
      ? history.map((trophy) => `<li><span class="player-list__icon">🏆</span><span class="player-list__copy"><strong>${escape(trophyName(trophy.type))}</strong>${trophy.leagueName ? `<small>${escape(trophy.leagueName)} · ${escape(trophy.leagueCode)}</small>` : ''}<time datetime="${escape(trophy.date)}">${escape(ui.formatDate(trophy.date))}</time></span><span class="player-list__metric">${escape(trophyMetric(trophy))}</span></li>`).join('')
      : '<li class="player-empty">Todavía no tiene trofeos.</li>';
  }

  function renderShareActions(player) {
    const share = ui.shareUrl('', player.nick, route.section);
    const card = ui.cardUrl(apiUrl, player.nick, route.section, player.profileRevision);
    $('#playerCardPreview').src = card;
    $('#downloadPlayerCard').href = card;
    $('#sharePlayer').addEventListener('click', () => {
      const trophies = Number(player.trophies?.total || 0);
      const achievements = Number(player.achievements?.total || 0);
      window.Minuto106UI?.share({
        title: `${player.nick} · Minuto 106`,
        text: `${player.nick} suma ${trophies} ${trophies === 1 ? 'trofeo' : 'trofeos'}, ${achievements} ${achievements === 1 ? 'logro' : 'logros'} y ${Number(player.achievements?.points || 0)} puntos.`,
        url: share,
      });
    });
    $('#downloadPlayerCard').addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        const response = await fetch(card);
        if (!response.ok || !String(response.headers.get('content-type')).startsWith('image/png')) throw new Error('No se pudo generar la tarjeta PNG.');
        const objectUrl = URL.createObjectURL(await response.blob());
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `minuto-106-${player.nick}-${route.section}.png`;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      } catch (error) {
        window.Minuto106UI?.error({ title: 'No se pudo descargar', message: error instanceof Error ? error.message : 'No se pudo descargar la imagen.' });
      }
    });
  }

  function render(player) {
    setMetadata(player);
    $('#playerNick').textContent = player.nick;
    $('#playerTeam').innerHTML = ui.teamHtml(player.team, player, 'player-team--hero');
    renderTabs(player);
    renderOverview(player);
    renderAchievements(player);
    renderTrophies(player);
    window.Minuto106PlayerStats?.renderPlayerRadar($('#playerRadar'), [{ profile: player, label: player.nick }]);
    renderShareActions(player);
    $('#playerLoading').hidden = true;
    $('#playerContent').hidden = false;
  }

  function showError(error) {
    $('#playerLoading').hidden = true;
    $('#playerError').hidden = false;
    $('#playerErrorMessage').textContent = error instanceof Error ? error.message : 'No se pudo cargar el jugador.';
  }

  if (!ui || route.nick.length < 2) {
    showError(new Error('La ruta del jugador no es válida.'));
    return;
  }

  requestProfile(route.nick).then(render).catch(showError);
})();
