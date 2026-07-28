(() => {
  const policy = globalThis.Minuto106NicknamePolicy;
  if (!policy) return;

  const homeInput = document.querySelector('#nick');
  const startButton = document.querySelector('#startButton');
  const status = document.querySelector('#nickStatus');
  const captchaContainer = document.querySelector('#turnstileContainer');
  const nativeHeadAppend = document.head.append;
  const deferredCaptchaNodes = [];
  let remoteAvailability = 'unknown';
  let remotePending = false;
  let applying = false;
  let captchaReleased = false;

  function structuralState(input) {
    return policy.validateNickname(input?.value ?? '');
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

  function setInputValidity(input, validation) {
    if (!input) return;
    const message = validation.valid ? '' : policy.nicknameErrorMessage(validation.reason);
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(!validation.valid));
  }

  function applyHomeGate() {
    if (!homeInput || applying) return;
    applying = true;
    const validation = structuralState(homeInput);
    const gate = currentGate();
    setInputValidity(homeInput, validation);

    if (gate.reason && status) {
      const message = policy.nicknameErrorMessage(gate.reason);
      status.textContent = message;
      homeInput.setCustomValidity(message);
      homeInput.setAttribute('aria-invalid', 'true');
    }

    if (startButton && startButton.disabled !== !gate.startAllowed) {
      startButton.disabled = !gate.startAllowed;
    }
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
    setInputValidity(input, validation);
    input.focus();
    input.reportValidity();
    return true;
  }

  function bindSimpleInput(input) {
    if (!input) return;
    const refresh = () => setInputValidity(input, structuralState(input));
    input.addEventListener('input', refresh, { capture: true });
    input.addEventListener('change', refresh, { capture: true });
    refresh();
  }

  if (homeInput) {
    deferCaptchaScripts();
    homeInput.addEventListener('input', () => {
      remoteAvailability = 'unknown';
      remotePending = structuralState(homeInput).valid;
      applyHomeGate();
    }, { capture: true });

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

    const observer = new MutationObserver(() => queueMicrotask(applyHomeGate));
    if (startButton) observer.observe(startButton, { attributes: true, attributeFilter: ['disabled'] });
    if (captchaContainer) observer.observe(captchaContainer, { attributes: true, attributeFilter: ['hidden'] });
    applyHomeGate();
  }

  const rankingInput = document.querySelector('#rankingSearch');
  bindSimpleInput(rankingInput);
  document.querySelector('#rankingSearchButton')?.addEventListener('click', (event) => {
    rejectInvalidEvent(event, rankingInput);
  }, { capture: true });
  rankingInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') rejectInvalidEvent(event, rankingInput);
  }, { capture: true });

  for (const selector of ['#leagueNick', '#leagueDetailNick']) {
    bindSimpleInput(document.querySelector(selector));
  }
  for (const formSelector of ['#createLeagueForm', '#joinLeagueForm']) {
    document.querySelector(formSelector)?.addEventListener('submit', (event) => {
      const input = document.querySelector('#leagueDetailNick')?.value
        ? document.querySelector('#leagueDetailNick')
        : document.querySelector('#leagueNick');
      rejectInvalidEvent(event, input);
    }, { capture: true });
  }
})();
