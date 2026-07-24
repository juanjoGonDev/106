(() => {
  if (window.__MINUTO106_ATTEMPT_REFRESH__) return;
  window.__MINUTO106_ATTEMPT_REFRESH__ = true;
  const previousFetch = window.fetch.bind(window);

  function rememberAttempt(detail) {
    const attempt = detail?.attempt;
    window.__MINUTO106_LATEST_ATTEMPT__ = attempt?.id ? attempt : null;
  }

  function requestAction(init) {
    const body = init?.body;
    if (typeof body !== 'string') return '';
    try {
      return String(JSON.parse(body)?.action || '');
    } catch {
      return '';
    }
  }

  document.addEventListener('minuto106:attempt-finished', (event) => {
    rememberAttempt(event.detail);
  });

  window.fetch = async function minuto106AttemptRefreshFetch(input, init) {
    const action = requestAction(init);
    const response = await previousFetch(input, init);
    if (action !== 'finish' || !response.ok) return response;

    response.clone().json().then((detail) => {
      rememberAttempt(detail);
      document.dispatchEvent(new CustomEvent('minuto106:attempt-finished', { detail }));
    }).catch(() => {
      rememberAttempt(null);
      document.dispatchEvent(new CustomEvent('minuto106:attempt-finished', { detail: null }));
    });
    return response;
  };
})();
