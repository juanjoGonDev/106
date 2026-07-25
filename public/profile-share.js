(() => {
  const PNG_TYPE = 'image/png';
  const PREPARING_LABEL = 'Preparando...';
  const BRIDGE_MARKER = '__minuto106ProfileShareBridge';
  const shareStates = new Map();

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

  function normalizeShareUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
      const Url = globalThis.URL;
      return typeof Url === 'function'
        ? new Url(raw, globalThis.location?.href || 'http://localhost/').toString()
        : raw;
    } catch {
      return raw;
    }
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
    if (typeof globalThis.File !== 'function') throw new Error('El navegador no permite adjuntar la tarjeta del perfil.');

    return new globalThis.File([blob], fileName(nick, section), { type: PNG_TYPE, lastModified: Date.now() });
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

    if (typeof fallback === 'function') return fallback(payload);
    return false;
  }

  function setButton(button, { disabled, label }) {
    if (!button) return;
    button.disabled = disabled;
    button.textContent = label;
  }

  async function bindButton({
    button,
    url,
    cardUrl,
    nick,
    section = 'overview',
    readyLabel = 'Compartir perfil',
    fetchImpl = globalThis.fetch,
  } = {}) {
    const shareUrl = normalizeShareUrl(url);
    const source = String(cardUrl ?? '').trim();
    if (!button || !shareUrl || !source) {
      setButton(button, { disabled: false, label: readyLabel });
      return null;
    }

    installShareBridge();
    const signature = `${shareUrl}\n${source}`;
    button.dataset.profileShareSignature = signature;
    setButton(button, { disabled: true, label: PREPARING_LABEL });

    const existing = shareStates.get(shareUrl);
    let preparation;
    if (existing?.signature === signature && existing.file) {
      preparation = Promise.resolve(existing.file);
    } else if (existing?.signature === signature && existing.promise) {
      preparation = existing.promise;
    } else {
      preparation = prepareFile({ url: source, nick, section, fetchImpl });
      shareStates.set(shareUrl, { signature, promise: preparation, file: null });
    }

    let file = null;
    try {
      file = await preparation;
      shareStates.set(shareUrl, { signature, promise: null, file });
    } catch {
      shareStates.delete(shareUrl);
    } finally {
      if (button.dataset.profileShareSignature === signature) {
        setButton(button, { disabled: false, label: readyLabel });
      }
    }
    return file;
  }

  function installShareBridge({
    ui = globalThis.Minuto106UI,
    navigatorLike = globalThis.navigator,
  } = {}) {
    if (!ui || typeof ui.share !== 'function') return false;
    if (ui.share[BRIDGE_MARKER] === true) return true;

    const fallback = ui.share.bind(ui);
    const bridgedShare = (input = {}) => {
      const shareUrl = normalizeShareUrl(input.url);
      const preparedFile = input.file || shareStates.get(shareUrl)?.file || null;
      return share({ ...input, file: preparedFile, navigatorLike, fallback });
    };
    Object.defineProperty(bridgedShare, BRIDGE_MARKER, { value: true });
    ui.share = bridgedShare;
    return true;
  }

  function bindPlayerPage() {
    const documentLike = globalThis.document;
    if (!documentLike) return;
    installShareBridge();

    const button = documentLike.querySelector('#sharePlayer');
    const preview = documentLike.querySelector('#playerCardPreview');
    const nick = String(documentLike.querySelector('#playerNick')?.textContent || '').trim();
    if (!button || !preview || !nick) return;

    const rawCardUrl = preview.getAttribute('src');
    if (!rawCardUrl) {
      setButton(button, { disabled: false, label: 'Compartir perfil' });
      return;
    }

    const playerUi = globalThis.Minuto106PlayerUI;
    const route = playerUi?.parsePlayerLocation?.(globalThis.location) || { section: 'overview' };
    const shareUrl = playerUi?.playerUrl?.(nick, route.section) || globalThis.location?.href || '';
    void bindButton({
      button,
      url: shareUrl,
      cardUrl: rawCardUrl,
      nick,
      section: route.section,
      readyLabel: 'Compartir perfil',
    });
  }

  function observePlayerPage() {
    const documentLike = globalThis.document;
    if (!documentLike) return;
    const start = () => {
      bindPlayerPage();
      if (typeof globalThis.MutationObserver !== 'function' || !documentLike.body) return;
      const observer = new globalThis.MutationObserver(bindPlayerPage);
      observer.observe(documentLike.body, {
        attributes: true,
        attributeFilter: ['src'],
        childList: true,
        characterData: true,
        subtree: true,
      });
    };
    if (documentLike.readyState === 'loading') documentLike.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  const api = Object.freeze({
    bindButton,
    canShareFile,
    fileName,
    installShareBridge,
    prepareFile,
    share,
  });
  globalThis.Minuto106ProfileShare = api;
  installShareBridge();
  observePlayerPage();
})();
