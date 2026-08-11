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
      return true;
    } catch {
      return false;
    }
  }

  function store(token) {
    const normalized = String(token || '').trim().toLowerCase();
    if (!TOKEN.test(normalized)) {
      clear();
      return false;
    }
    const persistent = write(localStorage, normalized);
    write(sessionStorage, normalized);
    return persistent;
  }

  function promotePersistentToken() {
    const persistent = read(localStorage);
    const tab = read(sessionStorage);
    if (persistent) write(sessionStorage, persistent);
    else if (tab) write(localStorage, tab);
  }

  function synchronizeFromTab() {
    const tab = read(sessionStorage);
    const persistent = read(localStorage);
    if (tab && tab !== persistent) write(localStorage, tab);
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
    store,
  });
})();
