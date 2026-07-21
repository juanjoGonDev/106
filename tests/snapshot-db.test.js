import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  analyzeSnapshotDatabaseUrl,
  probeSnapshotDatabase,
} from '../scripts/check-snapshot-db.mjs';

const DIRECT_URL = 'postgresql://postgres:secret@db.example.supabase.co:5432/postgres';
const POOLER_URL = 'postgresql://postgres.example:secret@aws-0-eu.pooler.supabase.com:5432/postgres';

describe('snapshot database URL analysis', () => {
  it('identifies a direct Supabase database host', () => {
    expect(analyzeSnapshotDatabaseUrl(DIRECT_URL)).toEqual({
      configured: true,
      valid: true,
      hostname: 'db.example.supabase.co',
      directSupabaseHost: true,
    });
  });

  it('accepts a Session pooler URI without classifying it as direct', () => {
    expect(analyzeSnapshotDatabaseUrl(POOLER_URL)).toEqual({
      configured: true,
      valid: true,
      hostname: 'aws-0-eu.pooler.supabase.com',
      directSupabaseHost: false,
    });
  });

  it('rejects malformed and non-PostgreSQL URLs', () => {
    expect(analyzeSnapshotDatabaseUrl('not-a-url').valid).toBe(false);
    expect(analyzeSnapshotDatabaseUrl('https://example.com').valid).toBe(false);
  });
});

describe('snapshot database connectivity probe', () => {
  it('enables snapshots when psql can connect', () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    const logger = { error: vi.fn() };

    const result = probeSnapshotDatabase({
      databaseUrl: POOLER_URL,
      environment: {},
      spawn,
      logger,
    });

    expect(result).toEqual({ enabled: true, reason: 'ok', direct: false });
    expect(spawn).toHaveBeenCalledWith(
      'psql',
      expect.arrayContaining(['--command', 'select 1;']),
      expect.objectContaining({
        env: expect.objectContaining({
          PGCONNECT_TIMEOUT: '5',
          PGDATABASE: POOLER_URL,
        }),
      }),
    );
  });

  it('degrades only the snapshot layer when the database is unreachable', () => {
    const logger = { error: vi.fn() };

    const result = probeSnapshotDatabase({
      databaseUrl: DIRECT_URL,
      environment: {},
      spawn: () => ({ status: 2 }),
      logger,
    });

    expect(result).toEqual({ enabled: false, reason: 'unreachable', direct: true });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Session pooler URI'));
  });
});

describe('production deployment workflow', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/supabase.yml', import.meta.url),
    'utf8',
  );

  it('probes connectivity before snapshot operations', () => {
    const probeIndex = workflow.indexOf('Probe snapshot database connectivity');
    const captureIndex = workflow.indexOf('Capture pre-deployment history counters');

    expect(probeIndex).toBeGreaterThan(-1);
    expect(captureIndex).toBeGreaterThan(probeIndex);
  });

  it('gates every direct psql snapshot operation on the probe output', () => {
    const condition = "steps.snapshot_database.outputs.enabled == 'true'";
    const conditionCount = workflow.split(condition).length - 1;

    expect(conditionCount).toBeGreaterThanOrEqual(5);
    expect(workflow).toContain('scripts/check-snapshot-db.mjs');
  });
});
