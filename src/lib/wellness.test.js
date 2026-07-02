import { describe, it, expect } from 'vitest';
import { wellness } from './wellness.js';

describe('wellness.baseline', () => {
  it('computes HRV/RHR means from prior records and defaults sd to 4 on zero variance', () => {
    const recs = [
      { date: '2026-06-01', hrv: 60, rhr: 50 },
      { date: '2026-06-02', hrv: 60, rhr: 50 },
    ];
    const b = wellness.baseline(recs, '2026-06-03');
    expect(b.hrvMean).toBe(60);
    expect(b.hrvSd).toBe(4); // zero variance → guarded fallback (no divide-by-zero)
    expect(b.rhrMean).toBe(50);
    expect(b.n).toBe(2);
  });

  it('only uses records strictly before the given date', () => {
    const recs = [{ date: '2026-06-01', hrv: 50 }, { date: '2026-06-05', hrv: 80 }];
    const b = wellness.baseline(recs, '2026-06-03');
    expect(b.hrvMean).toBe(50);
    expect(b.n).toBe(1);
  });
});

describe('wellness.readiness', () => {
  const base = { hrvMean: 60, hrvSd: 8, rhrMean: 50 };

  it('scores green for good inputs', () => {
    const r = wellness.readiness({ hrv: 64, sleepH: 8, rhr: 49, tsb: 2 }, base);
    expect(r.band).toBe('green');
    expect(r.score).toBeGreaterThanOrEqual(75);
  });

  it('scores red when HRV crashes, sleep is short and form is deep', () => {
    const r = wellness.readiness({ hrv: 40, sleepH: 4.5, rhr: 58, tsb: -25 }, base);
    expect(r.band).toBe('red');
    expect(r.score).toBeLessThan(55);
  });

  it('returns null for a missing record', () => {
    expect(wellness.readiness(null, base)).toBe(null);
  });
});

describe('wellness formatting', () => {
  it('signed uses + and a unicode minus', () => {
    expect(wellness.signed(5)).toBe('+5');
    expect(wellness.signed(-5)).toBe('−5');
  });

  it('fmtH formats fractional hours', () => {
    expect(wellness.fmtH(7.5)).toBe('7h 30m');
  });
});
