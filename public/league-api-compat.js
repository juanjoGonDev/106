(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const LEGACY_READ_ACTIONS = new Set(['league', 'league-status', 'player-leagues']);
  const RETRYABLE_STATUS = new Set([404, 502, 503, 504]);

  function requestAction(init) {
    if (typeof init?.body !== 'string') return '';
    try {
      return String(JSON.parse(init.body)?.action ?? '');
    } catch {
      return '';
    }
  }

  function leagueApiUrl(input) {
    const raw = input instanceof Request ? input.url : String(input ?? '');
    try {
      const url = new URL(raw, location.href);
      return url.pathname.endsWith('/league-api') ? url : null;
    } catch {
      return null;
    }
  }

  function legacyUrl(url) {
    const fallback = new URL(url);
    fallback.pathname = fallback.pathname.replace(/\/league-api$/, '/game-api');
    return fallback.toString();
  }

  async function fetchWithLeagueCompatibility(input, init) {
    const url = leagueApiUrl(input);
    const action = requestAction(init);
    if (!url || !LEGACY_READ_ACTIONS.has(action)) return nativeFetch(input, init);

    try {
      const response = await nativeFetch(input, init);
      if (!RETRYABLE_STATUS.has(response.status)) return response;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }

    return nativeFetch(legacyUrl(url), init);
  }

  globalThis.fetch = fetchWithLeagueCompatibility;
})();
