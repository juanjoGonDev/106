(() => {
  if (window.__MINUTO106_ATTEMPT_REFRESH__) return;
  window.__MINUTO106_ATTEMPT_REFRESH__ = true;
  const previousFetch = window.fetch.bind(window);

  function requestAction(input, init) {
    const body = init?.body;
    if (typeof body !== 'string') return '';
    try {
      return String(JSON.parse(body)?.action || '');
    } catch {
      return '';
    }
  }

  window.fetch = async function minuto106AttemptRefreshFetch(input, init) {
    const action = requestAction(input, init);
    const response = await previousFetch(input, init);
    if (action !== 'finish' || !response.ok) return response;

    response.clone().json().then((detail) => {
      document.dispatchEvent(new CustomEvent('minuto106:attempt-finished', { detail }));
    }).catch(() => {
      document.dispatchEvent(new CustomEvent('minuto106:attempt-finished', { detail: null }));
    });
    return response;
  };
})();