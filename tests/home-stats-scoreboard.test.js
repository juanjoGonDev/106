import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync('public/home-stats.js', 'utf8');

function target() {
  const attributes = new Map();
  const classes = new Set();
  return {
    attributes,
    classList: {
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
    },
    dataset: {},
    style: {},
    textContent: '',
    title: '',
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };
}

function createHarness() {
  const targets = new Map([
    ['#spainScore', target()],
    ['#argentinaScore', target()],
    ['#battleFill', target()],
    ['#battlePercent', target()],
    ['#battleTrack', target()],
  ]);
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
  };
  const document = {
    dispatchEvent() {},
    querySelector(selector) {
      return targets.get(selector) ?? null;
    },
  };
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const window = {
    __MINUTO106_CONFIG__: {},
    Minuto106Format: {
      compactNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? String(Math.round(numeric)) : '0';
      },
      fullNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? String(Math.round(numeric)) : '0';
      },
    },
  };

  runInNewContext(source, {
    CustomEvent,
    crypto: { randomUUID: () => 'test-device' },
    document,
    fetch: () => Promise.reject(new Error('Unexpected network request')),
    localStorage,
    window,
  });

  return {
    commit: window.Minuto106HomeStats.commit,
    get(selector) {
      return targets.get(selector);
    },
  };
}

describe('home global score rendering', () => {
  it('renders a neutral state instead of inventing a 50/50 split at zero', () => {
    const harness = createHarness();
    expect(harness.commit({
      teams: [
        { team: 'spain', score: 0 },
        { team: 'argentina', score: 0 },
      ],
      leaderboard: [],
    })).toBe(true);

    expect(harness.get('#spainScore').textContent).toBe('0');
    expect(harness.get('#argentinaScore').textContent).toBe('0');
    expect(harness.get('#battleFill').style.width).toBe('0%');
    expect(harness.get('#battlePercent').textContent).toBe('Sin puntos');
    expect(harness.get('#battleTrack').classList.contains('is-empty')).toBe(true);
    expect(harness.get('#battleTrack').attributes.get('aria-valuenow')).toBe('0');
    expect(harness.get('#battleTrack').attributes.get('aria-valuetext'))
      .toBe('Sin puntos globales verificados');
  });

  it('clamps invalid or negative team scores before calculating percentages', () => {
    const harness = createHarness();
    harness.commit({
      teams: [
        { team: 'spain', score: -25 },
        { team: 'argentina', score: 5 },
      ],
      leaderboard: [],
    });

    expect(harness.get('#spainScore').textContent).toBe('0');
    expect(harness.get('#argentinaScore').textContent).toBe('5');
    expect(harness.get('#battleFill').style.width).toBe('0%');
    expect(harness.get('#battlePercent').textContent).toBe('0% · 100%');
    expect(harness.get('#battleTrack').classList.contains('is-empty')).toBe(false);
    expect(harness.get('#battleTrack').attributes.get('aria-valuetext'))
      .toBe('España 0%, Argentina 100%');

    harness.commit({
      teams: [
        { team: 'spain', score: 'invalid' },
        { team: 'argentina', score: Number.NEGATIVE_INFINITY },
      ],
      leaderboard: [],
    });
    expect(harness.get('#battlePercent').textContent).toBe('Sin puntos');
    expect(harness.get('#battleTrack').classList.contains('is-empty')).toBe(true);
  });

  it('leaves the neutral state when verified points arrive', () => {
    const harness = createHarness();
    harness.commit({ teams: [], leaderboard: [] });
    harness.commit({
      teams: [
        { team: 'spain', score: 3 },
        { team: 'argentina', score: 1 },
      ],
      leaderboard: [],
    });

    expect(harness.get('#battleFill').style.width).toBe('75%');
    expect(harness.get('#battlePercent').textContent).toBe('75% · 25%');
    expect(harness.get('#battleTrack').classList.contains('is-empty')).toBe(false);
    expect(harness.get('#battleTrack').attributes.get('aria-valuenow')).toBe('75');
  });
});
