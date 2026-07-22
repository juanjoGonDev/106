(() => {
  const pageName = location.pathname.split('/').pop() || 'index.html';
  const activePage = pageName === '' ? 'index.html' : pageName;
  const links = [
    ['index.html', './', 'Jugar'],
    ['ranking.html', './ranking.html', 'Ranking'],
    ['ligas.html', './ligas.html', 'Miniligas'],
    ['cuenta.html', './cuenta.html', 'Mi cuenta'],
  ];
  const messageQueue = [];
  let activeMessage = null;

  function ensureStylesheet(href, marker) {
    const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
    if (existing) {
      existing.setAttribute(marker, 'true');
      return existing;
    }
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = href;
    stylesheet.setAttribute(marker, 'true');
    document.head.append(stylesheet);
    return stylesheet;
  }

  function ensureClassicScript(src, marker, target = document.head) {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.setAttribute(marker, 'true');
      return existing;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(marker, 'true');
    target.append(script);
    return script;
  }

  function ensureSharedStylesheet() {
    ensureStylesheet('./v9.css', 'data-minuto106-shared');
  }

  function ensureHonoursEnhancement() {
    ensureClassicScript('./honours.js', 'data-minuto106-honours');
  }

  function ensureComplianceEnhancement() {
    ensureClassicScript('./compliance.js', 'data-minuto106-compliance', document.body);
  }

  function createPrivacyBanner() {
    const banner = document.createElement('section');
    banner.id = 'cookieBanner';
    banner.className = 'cookie-banner';
    banner.hidden = true;
    banner.setAttribute('aria-label', 'Preferencias de privacidad');
    banner.innerHTML = '<div><strong>Analítica opcional</strong><p>Google Tag Manager está instalado con el almacenamiento denegado por defecto. Google Analytics solo se activa si lo aceptas.</p><a href="./cookies.html">Más información</a></div><div class="cookie-actions"><button id="rejectCookies" class="secondary" type="button">Rechazar</button><button id="configureCookies" class="ghost" type="button">Configurar</button><button id="acceptCookies" class="secondary" type="button">Aceptar</button></div>';
    return banner;
  }

  function createPrivacyDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'cookieDialog';
    dialog.className = 'cookie-dialog';
    dialog.setAttribute('aria-labelledby', 'cookieDialogTitle');
    dialog.innerHTML = '<h2 id="cookieDialogTitle">Privacidad y almacenamiento</h2><label id="analyticsConsentRow"><input id="analyticsConsent" type="checkbox"> Analítica con Google Analytics</label><label id="adsConsentRow"><input id="adsConsent" type="checkbox"> Publicidad y medición publicitaria</label><p id="optionalConsentCopy">El almacenamiento técnico necesario permanece activo.</p><div class="cookie-actions"><button id="saveCookieSettings" class="secondary" type="button">Guardar preferencias</button><button id="closeCookieDialog" class="ghost" type="button">Cancelar</button></div>';
    return dialog;
  }

  function renderPrivacyComponents() {
    if (!document.querySelector('#cookieBanner')) document.body.append(createPrivacyBanner());
    if (!document.querySelector('#cookieDialog')) document.body.append(createPrivacyDialog());
  }

  function setNavigationOpen(header, button, open) {
    header.dataset.menuOpen = String(open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Cerrar menú principal' : 'Abrir menú principal');
  }

  function installNavigationBehavior(header, navigation, button) {
    if (header.dataset.navigationReady === 'true') return;
    header.dataset.navigationReady = 'true';
    setNavigationOpen(header, button, false);

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      setNavigationOpen(header, button, button.getAttribute('aria-expanded') !== 'true');
    });

    navigation.addEventListener('click', (event) => {
      if (event.target.closest('a')) setNavigationOpen(header, button, false);
    });

    document.addEventListener('pointerdown', (event) => {
      if (!header.contains(event.target)) setNavigationOpen(header, button, false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || button.getAttribute('aria-expanded') !== 'true') return;
      setNavigationOpen(header, button, false);
      button.focus();
    });

    window.matchMedia('(min-width: 701px)').addEventListener('change', (event) => {
      if (event.matches) setNavigationOpen(header, button, false);
    });
  }

  function renderSiteChrome() {
    const header = document.querySelector('.site-header') || document.createElement('header');
    header.className = 'site-header';
    header.replaceChildren();

    const brand = document.createElement('a');
    brand.className = 'brand';
    brand.href = './';
    brand.textContent = 'MINUTO 106';

    const navigation = document.createElement('nav');
    navigation.id = 'siteNavigation';
    navigation.className = 'site-navigation';
    navigation.setAttribute('aria-label', 'Navegación principal');
    for (const [page, href, label] of links) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = label;
      if (page === 'cuenta.html') anchor.className = 'account-link';
      if (activePage === page) anchor.setAttribute('aria-current', 'page');
      navigation.append(anchor);
    }

    const menuButton = document.createElement('button');
    menuButton.className = 'site-menu-toggle';
    menuButton.type = 'button';
    menuButton.setAttribute('aria-controls', navigation.id);
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Abrir menú principal');
    for (let index = 0; index < 3; index += 1) {
      const line = document.createElement('span');
      line.setAttribute('aria-hidden', 'true');
      menuButton.append(line);
    }

    header.append(brand, menuButton, navigation);
    if (!header.isConnected) document.body.prepend(header);
    installNavigationBehavior(header, navigation, menuButton);

    const footer = document.querySelector('.site-footer') || document.createElement('footer');
    footer.className = 'site-footer';
    footer.replaceChildren();
    const copyright = document.createElement('span');
    copyright.textContent = `Minuto 106 · ${new Date().getFullYear()}`;
    const footerNavigation = document.createElement('nav');
    for (const [href, label] of [
      ['./legal.html', 'Aviso legal'],
      ['./privacidad.html', 'Privacidad'],
      ['./cookies.html', 'Cookies'],
    ]) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = label;
      footerNavigation.append(anchor);
    }
    const privacyButton = document.createElement('button');
    privacyButton.id = 'openCookieSettings';
    privacyButton.type = 'button';
    privacyButton.textContent = 'Gestionar cookies';
    footerNavigation.append(privacyButton);
    footer.append(copyright, footerNavigation);
    if (!footer.isConnected) document.body.append(footer);
  }

  function closeDialog(dialog) {
    if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  }

  function enhanceDialogs() {
    for (const dialog of document.querySelectorAll('dialog')) {
      if (!dialog.querySelector('.dialog-close')) {
        const closeButton = document.createElement('button');
        closeButton.className = 'dialog-close';
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Cerrar');
        closeButton.textContent = '×';
        closeButton.addEventListener('click', () => closeDialog(dialog));
        dialog.prepend(closeButton);
      }
      if (dialog.dataset.dismissReady !== 'true') {
        dialog.dataset.dismissReady = 'true';
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) closeDialog(dialog);
        });
      }
    }

    const celebration = document.querySelector('#celebration');
    if (celebration && !celebration.querySelector('.celebration-close')) {
      const closeButton = document.createElement('button');
      closeButton.className = 'dialog-close celebration-close';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Cerrar celebración');
      closeButton.textContent = '×';
      closeButton.addEventListener('click', () => {
        celebration.classList.remove('active');
        celebration.hidden = true;
      });
      celebration.append(closeButton);
    }
  }

  function createMessageDialog() {
    const existing = document.querySelector('#appMessageDialog');
    if (existing) return existing;
    const dialog = document.createElement('dialog');
    dialog.id = 'appMessageDialog';
    dialog.className = 'app-message-dialog';
    dialog.innerHTML = '<div class="app-message-icon" aria-hidden="true"></div><div class="app-message-copy"><p class="eyebrow">MINUTO 106</p><h2></h2><p class="app-message-text"></p></div><div class="app-message-actions"><button class="ghost app-message-cancel" type="button"></button><button class="primary app-message-accept" type="button"></button></div>';
    document.body.append(dialog);
    document.dispatchEvent(new CustomEvent('minuto106:dialog-created'));

    dialog.querySelector('.app-message-accept').addEventListener('click', () => settleMessage(true));
    dialog.querySelector('.app-message-cancel').addEventListener('click', () => settleMessage(false));
    dialog.addEventListener('close', () => {
      if (activeMessage) settleMessage(false, false);
    });
    return dialog;
  }

  function settleMessage(result, close = true) {
    if (!activeMessage) return;
    const current = activeMessage;
    activeMessage = null;
    const dialog = document.querySelector('#appMessageDialog');
    if (close && dialog?.open) dialog.close();
    current.resolve(result);
    queueMicrotask(showNextMessage);
  }

  function showNextMessage() {
    if (activeMessage || messageQueue.length === 0) return;
    activeMessage = messageQueue.shift();
    const dialog = createMessageDialog();
    const options = activeMessage.options;
    dialog.dataset.tone = options.tone;
    dialog.querySelector('h2').textContent = options.title;
    dialog.querySelector('.app-message-text').textContent = options.message;
    dialog.querySelector('.app-message-icon').textContent = options.tone === 'error' ? '!' : options.tone === 'success' ? '✓' : '⚽';
    const accept = dialog.querySelector('.app-message-accept');
    const cancel = dialog.querySelector('.app-message-cancel');
    accept.textContent = options.acceptLabel;
    cancel.textContent = options.cancelLabel;
    cancel.hidden = !options.cancelLabel;
    dialog.showModal();
    accept.focus();
  }

  function normalizeMessage(input, defaults) {
    const options = typeof input === 'string' ? { message: input } : input || {};
    return {
      title: String(options.title || defaults.title),
      message: String(options.message || defaults.message),
      tone: ['info', 'success', 'error'].includes(options.tone) ? options.tone : defaults.tone,
      acceptLabel: String(options.acceptLabel || defaults.acceptLabel),
      cancelLabel: options.cancelLabel === undefined ? defaults.cancelLabel : String(options.cancelLabel || ''),
    };
  }

  function enqueueMessage(options) {
    return new Promise((resolve) => {
      messageQueue.push({ options, resolve });
      showNextMessage();
    });
  }

  function normalizedShare(input) {
    const options = input && typeof input === 'object' ? input : {};
    const url = String(options.url || location.href);
    return {
      title: String(options.title || 'Minuto 106'),
      text: String(options.text || '¿Me superas en Minuto 106?'),
      url,
      combined: `${String(options.text || '¿Me superas en Minuto 106?')} ${url}`.trim(),
    };
  }

  function createShareDialog() {
    const existing = document.querySelector('#appShareDialog');
    if (existing) return existing;
    const dialog = document.createElement('dialog');
    dialog.id = 'appShareDialog';
    dialog.className = 'app-message-dialog app-share-dialog';
    dialog.innerHTML = `
      <div class="app-message-icon" aria-hidden="true">↗</div>
      <div class="app-message-copy">
        <p class="eyebrow">COMPARTE EL RETO</p>
        <h2>Elige dónde compartir</h2>
        <p class="app-message-text"></p>
      </div>
      <div class="share-destinations" aria-label="Opciones para compartir">
        <a data-share-destination="whatsapp" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a data-share-destination="x" target="_blank" rel="noopener noreferrer">X</a>
        <a data-share-destination="telegram" target="_blank" rel="noopener noreferrer">Telegram</a>
        <a data-share-destination="email">Correo</a>
      </div>`;
    document.body.append(dialog);
    document.dispatchEvent(new CustomEvent('minuto106:dialog-created'));
    return dialog;
  }

  function openShareDialog(input) {
    const options = normalizedShare(input);
    const dialog = createShareDialog();
    dialog.querySelector('h2').textContent = options.title;
    dialog.querySelector('.app-message-text').textContent = options.text;
    const encodedText = encodeURIComponent(options.combined);
    const encodedUrl = encodeURIComponent(options.url);
    const encodedTitle = encodeURIComponent(options.title);
    dialog.querySelector('[data-share-destination="whatsapp"]').href = `https://wa.me/?text=${encodedText}`;
    dialog.querySelector('[data-share-destination="x"]').href = `https://twitter.com/intent/tweet?text=${encodedText}`;
    dialog.querySelector('[data-share-destination="telegram"]').href = `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(options.text)}`;
    dialog.querySelector('[data-share-destination="email"]').href = `mailto:?subject=${encodedTitle}&body=${encodedText}`;
    dialog.showModal();
    dialog.querySelector('a')?.focus();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(false), { once: true });
    });
  }

  async function share(input) {
    const options = normalizedShare(input);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: options.title, text: options.text, url: options.url });
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return false;
      }
    }
    return openShareDialog(options);
  }

  window.Minuto106UI = {
    notify(input) {
      return enqueueMessage(normalizeMessage(input, {
        title: 'Información',
        message: '',
        tone: 'info',
        acceptLabel: 'Entendido',
        cancelLabel: '',
      }));
    },
    success(input) {
      return enqueueMessage(normalizeMessage(input, {
        title: 'Operación completada',
        message: '',
        tone: 'success',
        acceptLabel: 'Continuar',
        cancelLabel: '',
      }));
    },
    error(input) {
      return enqueueMessage(normalizeMessage(input, {
        title: 'Ha ocurrido un error',
        message: 'No se pudo completar la operación.',
        tone: 'error',
        acceptLabel: 'Cerrar',
        cancelLabel: '',
      }));
    },
    ask(input) {
      return enqueueMessage(normalizeMessage(input, {
        title: 'Confirma la acción',
        message: '',
        tone: 'info',
        acceptLabel: 'Confirmar',
        cancelLabel: 'Cancelar',
      }));
    },
    share,
  };

  function buildGameColumns() {
    const shell = document.querySelector('main.shell');
    if (!shell || shell.querySelector(':scope > .app-layout')) return;

    const layout = document.createElement('div');
    layout.className = 'app-layout';
    const leftRail = document.createElement('aside');
    leftRail.className = 'layout-rail layout-rail--left';
    leftRail.setAttribute('aria-label', 'Clasificación');
    const centerColumn = document.createElement('div');
    centerColumn.className = 'layout-center';
    const rightRail = document.createElement('aside');
    rightRail.className = 'layout-rail layout-rail--right';
    rightRail.setAttribute('aria-label', 'Premios y competición');

    const move = (selector, destination) => {
      const element = shell.querySelector(`:scope > ${selector}`);
      if (element) destination.append(element);
    };

    move('.leaderboard-card', leftRail);
    for (const selector of [
      '.game-hero',
      '.how-to-play',
      '#configWarning',
      '.battle-card',
      '.stats-strip',
      '.game-card',
      '#profileCard',
    ]) move(selector, centerColumn);
    move('#awardsCard', rightRail);
    move('#competitiveHub', rightRail);
    layout.append(leftRail, centerColumn, rightRail);
    shell.append(layout);
  }

  ensureSharedStylesheet();
  ensureHonoursEnhancement();
  renderPrivacyComponents();
  renderSiteChrome();
  enhanceDialogs();
  buildGameColumns();
  ensureComplianceEnhancement();
  document.addEventListener('minuto106:dialog-created', enhanceDialogs);
})();
