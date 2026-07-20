import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const migrationsDirectory = 'supabase/migrations';
const base = process.env.MIGRATION_DIFF_BASE?.trim();
const head = process.env.MIGRATION_DIFF_HEAD?.trim() || 'HEAD';
const zeroSha = /^0+$/;

function listAllMigrations() {
  if (!existsSync(migrationsDirectory)) return [];
  return readdirSync(m