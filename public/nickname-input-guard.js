(() => {
  const policy = globalThis.Minuto106NicknamePolicy;
  const controllerOwner = globalThis.Minuto106NicknameFieldController;
  if (!policy) return;

  const homeInput = document.querySelector('#nick');
  const startButton = document.querySelector('#startButton');
  const status = document.querySelector('#nickStatus');
  const captchaContainer = document.querySelector('#turnstileContainer');
  const nativeHeadAppend = document.head.append;
  const deferredCaptchaNodes = [];
  const structuralControllers = new Map();
  let remoteAvailability = 'unknown';
  let remotePending = false;
  let applying = false;
  let captchaReleased = false;

  function structuralState(input) {
    const controller = structuralControllers.get(input);
    return controller?.getValidation?.() ?? policy.validateNickname(input?.value ?? '');
  }

  function currentGate() {
    return policy.resolveNicknameGate({
      validation: structuralState(homeInput),
      remoteAvailability,
      remotePending,
    });
  }

  function isTurnstileScript(node) {
    return node instanceof HTMLScriptElement
      && new URL(node.src, location.href).hostname === 'challenges.cloudflare.com';
  }

  function releaseCaptchaScripts() {
    if (captchaReleased || !currentGate().captchaAllowed) return;
    captchaReleased = true;
    document.head.append = nativeHeadAppend;
    if (deferredCaptchaNodes.length) nativeHeadAppend.apply(document.head, deferredCaptchaNodes.splice(0));
  }

  function deferCaptchaScripts() {
    if (!homeInput) return;
    document.head.append = function appendWithNicknameGate(...nodes) {
      const immediate = [];
      for (const node of nodes) {
        if (!captchaReleased && isTurnstileScript(node)) deferredCaptchaNodes.push(node);
        else immediate.push(node);
      }
      if (immediate.length) nativeHeadAppend.apply(document.head, immediate);
    };
  }

  function applyHomeGate() {
    if (!homeInput || applying) return;
    applying = true;
    const gate = currentGate();
    if (gate.reason && status) {
      const message = policy.nicknameErrorMessage(gate.reason);
      status.textContent = message;
      homeInput.setCustomValidity(message);
      homeInput.setAttribute('aria-invalid', 'true');
    }

    // This guard may block Start, but it never enables it. Competition, daily-limit
    // and readiness owners remain authoritative for releasing the control.
    if (startButton && !gate.startAllowed && !startButton.disabled) startButton.disabled = true;
    if (captchaContainer && captchaContainer.hidden !== !gate.captchaAllowed) {
      captchaContainer.hidden = !gate.captchaAllowed;
    }
    if (gate.captchaAllowed) releaseCaptchaScripts();
    applying = false;
  }

  function rejectInvalidEvent(event, input) {
    const validation = structuralState(input);
    if (validation.valid) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    structuralControllers.get(input)?.refresh?.();
    input.focus();
    input.reportValidity();
    return true;
  }

  function bindStructural(input, options = {}) {
    if (!input || !controllerOwner) return null;
    const controller = controllerOwner.bindStructural({ input, ...options });
    structuralControllers.set(input, controller);
    return controller;
  }

  deferCaptchaScripts();

  if (!controllerOwner) {
    if (homeInput) {
      if (startButton && !startButton.disabled) startButton.disabled = true;
      if (captchaContainer && !captchaContainer.hidden) captchaContainer.hidden = true;
      if (status) status.textContent = 'No se pudo cargar la validación del nick. Recarga la página para continuar.';
    }
    return;
  }

  if (homeInput) {
    const observer = new MutationObserver(() => queueMicrotask(applyHomeGate));
    if (startButton) observer.observe(startButton, { attributes: true, attributeFilter: ['disabled'] });
    if (captchaContainer) observer.observe(captchaContainer, { attributes: true, attributeFilter: ['hidden'] });

    bindStructural(homeInput, {
      status,
      idleMessage: 'Escribe tu nick para comprobar su disponibilidad y tus competiciones.',
      onStateChange(validation) {
        remoteAvailability = 'unknown';
        remotePending = validation.valid;
        applyHomeGate();
      },
    });

    document.addEventListener('minuto106:player-context', (event) => {
      const detail = event.detail ?? {};
      remoteAvailability = String(detail.availability ?? 'unknown');
      remotePending = detail.pending === true;
      applyHomeGate();
    });

    startButton?.addEventListener('click', (event) => {
      if (currentGate().startAllowed) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      applyHomeGate();
      homeInput.focus();
      homeInput.reportValidity();
    }, { capture: true });

    applyHomeGate();
  }

  const rankingInput = document.querySelector('#rankingSearch');
  bindStructural(rankingInput);
  document.querySelector('#rankingSearchButton')?.addEventListener('click', (event) => {
    rejectInvalidEvent(event, rankingInput);
  }, { capture: true });
  rankingInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') rejectInvalidEvent(event, rankingInput);
  }, { capture: true });

  for (const selector of ['#leagueNick', '#leagueDetailNick']) {
    bindStructural(document.querySelector(selector));
  }
  for (const formSelector of ['#createLeagueForm', '#joinLeagueForm']) {
    document.querySelector(formSelector)?.addEventListener('submit', (event) => {
      const detailNick = document.querySelector('#leagueDetailNick');
      const input = detailNick?.value ? detailNick : document.querySelector('#leagueNick');
      rejectInvalidEvent(event, input);
    }, { capture: true });
  }
})();
