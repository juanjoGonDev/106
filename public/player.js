(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const playerContextUrl = apiUrl.replace(/\/game-api$/, '/player-context');
  const ui = window.Minuto106PlayerUI;
  const catalog = window.Minuto106HonoursCatalog;
  const route = ui?.parsePlayerLocation(location) ?? { nick: '', section: 'overview' };
  const deviceKey = 'minuto106:device-id';
  const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
  const absoluteSchemePattern = /^[a-z][a-z0-9+.-]*:/i;
  let context = Object.freeze({ availability: 'unknown', profile: null, leagues: [], degraded: false });
  let persistedFeaturedCodes = [];
  let draftFeaturedCodes = [];
  let savePending = false;
  let retryPending = false;

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
  const trophyMetric = (trophy) => trophy.type === 'golden_ball'
    ? `${Number(trophy.value || 0)} intentos`
    : formatDifference(trophy.value ?? trophy.bestDifferenceMs);

  function escape(value) {
    return ui.escapeHtml(value);
  }

  function leagueUrl(publicId) {
    return new URL(`ligas/${encodeURIComponent(publicId)}`, ui.appBaseUrl()).toString();
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

  async function responseBody(response) {
    return response.json().catch(() => ({}));
  }

  async function requestPlayerContext(action, payload = {}) {
    if (!playerContextUrl || playerContextUrl === apiUrl) {
      throw new Error('No se ha configurado el servidor de perfiles.');
    }
    const response = await fetch(playerContextUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
      body: JSON.stringify({ action, nick: route.nick, ...payload }),
    });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(body.error || 'No se pudo cargar el jugador.');
    if (!body?.profile?.nick) throw new Error('No se encontró el jugador.');
    return body;
  }

  async function requestPublicProfile() {
    if (!apiUrl) throw new Error('No se ha configurado el servidor público.');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'public-profile', nick: route.nick }),
    });
    const profile = await responseBody(response);
    if (!response.ok) throw new Error(profile.error || 'No se pudo cargar el jugador.');
    if (!profile?.nick) throw new Error('No se encontró el jugador.');
    return {
      availability: 'unknown',
      profile,
      leagues: [],
      degraded: true,
    };
  }

  async function loadPublicContext() {
    try {
      return await requestPlayerContext('player-context');
    } catch {
      try {
        return await requestPublicProfile();
      } catch (fallbackError) {
        if (fallbackError instanceof Error && fallbackError.message === 'No se encontró el jugador.') {
          throw fallbackError;
        }
        throw new Error('No se pudo conectar con el servidor de perfiles. Reinténtalo en unos segundos.', { cause: fallbackError });
      }
    }
  }

  function setMetadata(player) {
    const title = `${player.nick} · Minuto 106`;
    const description = `Perfil público de ${player.nick}: estadísticas, trofeos, progreso y logros destacados en Minuto 106.`;
    const canonicalUrl = ui.playerUrl(player.nick, route.section);
    const cardUrl = ui.cardUrl(apiUrl, player.nick, route.section, player.profileRevision);
    const imageAlt = `Tarjeta actualizada de ${player.nick} con estadísticas, trofeos y logros destacados de Minuto 106.`;

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
    upsertMeta('property', 'og:url', canonicalUrl);
    upsertMeta('property', 'og:image', cardUrl);
    upsertMeta('property', 'og:image:secure_url', cardUrl);
    upsertMeta('property', 'og:image:type', 'image/png');
    upsertMeta('property', 'og:image:width', '1200');
    upsertMeta('property', 'og:image:height', '630');
    upsertMeta('property', 'og:image:alt', imageAlt);
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', cardUrl);
    upsertMeta('name', 'twitter:image:src', cardUrl);
    upsertMeta('name', 'twitter:image:alt', imageAlt);

    history.replaceState(null, '', canonicalUrl);
    normalizeSiteChromeLinks();
  }

  function renderTabs(player) {
    const labels = { overview: 'Resumen', achievements: 'Logros', trophies: 'Trofeos' };
    $('#playerTabs').innerHTML = ui.SECTIONS.map((section) => `<a href="${escape(ui.playerUrl(player.nick, section))}" ${section === route.section ? 'aria-current="page"' : ''}>${labels[section]}</a>`).join('');
    document.querySelectorAll('[data-player-section]').forEach((section) => {
      section.hidden = section.dataset.playerSection !== route.section;
    });
  }

  function progressMarkup(progress) {
    const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
    return `<span class="honours-card__progress-label">${escape(progress?.label || 'Progreso no disponible.')}</span><span class="honours-progress" role="progressbar" aria-label="${escape(progress?.label || 'Progreso')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="--honours-progress:${percent}%"></span></span>`;
  }

  function achievementCard(achievement, { compact = false, editable = false } = {}) {
    const classes = [
      'honours-card',
      achievement.unlocked ? 'is-unlocked' : 'is-locked',
      achievement.featured ? 'is-featured' : '',
      compact ? 'is-compact' : '',
    ].filter(Boolean).join(' ');
    const selected = draftFeaturedCodes.includes(achievement.code);
    const selectionFull = draftFeaturedCodes.length >= catalog.MAX_FEATURED;
    const toggle = editable && achievement.unlocked
      ? `<button class="honours-card__toggle" type="button" data-featured-code="${escape(achievement.code)}" aria-pressed="${selected}" aria-label="${selected ? 'Quitar' : 'Destacar'} ${escape(achievement.title)}" ${!selected && selectionFull ? 'disabled' : ''}>${selected ? `★ ${draftFeaturedCodes.indexOf(achievement.code) + 1}` : '☆'}</button>`
      : '';
    const date = achievement.unlocked && achievement.date
      ? `<time datetime="${escape(achievement.date)}">${escape(ui.formatDate(achievement.date))}</time>`
      : '';
    const points = achievement.points === null || achievement.points === undefined
      ? ''
      : `<span>${Number(achievement.points)} pt</span>`;
    const badge = achievement.featured
      ? `<span class="honours-card__badge">Destacado #${Number(achievement.featuredPosition || 1)}</span>`
      : achievement.unlocked
        ? '<span class="honours-card__badge">Desbloqueado</span>'
        : '<span class="honours-card__badge">Bloqueado</span>';

    return `<li class="${classes}" data-achievement-code="${escape(achievement.code)}" data-unlocked="${achievement.unlocked}"><span class="honours-card__icon" aria-hidden="true">${achievement.unlocked ? '★' : '◇'}</span><span class="honours-card__content"><strong>${escape(achievement.title)}</strong><small>${escape(achievement.description)}</small>${achievement.unlocked ? '' : progressMarkup(achievement.progress)}<span class="honours-card__meta">${badge}${points}${date}</span></span>${toggle}</li>`;
  }

  function renderFeatured(player, achievements) {
    const featured = achievements.filter((achievement) => achievement.featured && achievement.unlocked)
      .sort((left, right) => Number(left.featuredPosition || 99) - Number(right.featuredPosition || 99));
    const section = $('#playerFeaturedSection');
    section.hidden = featured.length === 0;
    $('#playerFeatured').innerHTML = featured.map((achievement) => achievementCard(achievement, { compact: true })).join('');
  }

  function renderOverview(player, achievements) {
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

    renderFeatured(player, achievements);
    const attempts = Array.isArray(player.history) ? player.history : [];
    $('#playerHistory').innerHTML = attempts.length
      ? attempts.slice(0, 20).map((attempt, index) => `<li><span class="player-list__icon">${index + 1}</span><span class="player-list__copy"><strong>${ui.teamHtml(attempt.team, player)}</strong><small>${formatTime(attempt.elapsedMs)} · ${attempt.verified ? 'Válido' : 'Excluido'}</small></span><span class="player-list__metric">${formatDifference(attempt.differenceMs)}</span></li>`).join('')
      : '<li class="player-empty">Todavía no hay intentos globales.</li>';
  }

  function updateEditorState(achievements) {
    const editor = $('#featuredAchievementsEditor');
    const editable = context.availability === 'owned';
    editor.hidden = !editable;
    if (!editable) return;
    const unlockedCodes = new Set(achievements.filter((achievement) => achievement.unlocked).map((achievement) => achievement.code));
    draftFeaturedCodes = catalog.normalizeFeaturedCodes(draftFeaturedCodes, unlockedCodes);
    $('#featuredAchievementCount').textContent = `${draftFeaturedCodes.length} de ${catalog.MAX_FEATURED}`;
    const changed = JSON.stringify(draftFeaturedCodes) !== JSON.stringify(persistedFeaturedCodes);
    const saveButton = $('#saveFeaturedAchievements');
    saveButton.disabled = savePending || !changed;
    saveButton.textContent = savePending ? 'Guardando…' : 'Guardar destacados';
  }

  function renderAchievements(player, achievements) {
    const earnedCount = achievements.filter((achievement) => achievement.unlocked).length;
    const lockedCount = achievements.filter((achievement) => !achievement.unlocked).length;
    $('#achievementTotal').textContent = `${Number(player.achievements?.total || earnedCount)} desbloqueados · ${lockedCount} pendientes · ${Number(player.achievements?.points || 0)} pt`;
    updateEditorState(achievements);
    const editable = context.availability === 'owned';
    $('#playerAchievements').innerHTML = achievements.map((achievement) => achievementCard(achievement, { editable })).join('');
    $('#playerAchievements').querySelectorAll('[data-featured-code]').forEach((button) => {
      button.addEventListener('click', () => {
        const code = String(button.dataset.featuredCode || '');
        if (!code) return;
        if (draftFeaturedCodes.includes(code)) {
          draftFeaturedCodes = draftFeaturedCodes.filter((item) => item !== code);
        } else if (draftFeaturedCodes.length < catalog.MAX_FEATURED) {
          draftFeaturedCodes = [...draftFeaturedCodes, code];
        }
        renderAchievements(player, catalog.buildAchievementCatalog({
          ...player,
          achievements: {
            ...player.achievements,
            featured: draftFeaturedCodes.map((featuredCode, index) => ({ code: featuredCode, position: index + 1 })),
          },
        }));
      });
    });
  }

  function trophyCollectionCard(trophy) {
    const classes = ['honours-card', trophy.unlocked ? 'is-unlocked' : 'is-locked'].join(' ');
    const count = trophy.count > 0
      ? `<span>${trophy.count.toLocaleString('es-ES')} ${trophy.count === 1 ? 'conseguido' : 'conseguidos'}</span>`
      : '<span>Pendiente</span>';
    return `<li class="${classes}" data-trophy-type="${escape(trophy.type)}" data-unlocked="${trophy.unlocked}"><span class="honours-card__icon" aria-hidden="true">${trophy.unlocked ? '🏆' : '◇'}</span><span class="honours-card__content"><strong>${escape(trophy.title)}</strong><small>${escape(trophy.description)}</small>${progressMarkup(trophy.progress)}<span class="honours-card__meta"><span class="honours-card__badge">${trophy.unlocked ? 'Conseguido' : 'Bloqueado'}</span>${count}</span></span></li>`;
  }

  function renderTrophies(player) {
    const trophies = player.trophies || {};
    const history = Array.isArray(trophies.history) ? trophies.history : [];
    const trophyCollection = catalog.buildTrophyCatalog(player);
    $('#trophyTotal').textContent = `${Number(trophies.total || 0)} trofeos · ${Number(trophies.days || 0)} días · ${Number(trophies.leagueChampion || 0)} ligas`;
    $('#playerTrophyCollection').innerHTML = trophyCollection.map(trophyCollectionCard).join('');
    $('#playerTrophies').innerHTML = history.length
      ? history.map((trophy) => {
        const publicId = String(trophy.leaguePublicId || trophy.leagueCode || '');
        const league = trophy.leagueName && publicId
          ? `<small><a href="${escape(leagueUrl(publicId))}">${escape(trophy.leagueName)}</a> · ${escape(publicId)}</small>`
          : trophy.leagueName ? `<small>${escape(trophy.leagueName)}</small>` : '';
        return `<li><span class="player-list__icon">🏆</span><span class="player-list__copy"><strong>${escape(trophyName(trophy.type))}</strong>${league}<time datetime="${escape(trophy.date)}">${escape(ui.formatDate(trophy.date))}</time></span><span class="player-list__metric">${escape(trophyMetric(trophy))}</span></li>`;
      }).join('')
      : '<li class="player-empty">Todavía no tiene trofeos en el historial.</li>';
  }

  function renderShareActions(player) {
    const share = ui.playerUrl(player.nick, route.section);
    const card = ui.cardUrl(apiUrl, player.nick, route.section, player.profileRevision);
    $('#playerCardPreview').src = card;
    $('#downloadPlayerCard').href = card;
    $('#sharePlayer').onclick = () => {
      const trophies = Number(player.trophies?.total || 0);
      const achievements = Number(player.achievements?.total || 0);
      window.Minuto106UI?.share({
        title: `${player.nick} · Minuto 106`,
        text: `${player.nick} suma ${trophies} ${trophies === 1 ? 'trofeo' : 'trofeos'}, ${achievements} ${achievements === 1 ? 'logro' : 'logros'} y ${Number(player.achievements?.points || 0)} puntos.`,
        url: share,
      });
    };
    $('#downloadPlayerCard').onclick = async (event) => {
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
    };
  }

  async function saveFeaturedAchievements() {
    if (context.availability !== 'owned' || savePending) return;
    savePending = true;
    renderContext();
    try {
      context = Object.freeze(await requestPlayerContext('set-featured-achievements', {
        achievementCodes: draftFeaturedCodes,
      }));
      persistedFeaturedCodes = featuredCodes(context.profile);
      draftFeaturedCodes = [...persistedFeaturedCodes];
      renderContext();
      await window.Minuto106UI?.success({
        title: 'Vitrina actualizada',
        message: persistedFeaturedCodes.length
          ? 'Tus logros destacados ya aparecen en el perfil y en la imagen generada.'
          : 'Has limpiado los logros destacados del perfil.',
      });
    } catch (error) {
      renderContext();
      await window.Minuto106UI?.error({
        title: 'No se pudo guardar',
        message: error instanceof Error ? error.message : 'No se pudieron actualizar los logros destacados.',
      });
    } finally {
      savePending = false;
      renderContext();
    }
  }

  function featuredCodes(player) {
    const featured = Array.isArray(player?.achievements?.featured) ? player.achievements.featured : [];
    return featured
      .slice()
      .sort((left, right) => Number(left.position || 99) - Number(right.position || 99))
      .map((item) => String(item.code || ''))
      .filter(Boolean);
  }

  function renderRecoveryNotice() {
    const notice = $('#playerRecoveryNotice');
    if (!notice) return;
    notice.hidden = context.degraded !== true;
    const button = $('#retryPlayerContext');
    if (!button) return;
    button.disabled = retryPending;
    button.textContent = retryPending ? 'Conectando…' : 'Reintentar conexión';
  }

  function renderContext() {
    const player = context.profile;
    if (!player?.nick) return;
    setMetadata(player);
    $('#playerNick').textContent = player.nick;
    $('#playerTeam').innerHTML = ui.teamHtml(player.team, player, 'player-team--hero');
    renderTabs(player);
    const achievements = catalog.buildAchievementCatalog(player);
    renderOverview(player, achievements);
    renderAchievements(player, achievements);
    renderTrophies(player);
    window.Minuto106PlayerStats?.renderPlayerRadar($('#playerRadar'), [{ profile: player, label: player.nick }]);
    renderShareActions(player);
    $('#saveFeaturedAchievements').onclick = () => saveFeaturedAchievements();
    $('#playerError').hidden = true;
    $('#playerLoading').hidden = true;
    $('#playerContent').hidden = false;
    renderRecoveryNotice();
  }

  function showError(error) {
    const message = error instanceof Error && error.message !== 'Failed to fetch'
      ? error.message
      : 'No se pudo conectar con el servidor de perfiles. Reinténtalo en unos segundos.';
    $('#playerContent').hidden = true;
    $('#playerLoading').hidden = true;
    $('#playerError').hidden = false;
    $('#playerErrorMessage').textContent = message;
  }

  async function loadProfile({ keepCurrent = false } = {}) {
    if (retryPending) return;
    retryPending = true;
    if (!keepCurrent) {
      $('#playerContent').hidden = true;
      $('#playerError').hidden = true;
      $('#playerLoading').hidden = false;
    }
    renderRecoveryNotice();

    try {
      context = Object.freeze(await loadPublicContext());
      persistedFeaturedCodes = featuredCodes(context.profile);
      draftFeaturedCodes = [...persistedFeaturedCodes];
      renderContext();
    } catch (error) {
      if (keepCurrent && context.profile?.nick) {
        context = Object.freeze({ ...context, degraded: true });
        const message = $('#playerRecoveryMessage');
        if (message) message.textContent = 'El perfil sigue disponible en modo lectura. La conexión completa aún no se ha recuperado.';
      } else {
        showError(error);
      }
    } finally {
      retryPending = false;
      renderRecoveryNotice();
    }
  }

  if (!ui || !catalog || route.nick.length < 2) {
    showError(new Error('La ruta del jugador no es válida.'));
    return;
  }

  $('#retryPlayerProfile').onclick = () => loadProfile();
  $('#retryPlayerContext').onclick = () => loadProfile({ keepCurrent: true });
  loadProfile();
})();
