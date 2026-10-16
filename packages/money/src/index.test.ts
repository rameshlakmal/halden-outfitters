import { describe, expect, it } from 'vitest';
import { allocate, formatAmount, fromCents, percentOf, toCents } from './index.ts';

describe('toCents / fromCents', () => {
  it.each([
    ['84.50', 8450],
    ['84.5', 8450],
    ['84', 8400],
    ['0.07', 7],
    ['-3.20', -320],
  ])('%s is %i cents', (text, cents) => {
    expect(toCents(text)).toBe(cents);
  });

  it('round-trips', () => {
    for (const c of [0, 1, 99, 100, 795, 123456, -5]) expect(toCents(fromCents(c))).toBe(c);
  });

  it('rejects things that are not amounts', () => {
    for (const bad of ['', 'abc', '1.234', '1,00', '--1']) expect(() => toCents(bad)).toThrow();
    expect(() => fromCents(1.5)).toThrow();
  });
});

describe('percentOf', () => {
  it('rounds half up to the cent', () => {
    expect(percentOf(1000, 8)).toBe(80);
    expect(percentOf(1006, 8)).toBe(80); // 80.48
    expect(percentOf(1007, 8)).toBe(81); // 80.56
    expect(percentOf(625, 8)).toBe(50); // exactly 50.00
    expect(percentOf(1, 50)).toBe(1); // 0.5 rounds up
    expect(percentOf(3333, 12.5)).toBe(417); // 416.625
  });
});

describe('allocate', () => {
  it('always adds up to the total', () => {
    const cases: [number, number[]][] = [
      [1000, [1, 1, 1]],
      [1, [5, 5]],
      [997, [34900, 6900, 2800]],
      [0, [1, 2]],
      [12345, [1]],
    ];
    for (const [total, weights] of cases) {
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts).toHaveLength(weights.length);
    }
  });

  it('splits in proportion and gives leftover cents to the largest remainders', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(100, [3, 1])).toEqual([75, 25]);
    expect(allocate(10, [1, 2])).toEqual([3, 7]); // 3.33 and 6.67: the 0.67 remainder wins the cent
  });

  it('gives nothing to a zero weight', () => {
    expect(allocate(500, [0, 10])).toEqual([0, 500]);
  });

  it('rejects impossible splits', () => {
    expect(() => allocate(5, [0, 0])).toThrow();
    expect(() => allocate(-1, [1])).toThrow();
    expect(() => allocate(5, [1.5])).toThrow();
  });
});

describe('formatAmount', () => {
  it('groups thousands and keeps two decimals', () => {
    expect(formatAmount('1349.00')).toBe('1,349.00');
    expect(formatAmount(795)).toBe('7.95');
    expect(formatAmount('-5.00')).toBe('-5.00');
  });
});
