(() => {
  const KEY = 'minuto106.zadmin.session.v1';
  const TOKEN = /^[a-f0-9]{64}$/i;

  function read(storage) {
    try {
      const value = String(storage.getItem(KEY) || '').trim().toLowerCase();
      if (TOKEN.test(value)) return value;
      storage.removeItem(KEY);
    } catch {
      // Hardened browser storage can be unavailable. Server validation remains authoritative.
    }
    return '';
  }

  function write(storage, token) {
    try {
      if (TOKEN.test(token)) storage.setItem(KEY, token);
      else storage.removeItem(KEY);
    } catch {
      // Persistence is best-effort; an in-memory/server session can still work.
    }
  }

  function promotePersistentToken() {
    const persistent = read(localStorage);
    const tab = read(sessionStorage);
    if (!tab && persistent) write(sessionStorage, persistent);
    if (tab && !persistent) write(localStorage, tab);
  }

  function synchronizeFromTab() {
    const tab = read(sessionStorage);
    if (tab) write(localStorage, tab);
    else write(localStorage, '');
  }

  function clear() {
    write(sessionStorage, '');
    write(localStorage, '');
  }

  function observeState() {
    const targets = [
      document.querySelector('#adminDashboard'),
      document.querySelector('#adminLoginPanel'),
      document.querySelector('#managementDashboard'),
      document.querySelector('#managementDenied'),
    ].filter((element) => element instanceof HTMLElement);
    if (!targets.length) return;

    const observer = new MutationObserver(() => synchronizeFromTab());
    for (const target of targets) observer.observe(target, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('pagehide', synchronizeFromTab);
  }

  promotePersistentToken();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeState, { once: true });
  else observeState();

  globalThis.Minuto106ZadminSessionPersistence = Object.freeze({
    clear,
    flush: synchronizeFromTab,
    read: () => read(localStorage) || read(sessionStorage),
  });
})();
