(() => {
  const policy = globalThis.Minuto106NicknamePolicy;
  if (!policy) return;

  const homeInput = document.querySelector('#nick');
  const startButton = document.querySelector('#startButton');
  const status = document.querySelector('#nickStatus');
  const captchaContainer = document.querySelector('#turnstileContainer');
  let remoteAvailability = 'unknown';
  let remotePending = false;
  let applying = false;

  function structuralState(input) {
    return policy.validateNickname(input?.value ?? '');
  }

  function remoteReason(availability) {
    return String(availability ?? '').startsWith('invalid-')
      ? String(availability).slice('invalid-'.length)
      : null;
  }

  function nicknameReady() {
    const structural = structuralState(homeInput);
    return structural.valid
      && !remotePending
      && ['available', 'owned'].includes(remoteAvailability);
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
    const reason = remoteReason(remoteAvailability);
    setInputValidity(homeInput, validation);

    if (!validation.valid && status) {
      status.textContent = policy.nicknameErrorMessage(validation.reason);
    } else if (reason && status) {
      status.textContent = policy.nicknameErrorMessage(reason);
      homeInput.setCustomValidity(policy.nicknameErrorMessage(reason));
      homeInput.setAttribute('aria-invalid', 'true');
    }

    if (startButton && !nicknameReady()) startButton.disabled = true;
    if (captchaContainer) captchaContainer.hidden = !nicknameReady();
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
      if (nicknameReady()) return;
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
