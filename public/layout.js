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

  function renderSiteChrome() {
    const header = document.querySelector('.site-header') || document.createElement('header');
    header.className = 'site-header';
    header.replaceChildren();

    const brand = document.createElement('a');
    brand.className = 'brand';
    brand.href = './';
    brand.textContent = 'MINUTO 106';

    const navigation = document.createElement('nav');
    navigation.setAttribute('aria-label', 'Navegación principal');
    for (const [page, href, label] of links) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = label;
      if (page === 'cuenta.html') anchor.className = 'account-link';
      if (activePage === page) anchor.setAttribute('aria-current', 'page');
      navigation.append(anchor);
    }
    header.append(brand, navigation);
    if (!header.isConnected) document.body.prepend(header);

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
    if (document.querySelector('#cookieDialog')) {
      const privacyButton = document.createElement('button');
      privacyButton.id = 'openCookieSettings';
      privacyButton.type = 'button';
      privacyButton.textContent = 'Gestionar cookies';
      footerNavigation.append(privacyButton);
    } else {
      const privacyLink = document.createElement('a');
      privacyLink.href = './cookies.html';
      privacyLink.textContent = 'Gestionar cookies';
      footerNavigation.append(privacyLink);
    }
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

  renderSiteChrome();
  enhanceDialogs();
  buildGameColumns();
  document.addEventListener('minuto106:dialog-created', enhanceDialogs);
})();