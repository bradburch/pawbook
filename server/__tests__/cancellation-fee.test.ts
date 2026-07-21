import { describe, expect, it } from 'vitest';
import { cancellationFee, validateCancellationTiers } from '../../src/shared';

const TIERS = [
  { withinDays: 2, percent: 100 },
  { withinDays: 7, percent: 50 },
];

describe('cancellationFee', () => {
  it('tightest tier wins at the boundary', () => {
    expect(cancellationFee(TIERS, 200, '2028-10-10', '2028-10-08')).toBe(200); // 2 days out
    expect(cancellationFee(TIERS, 200, '2028-10-10', '2028-10-03')).toBe(100); // 7 days out
    expect(cancellationFee(TIERS, 200, '2028-10-10', '2028-10-02')).toBe(0); // 8 days out
  });
  it('same-day and past-start count as 0 days out', () => {
    expect(cancellationFee(TIERS, 200, '2028-10-10', '2028-10-10')).toBe(200);
    expect(cancellationFee(TIERS, 200, '2028-10-10', '2028-10-12')).toBe(200);
  });
  it('rounds to whole dollars', () => {
    expect(cancellationFee([{ withinDays: 7, percent: 50 }], 75, '2028-10-10', '2028-10-05')).toBe(38);
  });
  it('empty tiers → 0', () => {
    expect(cancellationFee([], 200, '2028-10-10', '2028-10-10')).toBe(0);
  });
});

describe('validateCancellationTiers', () => {
  it('accepts a sorted 1-5 tier schedule', () => {
    expect(validateCancellationTiers(TIERS)).toBe(true);
    expect(validateCancellationTiers([{ withinDays: 0, percent: 100 }])).toBe(true);
  });
  it('rejects non-arrays, empty, >5, unsorted, dup days, bad ranges, extra keys, non-integers', () => {
    expect(validateCancellationTiers(null)).toBe(false);
    expect(validateCancellationTiers([])).toBe(false);
    expect(validateCancellationTiers(Array.from({ length: 6 }, (_, i) => ({ withinDays: i, percent: 10 })))).toBe(false);
    expect(validateCancellationTiers([TIERS[1], TIERS[0]])).toBe(false); // unsorted
    expect(validateCancellationTiers([{ withinDays: 2, percent: 100 }, { withinDays: 2, percent: 50 }])).toBe(false);
    expect(validateCancellationTiers([{ withinDays: -1, percent: 50 }])).toBe(false);
    expect(validateCancellationTiers([{ withinDays: 2, percent: 0 }])).toBe(false);
    expect(validateCancellationTiers([{ withinDays: 2, percent: 101 }])).toBe(false);
    expect(validateCancellationTiers([{ withinDays: 2, percent: 50, extra: 1 }])).toBe(false);
    expect(validateCancellationTiers([{ withinDays: 1.5, percent: 50 }])).toBe(false);
  });
});
