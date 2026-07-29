(() => {
  const policy = globalThis.Minuto106NicknamePolicy;

  function endpoint(apiBaseUrl) {
    const base = String(apiBaseUrl ?? '').trim().replace(/\/$/u, '');
    return base.replace(/\/game-api$/u, '/player-context');
  }

  async function check({ apiBaseUrl, nick, fetchFn = globalThis.fetch, headers = {} } = {}) {
    if (!policy) throw new Error('No se pudo cargar la política de nicks.');
    const validation = policy.validateNickname(nick);
    if (!validation.valid) {
      return Object.freeze({
        availability: `invalid-${validation.reason}`,
        validation,
        profile: null,
        leagues: Object.freeze([]),
      });
    }

    const url = endpoint(apiBaseUrl);
    if (!url || url === String(apiBaseUrl ?? '').replace(/\/$/u, '')) {
      throw new Error('No se pudo preparar la comprobación del nick.');
    }
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ action: 'player-context', nick: validation.normalized }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'No se pudo comprobar el nick.');
    return Object.freeze({
      availability: String(payload.availability || 'unknown'),
      validation,
      profile: payload.profile ?? null,
      leagues: Object.freeze(Array.isArray(payload.leagues) ? payload.leagues : []),
    });
  }

  function createDebouncedLookup({ delay = 350, checkFn = check, timers = globalThis } = {}) {
    let timer = null;
    let sequence = 0;

    function cancel() {
      sequence += 1;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    }

    function schedule(input, callbacks = {}) {
      cancel();
      const request = sequence;
      callbacks.onPending?.(input);
      timer = timers.setTimeout(async () => {
        timer = null;
        try {
          const result = await checkFn(input);
          if (request !== sequence) return;
          callbacks.onResult?.(result);
        } catch (error) {
          if (request !== sequence) return;
          callbacks.onError?.(error);
        } finally {
          if (request === sequence) callbacks.onSettled?.();
        }
      }, delay);
    }

    return Object.freeze({ cancel, schedule });
  }

  globalThis.Minuto106NicknameAvailability = Object.freeze({
    check,
    createDebouncedLookup,
    endpoint,
  });
})();
