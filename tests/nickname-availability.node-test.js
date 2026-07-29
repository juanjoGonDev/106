import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const policySource = readFileSync(new URL('../public/nickname-policy.js', import.meta.url), 'utf8');
const availabilitySource = readFileSync(new URL('../public/nickname-availability.js', import.meta.url), 'utf8');

function service(overrides = {}) {
  const context = {
    Array,
    Error,
    JSON,
    Map,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    fetch: overrides.fetch,
    setTimeout: overrides.setTimeout,
    clearTimeout: overrides.clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(policySource, context, { filename: 'public/nickname-policy.js' });
  vm.runInNewContext(availabilitySource, context, { filename: 'public/nickname-availability.js' });
  return context.Minuto106NicknameAvailability;
}

test('builds the player-context endpoint and rejects invalid nicknames locally', async () => {
  const api = service();
  assert.equal(api.endpoint('https://project.supabase.co/functions/v1/game-api/'), 'https://project.supabase.co/functions/v1/player-context');
  const result = await api.check({ apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api', nick: '..' });
  assert.equal(result.availability, 'invalid-too_short');
  assert.equal(result.profile, null);
  assert.deepEqual([...result.leagues], []);
  assert.ok(Object.isFrozen(result));
});

test('calls the bounded player context contract and normalizes success', async () => {
  let request;
  const api = service();
  const result = await api.check({
    apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
    nick: ' Jugador106 ',
    headers: { 'x-account-token': 'token' },
    fetchFn: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ availability: 'available', profile: null, leagues: [{ publicId: 'ABC123' }] }),
      };
    },
  });
  assert.match(request.url, /player-context$/);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['x-account-token'], 'token');
  assert.deepEqual(JSON.parse(request.options.body), { action: 'player-context', nick: 'Jugador106' });
  assert.equal(result.availability, 'available');
  assert.equal(result.validation.normalized, 'Jugador106');
  assert.deepEqual([...result.leagues], [{ publicId: 'ABC123' }]);
});

test('fails closed for missing endpoints and unsuccessful responses', async () => {
  const api = service();
  await assert.rejects(() => api.check({ apiBaseUrl: '', nick: 'Jugador106' }), /preparar/);
  await assert.rejects(() => api.check({
    apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
    nick: 'Jugador106',
    fetchFn: async () => ({ ok: false, json: async () => ({ error: 'Falló' }) }),
  }), /Falló/);
  await assert.rejects(() => api.check({
    apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
    nick: 'Jugador106',
    fetchFn: async () => ({ ok: false, json: async () => { throw new Error('bad json'); } }),
  }), /No se pudo comprobar/);
  const unknown = await api.check({
    apiBaseUrl: 'https://project.supabase.co/functions/v1/game-api',
    nick: 'Jugador106',
    fetchFn: async () => ({ ok: true, json: async () => ({ leagues: 'invalid' }) }),
  });
  assert.equal(unknown.availability, 'unknown');
  assert.deepEqual([...unknown.leagues], []);
});

test('debounces, cancels and suppresses stale results deterministically', async () => {
  const scheduled = [];
  const cleared = [];
  const api = service();
  const lookup = api.createDebouncedLookup({
    delay: 10,
    checkFn: async (input) => ({ availability: input.nick }),
    timers: {
      setTimeout(callback, delay) {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
      clearTimeout(id) { cleared.push(id); },
    },
  });
  const events = [];
  lookup.schedule({ nick: 'first' }, {
    onPending: ({ nick }) => events.push(`pending:${nick}`),
    onResult: ({ availability }) => events.push(`result:${availability}`),
    onSettled: () => events.push('settled:first'),
  });
  lookup.schedule({ nick: 'second' }, {
    onPending: ({ nick }) => events.push(`pending:${nick}`),
    onResult: ({ availability }) => events.push(`result:${availability}`),
    onSettled: () => events.push('settled:second'),
  });
  assert.deepEqual(cleared, [1]);
  assert.equal(scheduled[1].delay, 10);
  await scheduled[0].callback();
  await scheduled[1].callback();
  assert.deepEqual(events, ['pending:first', 'pending:second', 'result:second', 'settled:second']);
  lookup.cancel();
});

test('reports current lookup errors and always settles', async () => {
  let callback;
  const api = service();
  const lookup = api.createDebouncedLookup({
    checkFn: async () => { throw new Error('network'); },
    timers: {
      setTimeout(value) { callback = value; return 1; },
      clearTimeout() {},
    },
  });
  const events = [];
  lookup.schedule({ nick: 'Jugador106' }, {
    onError: (error) => events.push(error.message),
    onSettled: () => events.push('settled'),
  });
  await callback();
  assert.deepEqual(events, ['network', 'settled']);
});
