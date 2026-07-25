(() => {
  const DEFAULT_DISPLAY_MS = 3_200;
  const DEFAULT_EXIT_MS = 420;
  const STYLESHEET_ID = 'minuto106AchievementUnlockStyles';
  const STYLESHEET_NAME = 'v17.css';

  function achievementItems(profile) {
    const items = profile?.achievements?.items;
    return Array.isArray(items) ? items : [];
  }

  function normalizeAchievement(item) {
    if (!item || typeof item !== 'object') return null;
    const code = String(item.code || '').trim();
    if (!code) return null;
    const points = Number(item.points);
    return {
      code,
      title: String(item.title || 'Logro desbloqueado'),
      description: String(item.description || ''),
      points: Number.isFinite(points) && points > 0 ? points : null,
    };
  }

  function findNewAchievements(previousProfile, nextProfile) {
    const previousCodes = new Set(
      achievementItems(previousProfile)
        .map(normalizeAchievement)
        .filter(Boolean)
        .map((achievement) => achievement.code),
    );
    const seen = new Set();
    const unlocked = [];

    for (const item of achievementItems(nextProfile)) {
      const achievement = normalizeAchievement(item);
      if (!achievement || previousCodes.has(achievement.code) || seen.has(achievement.code)) continue;
      seen.add(achievement.code);
      unlocked.push(achievement);
    }
    return unlocked;
  }

  function achievementStylesheetUrl(documentRef) {
    const scriptUrl = String(documentRef.currentScript?.src || '');
    return scriptUrl ? new URL(STYLESHEET_NAME, scriptUrl).toString() : STYLESHEET_NAME;
  }

  function ensureAchievementUnlockStyles(documentRef) {
    const existing = documentRef.getElementById(STYLESHEET_ID);
    if (existing) return existing;
    const stylesheet = documentRef.createElement('link');
    stylesheet.id = STYLESHEET_ID;
    stylesheet.rel = 'stylesheet';
    stylesheet.href = achievementStylesheetUrl(documentRef);
    documentRef.head.append(stylesheet);
    return stylesheet;
  }

  function element(documentRef, tagName, className, text = '') {
    const node = documentRef.createElement(tagName);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function createAchievementUnlockView(documentRef) {
    const root = element(documentRef, 'aside', 'achievement-unlock');
    root.hidden = true;
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-atomic', 'true');

    const badge = element(documentRef, 'div', 'achievement-unlock__badge');
    badge.setAttribute('aria-hidden', 'true');
    const icon = element(documentRef, 'span', 'achievement-unlock__icon', '★');
    badge.append(icon);

    const copy = element(documentRef, 'div', 'achievement-unlock__copy');
    const kicker = element(documentRef, 'span', 'achievement-unlock__kicker', 'LOGRO DESBLOQUEADO');
    const title = element(documentRef, 'strong', 'achievement-unlock__title');
    const description = element(documentRef, 'p', 'achievement-unlock__description');
    const points = element(documentRef, 'span', 'achievement-unlock__points');
    copy.append(kicker, title, description, points);

    const shine = element(documentRef, 'span', 'achievement-unlock__shine');
    shine.setAttribute('aria-hidden', 'true');
    root.append(badge, copy, shine);
    documentRef.body.append(root);
    return { root, title, description, points };
  }

  function createAchievementUnlockNotifier({
    view,
    schedule = window.setTimeout.bind(window),
    cancel = window.clearTimeout.bind(window),
    frame = window.requestAnimationFrame.bind(window),
    displayMs = DEFAULT_DISPLAY_MS,
    exitMs = DEFAULT_EXIT_MS,
  }) {
    const queue = [];
    let active = false;
    let destroyed = false;
    let timer = null;

    function render(achievement) {
      view.title.textContent = achievement.title;
      view.description.textContent = achievement.description;
      view.points.hidden = achievement.points === null;
      view.points.textContent = achievement.points === null ? '' : `+${achievement.points} PUNTOS`;
    }

    function showNext() {
      if (destroyed || active) return;
      const achievement = queue.shift();
      if (!achievement) {
        view.root.hidden = true;
        return;
      }

      active = true;
      render(achievement);
      view.root.hidden = false;
      view.root.classList.remove('is-leaving');
      frame(() => {
        if (!destroyed) view.root.classList.add('is-visible');
      });
      timer = schedule(() => {
        view.root.classList.remove('is-visible');
        view.root.classList.add('is-leaving');
        timer = schedule(() => {
          timer = null;
          active = false;
          view.root.hidden = true;
          view.root.classList.remove('is-leaving');
          showNext();
        }, exitMs);
      }, displayMs);
    }

    function enqueue(achievements, { delayMs = 0 } = {}) {
      const valid = Array.isArray(achievements) ? achievements.filter(Boolean) : [];
      queue.push(...valid);
      if (valid.length === 0 || active || timer !== null || destroyed) return valid.length;
      if (delayMs > 0) {
        timer = schedule(() => {
          timer = null;
          showNext();
        }, delayMs);
      } else {
        showNext();
      }
      return valid.length;
    }

    function destroy() {
      destroyed = true;
      queue.length = 0;
      if (timer !== null) cancel(timer);
      timer = null;
      view.root.remove();
    }

    return Object.freeze({ enqueue, destroy });
  }

  function profileFromContext(detail) {
    return detail?.profile?.achievements ? detail.profile : null;
  }

  function notificationDelay(achievement) {
    if (achievement?.isWorldRecord) return 3_600;
    if (achievement?.enteredTop10) return 2_200;
    return 350;
  }

  function bootAchievementUnlocks(windowRef, documentRef) {
    if (windowRef.__MINUTO106_ACHIEVEMENT_UNLOCKS_BOOTED__) {
      return windowRef.Minuto106AchievementUnlockNotifier;
    }
    windowRef.__MINUTO106_ACHIEVEMENT_UNLOCKS_BOOTED__ = true;
    ensureAchievementUnlockStyles(documentRef);

    const notifier = createAchievementUnlockNotifier({
      view: createAchievementUnlockView(documentRef),
      schedule: windowRef.setTimeout.bind(windowRef),
      cancel: windowRef.clearTimeout.bind(windowRef),
      frame: windowRef.requestAnimationFrame.bind(windowRef),
    });
    let previousProfile = profileFromContext(windowRef.__MINUTO106_PLAYER_CONTEXT__);

    documentRef.addEventListener('minuto106:player-context', (event) => {
      previousProfile = profileFromContext(event.detail);
    });
    documentRef.addEventListener('minuto106:attempt-finished', (event) => {
      const nextProfile = event.detail?.profile;
      if (!nextProfile?.achievements) return;
      const unlocked = findNewAchievements(previousProfile, nextProfile);
      previousProfile = nextProfile;
      notifier.enqueue(unlocked, { delayMs: notificationDelay(event.detail?.achievement) });
    });

    windowRef.Minuto106AchievementUnlockNotifier = notifier;
    return notifier;
  }

  window.Minuto106AchievementUnlocks = Object.freeze({
    findNewAchievements,
    achievementStylesheetUrl,
    ensureAchievementUnlockStyles,
    createAchievementUnlockView,
    createAchievementUnlockNotifier,
    notificationDelay,
    bootAchievementUnlocks,
  });
  bootAchievementUnlocks(window, document);
})();
