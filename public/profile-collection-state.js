(() => {
  const DEFAULT_PAGE_SIZE = 10;
  const MAX_PAGE_SIZE = 50;
  const REPEATED_ACHIEVEMENT_KINDS = new Set([
    'daily_hat_trick',
    'first_of_month',
    'league_podium',
  ]);

  function integer(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }

  function normalizePageSize(value, fallback = DEFAULT_PAGE_SIZE) {
    const normalizedFallback = Math.max(1, Math.min(MAX_PAGE_SIZE, integer(fallback, DEFAULT_PAGE_SIZE)));
    return Math.max(1, Math.min(MAX_PAGE_SIZE, integer(value, normalizedFallback)));
  }

  function paginate(items, requestedPage = 1, requestedPageSize = DEFAULT_PAGE_SIZE) {
    const source = Array.isArray(items) ? items : [];
    const pageSize = normalizePageSize(requestedPageSize);
    const total = source.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.max(1, Math.min(pageCount, integer(requestedPage, 1)));
    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(total, startIndex + pageSize);

    return Object.freeze({
      items: source.slice(startIndex, endIndex),
      page,
      pageCount,
      pageSize,
      total,
      start: total === 0 ? 0 : startIndex + 1,
      end: endIndex,
      hasPrevious: page > 1,
      hasNext: page < pageCount,
    });
  }

  function movePage(currentPage, direction, totalItems, requestedPageSize = DEFAULT_PAGE_SIZE) {
    const state = paginate(new Array(Math.max(0, integer(totalItems, 0))), currentPage, requestedPageSize);
    const delta = direction === 'previous' ? -1 : direction === 'next' ? 1 : 0;
    return Math.max(1, Math.min(state.pageCount, state.page + delta));
  }

  function achievementFamilyKey(item) {
    const kind = String(item?.kind || '').trim();
    if (REPEATED_ACHIEVEMENT_KINDS.has(kind)) return `kind:${kind}`;
    const code = String(item?.code || '').trim();
    return code ? `code:${code}` : '';
  }

  function achievementOccurrenceDates(achievement, rawItems) {
    const familyKey = achievementFamilyKey(achievement);
    if (!familyKey) return [];

    const dates = new Set();
    for (const item of Array.isArray(rawItems) ? rawItems : []) {
      if (achievementFamilyKey(item) !== familyKey) continue;
      const date = String(item?.date || '').trim();
      if (date) dates.add(date);
    }
    return [...dates].sort((left, right) => right.localeCompare(left));
  }

  function isRepeatedAchievement(item) {
    return REPEATED_ACHIEVEMENT_KINDS.has(String(item?.kind || '').trim());
  }

  window.Minuto106ProfileCollections = Object.freeze({
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    normalizePageSize,
    paginate,
    movePage,
    achievementFamilyKey,
    achievementOccurrenceDates,
    isRepeatedAchievement,
  });
})();
