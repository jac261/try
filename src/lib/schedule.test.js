import { describe, it, expect } from 'vitest';
import { monthGrid, addMonths } from './schedule.js';

describe('monthGrid (Calendar tab)', () => {
  it('lays July 2026 out Monday-first with edge padding', () => {
    const g = monthGrid('2026-07-15');
    expect(g.label).toBe('July 2026');
    expect(g.cells.length % 7).toBe(0);
    // 1 July 2026 is a Wednesday → two leading nulls
    expect(g.cells.slice(0, 3)).toEqual([null, null, '2026-07-01']);
    expect(g.cells).toContain('2026-07-31');
    expect(g.cells[g.cells.length - 1]).toBe(null); // 31st is a Friday → padded tail
  });

  it('handles months starting on Monday and leap Februaries', () => {
    const june = monthGrid('2026-06-01'); // 1 June 2026 is a Monday
    expect(june.cells[0]).toBe('2026-06-01');
    const feb = monthGrid('2028-02-10');
    expect(feb.cells).toContain('2028-02-29');
  });

  it('addMonths steps between months, clamping into the first day', () => {
    expect(addMonths('2026-07-31', 1)).toBe('2026-08-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(addMonths('2026-12-05', 1)).toBe('2027-01-01');
  });
});
