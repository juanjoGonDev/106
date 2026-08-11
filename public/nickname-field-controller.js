(() => {
  const policy = globalThis.Minuto106NicknamePolicy;
  const availabilityOwner = globalThis.Minuto106NicknameAvailability;
  if (!policy || !availabilityOwner) return;

  function defaultAvailabilityMessage(availability) {
    if (availability === 'available') return { message: 'Nick disponible.', tone: 'success' };
    if (availability === 'owned') return { message: 'Ese es el nick actual de este jugador.', tone: 'warning' };
    if (availability === 'occupied') return { message: 'Ese nick ya está ocupado.', tone: 'error' };
    if (String(availability).startsWith('invalid-')) {
      return {
        message: policy.nicknameErrorMessage(String(availability).slice('invalid-'.length)),
        tone: 'error',
      };
    }
    return { message: 'No se pudo confirmar la disponibilidad.', tone: 'error' };
  }

  function setStatus(status, message, tone = '') {
    if (!status) return;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function create({
    input,
    status,
    submitButton = null,
    checkFn,
    delay = 350,
    pendingMessage = 'Comprobando disponibilidad y contenido…',
    readyMessage = 'Nick disponible.',
    idleMessage = 'Escribe un nick para comprobarlo.',
    availabilityMessage = defaultAvailabilityMessage,
    onStateChange = null,
  } = {}) {
    if (!(input instanceof HTMLInputElement) || typeof checkFn !== 'function') {
      throw new TypeError('Nickname field controller requires an input and checkFn.');
    }

    let availability = 'unknown';
    let pending = false;
    let destroyed = false;
    const lookup = availabilityOwner.createDebouncedLookup({ delay, checkFn });

    function validation() {
      return policy.validateNickname(input.value);
    }

    function state() {
      const local = validation();
      return Object.freeze({
        validation: local,
        availability,
        pending,
        ready: local.valid && !pending && availability === 'available',
      });
    }

    function apply(nextMessage = null) {
      const current = state();
      input.setAttribute('aria-invalid', String(!current.validation.valid || (!current.pending && ['occupied'].includes(current.availability))));
      if (submitButton) submitButton.disabled = !current.ready;

      if (nextMessage) {
        setStatus(status, nextMessage.message, nextMessage.tone);
      } else if (!input.value.trim()) {
        setStatus(status, idleMessage);
      } else if (!current.validation.valid) {
        setStatus(status, policy.nicknameErrorMessage(current.validation.reason), 'error');
      } else if (current.pending) {
        setStatus(status, pendingMessage);
      } else if (current.availability === 'available') {
        setStatus(status, readyMessage, 'success');
      } else if (current.availability !== 'unknown') {
        setStatus(status, availabilityMessage(current.availability).message, availabilityMessage(current.availability).tone);
      }
      onStateChange?.(current);
      return current;
    }

    function refresh() {
      if (destroyed) return state();
      lookup.cancel();
      availability = 'unknown';
      pending = false;
      const local = validation();
      if (!input.value.trim() || !local.valid) return apply();

      pending = true;
      apply();
      lookup.schedule({ nick: local.normalized }, {
        onResult(result) {
          availability = String(result?.availability ?? 'unknown');
          pending = false;
          apply();
        },
        onError(error) {
          availability = 'unknown';
          pending = false;
          apply({
            message: error instanceof Error ? error.message : 'No se pudo comprobar el nick.',
            tone: 'error',
          });
        },
      });
      return state();
    }

    function normalizedValue() {
      const local = validation();
      return local.valid ? local.normalized : '';
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      lookup.cancel();
      input.removeEventListener('input', refresh);
    }

    input.addEventListener('input', refresh);
    apply();

    return Object.freeze({
      destroy,
      getState: state,
      isReady: () => state().ready,
      normalizedValue,
      refresh,
    });
  }

  globalThis.Minuto106NicknameFieldController = Object.freeze({
    create,
    defaultAvailabilityMessage,
  });
})();
