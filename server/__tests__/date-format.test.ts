import { describe, expect, it } from 'vitest';
import { formatBlockRange } from '../../src/shared/index.js';

// ---------------------------------------------------------------------------
// formatBlockRange — humanized end-exclusive blocked ranges for the admin UI
// ---------------------------------------------------------------------------
describe('formatBlockRange', () => {
  it('single day when end is null', () => {
    expect(formatBlockRange('2028-07-03', null)).toBe('Jul 3, 2028 · 1 day');
  });

  it('single day when end is start + 1 (end exclusive)', () => {
    expect(formatBlockRange('2028-07-03', '2028-07-04')).toBe('Jul 3, 2028 · 1 day');
  });

  it('same-month range elides the second month', () => {
    expect(formatBlockRange('2028-07-03', '2028-07-05')).toBe('Jul 3 – 4, 2028 · 2 days');
  });

  it('cross-month range repeats the month', () => {
    expect(formatBlockRange('2028-06-29', '2028-07-02')).toBe('Jun 29 – Jul 1, 2028 · 3 days');
  });
});
