import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const agents = read('AGENTS.md');
const testingPolicy = read('.agents/testing.md');
const pullRequestTemplate = read('.github/pull_request_template.md');

describe('repository testing policy', () => {
  it('routes behavior changes through the stable testing policy', () => {
    expect(agents).toContain('Read `.agents/testing.md`');
    expect(agents).toContain('100% line, function and branch coverage');
    expect(agents).toContain('at least one real local integration journey');
    expect(agents).toContain('complete user flows in Desktop and Mobile projects');
  });

  it('requires useful coverage without substituting a repository-wide percentage for behavior', () => {
    expect(testingPolicy).toContain('New isolated decision modules, state machines, parsers, validators, security gates and controllers require 100% line, function and branch coverage.');
    expect(testingPolicy).toContain('Existing coverage must not decrease.');
    expect(testingPolicy).toContain('A 100% repository-wide number is not a substitute for useful assertions');
    expect(testingPolicy).toContain('Do not lower an existing threshold.');
  });

  it('requires real complete journeys and limits mocks to supplementary scenarios', () => {
    expect(testingPolicy).toContain('use the real local stack for at least one critical journey');
    expect(testingPolicy).toContain('Mocks may supplement real integration');
    expect(testingPolicy).toContain('They must not be the only proof of a critical repository-owned frontend-to-database flow.');
    expect(testingPolicy).toContain('reload or navigate back when persistence or route restoration matters');
    expect(testingPolicy).toContain('assert no unexpected page errors, console errors, failed requests or horizontal overflow');
  });

  it('records boundary, failure, race, database and anti-flakiness expectations', () => {
    for (const requirement of [
      'minimum, maximum and empty boundaries',
      'unauthorized and forbidden access',
      'stale, duplicated, partial or reordered data',
      'concurrency, multi-tab or race behavior',
      'clean setup from an empty database',
      'production-shaped upgrade regression',
      'Do not use `.skip`, `.only`, retries or snapshot updates to hide a failure.',
      'Fixed sleeps are not synchronization',
    ]) {
      expect(testingPolicy).toContain(requirement);
    }
  });

  it('surfaces the same proof matrix in every pull request', () => {
    for (const requirement of [
      'Bug regression reproduces the verified failure or root cause',
      'Relevant concurrency, multi-tab or reordered-response cases',
      '100% line/function/branch coverage',
      'Real local backend/database integration',
      'Complete Desktop Playwright journey',
      'Complete Mobile Playwright journey',
      'No unexpected page errors, console errors, failed requests or horizontal overflow',
      'No `.skip`, `.only`, retry-as-fix, weakened threshold or fixed sleep used as synchronization',
    ]) {
      expect(pullRequestTemplate).toContain(requirement);
    }
  });
});
