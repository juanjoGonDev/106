import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadFormatter() {
  const context = { window: {}, Number };
  vm.runInNewContext(readFileSync('public/format.js', 'utf8'), context);
  return context.window.Minuto106Format;
}

describe('compact number formatting', () => {
  const formatter = loadFormatter();

  it('keeps values below one thousand readable', () => {
    expect(formatter.compactNumber(999)).toBe('999');
  });

  it('uses K for thousands', () => {
    expect(formatter.compactNumber(1000)).toBe('1K');
    expect(formatter.compactNumber(1200)).toBe('1.2K');
    expect(formatter.compactNumber(1404)).toBe('1.4K');
    expect(formatter.compactNumber(12_500)).toBe('12.5K');
  });

  it('uses M for millions', () => {
    expect(formatter.compactNumber(1_000_000)).toBe('1M');
    expect(formatter.compactNumber(1_200_000)).toBe('1.2M');
  });
});
