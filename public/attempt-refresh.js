(() => {
  if (window.__MINUTO106_ATTEMPT_REFRESH__) return;
  window.__MINUTO106_ATTEMPT_REFRESH__ = true;
  const previousFetch = window.fetch.bind(window);

  function rememberAttempt(detail) {
    const attempt = detail?.attempt;
    window.__MINUTO106_LATEST_ATTEMPT__ = attempt?.id ? attempt : null;
  }

  function rememberPlayerContext(detail) {
    window.__MINUTO106_PLAYER_CONTEXT__ = detail?.profile ? detail : null;
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

  function loadAchievementUnlocks() {
    if (document.getElementById('minuto106AchievementUnlocksScript')) return;
    const script = document.createElement('script');
    script.id = 'minuto106AchievementUnlocksScript';
    script.src = './achievement-unlocks.js';
    script.async = false;
    document.head.append(script);
  }

  document.addEventListener('minuto106:player-context', (event) => {
    rememberPlayerContext(event.detail);
  });
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

  loadAchievementUnlocks();
})();
