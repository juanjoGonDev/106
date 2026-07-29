import { describe, expect, it, vi } from 'vitest';

import {
  parseSupabaseEnvironment,
  waitForPostgrest,
} from '../scripts/wait-for-postgrest-local.mjs';

function response(status, body = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
  };
}

describe('local PostgREST readiness boundary', () => {
  it('parses quoted and unquoted Supabase environment values', () => {
    expect(parseSupabaseEnvironment([
      'API_URL="http://127.0.0.1:54321"',
      "SERVICE_ROLE_KEY='secret'",
      'DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ].join('\n'))).toEqual({
      API_URL: 'http://127.0.0.1:54321',
      SERVICE_ROLE_KEY: 'secret',
      DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
  });

  it('returns immediately when both authoritative RPCs are ready', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(response(200, '{}'));
    const sleepImplementation = vi.fn();

    await expect(waitForPostgrest({
      apiUrl: 'http://127.0.0.1:54321',
      serviceRoleKey: 'service-role',
      fetchImplementation,
      sleepImplementation,
    })).resolves.toBe(1);

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(sleepImplementation).not.toHaveBeenCalled();
  });

  it('waits only at the readiness boundary after a transient pool reconnect', async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(response(500, 'Database client error. Retrying the connection.'))
      .mockResolvedValueOnce(response(500, 'Database client error. Retrying the connection.'))
      .mockResolvedValue(response(200, '{}'));
    const sleepImplementation = vi.fn().mockResolvedValue(undefined);

    await expect(waitForPostgrest({
      apiUrl: 'http://127.0.0.1:54321',
      serviceRoleKey: 'service-role',
      fetchImplementation,
      maxAttempts: 3,
      delayMs: 1,
      sleepImplementation,
    })).resolves.toBe(2);

    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(sleepImplementation).toHaveBeenCalledOnce();
  });

  it('reports the final bounded readiness failure', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(response(500, 'pool unavailable'));
    const sleepImplementation = vi.fn().mockResolvedValue(undefined);

    await expect(waitForPostgrest({
      apiUrl: 'http://127.0.0.1:54321',
      serviceRoleKey: 'service-role',
      fetchImplementation,
      maxAttempts: 2,
      delayMs: 1,
      sleepImplementation,
    })).rejects.toThrow(/after 2 probes: 500 pool unavailable/u);

    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(sleepImplementation).toHaveBeenCalledOnce();
  });
});
