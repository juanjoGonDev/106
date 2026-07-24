(() => {
  const config = window.__MINUTO106_CONFIG__ ?? {};
  const apiBaseUrl = String(config.apiBaseUrl ?? '').replace(/\/$/, '');
  const parameters = new URLSearchParams(location.search);
  const duelCode = String(parameters.get('duel') || '').trim().toLowerCase();
  const sharedResultId = String(parameters.get('sharedResult') || '').trim().toLowerCase();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function socialUrl(kind, id) {
    if (!apiBaseUrl || apiBaseUrl.includes('YOUR_PROJECT_REF')) return null;
    const url = new URL(apiBaseUrl);
    url.pathname = url.pathname.replace(/\/[^/]+\/?$/, '/social-share');
    url.pathname += `/${kind}/${encodeURIComponent(id)}`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('format', 'json');
    return url;
  }

  async function requestShareData(kind, id) {
    const url = socialUrl(kind, id);
    if (!url) throw new Error('No se ha configurado el servidor de retos.');
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo cargar el contenido compartido.');
    return body;
  }

  function formatElapsed(value) {
    return Number.isFinite(Number(value)) ? `${(Number(value) / 1000).toFixed(3)} s` : '—';
  }

  function formatDifference(value) {
    return Number.isFinite(Number(value)) ? `±${Number(value).toLocaleString('es-ES')} ms` : '—';
  }

  function appendStrong(container, value) {
    const strong = document.createElement('strong');
    strong.textContent = value;
    container.append(strong);
  }

  function renderDuel(duel) {
    const notice = document.querySelector('#duelNotice');
    if (!notice) return;
    notice.hidden = false;
    const resolveButton = notice.querySelector('#resolveDuelButton');
    notice.replaceChildren();
    notice.append('Reto de ');
    appendStrong(notice, String(duel.challengerNick || 'otro jugador'));
    notice.append('. Tiempo registrado: ');
    appendStrong(notice, formatElapsed(duel.targetElapsedMs));
    notice.append(` (${formatDifference(duel.targetDifferenceMs)} del 10.600). `);

    if (duel.open === true) {
      notice.append('Para ganar debes quedar más cerca del objetivo. Completa tus intentos y después ');
      if (resolveButton) {
        resolveButton.textContent = 'comprobar si ganaste';
        notice.append(resolveButton, '.');
      }
      return;
    }

    notice.append('Este reto ya no está abierto, pero puedes intentar superar la marca igualmente.');
    if (resolveButton) resolveButton.hidden = true;
  }

  function renderSharedResult(attempt) {
    if (duelCode) return;
    const notice = document.querySelector('#duelNotice');
    if (!notice) return;
    notice.hidden = false;
    notice.replaceChildren();
    appendStrong(notice, String(attempt.nick || 'Un jugador'));
    notice.append(' compartió un resultado de ');
    appendStrong(notice, formatElapsed(attempt.elapsedMs));
    notice.append(` (${formatDifference(attempt.differenceMs)} del 10.600). ¿Puedes acercarte más?`);
  }

  async function initialize() {
    if (uuidPattern.test(duelCode)) {
      try {
        renderDuel(await requestShareData('duel', duelCode));
      } catch {
        // The existing duel UI keeps its generic fallback when metadata is unavailable.
      }
    }
    if (uuidPattern.test(sharedResultId)) {
      try {
        renderSharedResult(await requestShareData('result', sharedResultId));
      } catch {
        // Shared result context is progressive enhancement.
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
