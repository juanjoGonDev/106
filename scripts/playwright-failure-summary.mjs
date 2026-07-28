import { basename } from 'node:path';

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');
const NON_SLUG = /[^a-z0-9]+/gu;
const MAX_SLUG_LENGTH = 120;

function firstLine(value) {
  return String(value ?? '').replace(ANSI_ESCAPE, '').split(/\r?\n/u).find(Boolean) || '';
}

function failedResult(report) {
  const pending = [...(Array.isArray(report?.suites) ? report.suites : [])];
  while (pending.length) {
    const suite = pending.shift();
    pending.unshift(...(Array.isArray(suite?.suites) ? suite.suites : []));
    for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) {
      for (const test of Array.isArray(spec?.tests) ? spec.tests : []) {
        const result = (Array.isArray(test?.results) ? test.results : [])
          .find((entry) => !['passed', 'skipped'].includes(String(entry?.status)));
        if (!result) continue;
        return {
          file: basename(String(spec.file || suite.file || 'playwright')),
          title: String(spec.title || test.title || 'test'),
          message: firstLine(result.errors?.[0]?.message || result.error?.message || result.status),
        };
      }
    }
  }
  return null;
}

export function slugifyFailure(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(NON_SLUG, '-')
    .replace(/^-+|-+$/gu, '');
  return (slug || 'unknown').slice(0, MAX_SLUG_LENGTH).replace(/-+$/u, '');
}

export function playwrightFailureSlug(report, output = '') {
  const failed = failedResult(report);
  if (failed) return slugifyFailure(`${failed.file}-${failed.title}-${failed.message}`);
  const outputLine = String(output).replace(ANSI_ESCAPE, '').split(/\r?\n/u).filter(Boolean).at(-1) || 'postprocess-failure';
  return slugifyFailure(outputLine);
}
