import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/profile-collection-state.js', import.meta.url), 'utf8');

function load() {
  const window = {};
  vm.runInNewContext(source, { window, Array, Math, Number, Object, Set, String }, {
    filename: 'public/profile-collection-state.js',
  });
  return window.Minuto106ProfileCollections;
}

function plain(value) {
  return structuredClone(value);
}

test('normalizes page size into the bounded supported range', () => {
  const api = load();
  assert.equal(api.normalizePageSize(undefined), 10);
  assert.equal(api.normalizePageSize('12'), 12);
  assert.equal(api.normalizePageSize(0), 1);
  assert.equal(api.normalizePageSize(-5), 1);
  assert.equal(api.normalizePageSize(999), 50);
  assert.equal(api.normalizePageSize('invalid', 7), 7);
  assert.equal(api.normalizePageSize('invalid', 'invalid'), 10);
  assert.equal(api.normalizePageSize('invalid', 100), 50);
});

test('paginates empty, exact and overflow collections deterministically', () => {
  const api = load();
  assert.deepEqual(plain(api.paginate(null)), {
    items: [], page: 1, pageCount: 1, pageSize: 10, total: 0,
    start: 0, end: 0, hasPrevious: false, hasNext: false,
  });

  const ten = Array.from({ length: 10 }, (_, index) => index + 1);
  assert.deepEqual(plain(api.paginate(ten, 1, 10)), {
    items: ten, page: 1, pageCount: 1, pageSize: 10, total: 10,
    start: 1, end: 10, hasPrevious: false, hasNext: false,
  });

  const eleven = [...ten, 11];
  assert.deepEqual(plain(api.paginate(eleven, 2, 10)), {
    items: [11], page: 2, pageCount: 2, pageSize: 10, total: 11,
    start: 11, end: 11, hasPrevious: true, hasNext: false,
  });
});

test('clamps invalid and stale pages when a collection shrinks', () => {
  const api = load();
  const items = ['a', 'b', 'c'];
  assert.equal(api.paginate(items, -10, 2).page, 1);
  assert.equal(api.paginate(items, Number.NaN, 2).page, 1);
  const stale = api.paginate(items, 99, 2);
  assert.equal(stale.page, 2);
  assert.deepEqual(plain(stale.items), ['c']);
});

test('moves only to supported neighboring pages', () => {
  const api = load();
  assert.equal(api.movePage(1, 'previous', 25, 10), 1);
  assert.equal(api.movePage(1, 'next', 25, 10), 2);
  assert.equal(api.movePage(2, 'next', 25, 10), 3);
  assert.equal(api.movePage(3, 'next', 25, 10), 3);
  assert.equal(api.movePage(2, 'previous', 25, 10), 1);
  assert.equal(api.movePage(2, 'unknown', 25, 10), 2);
  assert.equal(api.movePage('bad', 'next', -1, 10), 1);
});

test('groups only repeatable achievement families while preserving milestone identities', () => {
  const api = load();
  assert.equal(api.achievementFamilyKey({ kind: 'daily_hat_trick', code: 'daily_hat_trick_2026-08-01' }), 'kind:daily_hat_trick');
  assert.equal(api.achievementFamilyKey({ kind: 'first_of_month', code: 'first_of_month_2026-08' }), 'kind:first_of_month');
  assert.equal(api.achievementFamilyKey({ kind: 'league_podium', code: 'league_podium_ABC123' }), 'kind:league_podium');
  assert.equal(api.achievementFamilyKey({ kind: 'perfect_total', code: 'perfect_total_1' }), 'code:perfect_total_1');
  assert.equal(api.achievementFamilyKey({ code: 'custom' }), 'code:custom');
  assert.equal(api.achievementFamilyKey({}), '');
  assert.equal(api.achievementFamilyKey(null), '');

  assert.equal(api.isRepeatedAchievement({ kind: 'daily_hat_trick' }), true);
  assert.equal(api.isRepeatedAchievement({ kind: 'perfect_total' }), false);
  assert.equal(api.isRepeatedAchievement(null), false);
});

test('returns repeat occurrence dates deduplicated and newest first', () => {
  const api = load();
  const achievement = { kind: 'daily_hat_trick', code: 'daily_hat_trick_2026-08-03' };
  const dates = api.achievementOccurrenceDates(achievement, [
    { kind: 'daily_hat_trick', code: 'one', date: '2026-08-01' },
    { kind: 'daily_hat_trick', code: 'two', date: '2026-08-03' },
    { kind: 'daily_hat_trick', code: 'three', date: '2026-08-02' },
    { kind: 'daily_hat_trick', code: 'duplicate', date: '2026-08-03' },
    { kind: 'daily_hat_trick', code: 'missing-date', date: '' },
    { kind: 'first_of_month', code: 'other', date: '2026-08-04' },
  ]);
  assert.deepEqual(plain(dates), ['2026-08-03', '2026-08-02', '2026-08-01']);

  assert.deepEqual(plain(api.achievementOccurrenceDates({ kind: 'perfect_total', code: 'perfect_total_1' }, [
    { kind: 'perfect_total', code: 'perfect_total_1', date: '2026-08-02' },
    { kind: 'perfect_total', code: 'perfect_total_3', date: '2026-08-03' },
  ])), ['2026-08-02']);
  assert.deepEqual(plain(api.achievementOccurrenceDates({}, [])), []);
  assert.deepEqual(plain(api.achievementOccurrenceDates(null, null)), []);
});
