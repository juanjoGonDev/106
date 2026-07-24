(() => {
  const PNG_TYPE = 'image/png';

  function normalizeFilePart(value, fallback) {
    const normalized = String(value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return normalized || fallback;
  }

  function fileName(nick, section = 'overview') {
    return `minuto-106-${normalizeFilePart(nick, 'jugador')}-${normalizeFilePart(section, 'overview')}.png`;
  }

  async function prepareFile({ url, nick, section = 'overview', fetchImpl = globalThis.fetch } = {}) {
    const source = String(url ?? '').trim();
    if (!source) throw new Error('No se ha podido preparar la tarjeta del perfil.');
    if (typeof fetchImpl !== 'function') throw new Error('El navegador no permite preparar la tarjeta del perfil.');

    const response = await fetchImpl(source, { headers: { accept: PNG_TYPE } });
    const contentType = String(response.headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!response.ok || contentType !== PNG_TYPE) throw new Error('No se ha podido generar la tarjeta PNG.');

    const blob = await response.blob();
    if (!blob.size) throw new Error('La tarjeta PNG está vacía.');
    if (typeof File !== 'function') throw new Error('El navegador no permite adjuntar la tarjeta del perfil.');

    return new File([blob], fileName(nick, section), { type: PNG_TYPE, lastModified: Date.now() });
  }

  function canShareFile(file, navigatorLike = globalThis.navigator) {
    if (!file || typeof navigatorLike?.share !== 'function' || typeof navigatorLike?.canShare !== 'function') return false;
    try {
      return navigatorLike.canShare({ files: [file] }) === true;
    } catch {
      return false;
    }
  }

  function isAbortError(error) {
    return error?.name === 'AbortError';
  }

  async function share({ title, text, url, file, navigatorLike = globalThis.navigator, fallback } = {}) {
    const payload = {
      title: String(title || 'Minuto 106'),
      text: String(text || '¿Me superas en Minuto 106?'),
      url: String(url || globalThis.location?.href || ''),
    };

    if (canShareFile(file, navigatorLike)) {
      try {
        await navigatorLike.share({
          title: payload.title,
          text: `${payload.text}\n${payload.url}`.trim(),
          files: [file],
        });
        return true;
      } catch (error) {
        if (isAbortError(error)) return false;
      }
    }

    const fallbackShare = fallback ?? globalThis.Minuto106UI?.share;
    if (typeof fallbackShare === 'function') return fallbackShare(payload);
    return false;
  }

  globalThis.Minuto106ProfileShare = Object.freeze({ canShareFile, fileName, prepareFile, share });
})();
