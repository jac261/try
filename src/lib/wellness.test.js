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

describe('wellness readiness — interpolation & model', () => {
  const base = { hrvMean: 60, hrvSd: 8, rhrMean: 50 };

  it('interpolates within a band instead of a flat tier (no cliff edges)', () => {
    // Sleep anchors: 7h→0, 6h→−3. 6.4h is 40% of the way from 6→7 → ~−1.8 → −2.
    // Isolate the sleep factor by leaving the others at neutral values.
    const at = h => wellness.readiness({ hrv: 60, sleepH: h, tsb: 0 }, base).score;
    expect(at(7.0)).toBe(100);      // met need
    expect(at(6.0)).toBe(97);       // −3
    expect(at(6.4)).toBe(98);       // −2, between the tiers (would be −3 flat before)
    expect(at(6.8)).toBe(99);       // −1
    expect(at(5.0)).toBe(89);       // −11
    // monotonic: less sleep never scores higher
    expect(at(6.4)).toBeLessThan(at(6.8));
    expect(at(5.5)).toBeLessThan(at(6.0));
  });

  it('a raised resting HR adds no driver line when normal', () => {
    const r = wellness.readiness({ hrv: 60, sleepH: 8, rhr: 51, tsb: 0 }, base);
    expect(r.why.some(w => w.key === 'rhr')).toBe(false);
    const raised = wellness.readiness({ hrv: 60, sleepH: 8, rhr: 58, tsb: 0 }, base);
    expect(raised.why.some(w => w.key === 'rhr')).toBe(true);
  });

  it('drivers carry the points they cost', () => {
    const r = wellness.readiness({ hrv: 60, sleepH: 5, tsb: 0 }, base);
    const sleep = r.why.find(w => w.key === 'sleep');
    expect(sleep.points).toBe(-11);
  });

  it('exposes a render-ready MODEL for the support page', () => {
    const m = wellness.MODEL;
    expect(m.start).toBe(100);
    expect(m.bands.map(b => b.key)).toEqual(['green', 'amber', 'red']);
    expect(m.factors.map(f => f.key)).toEqual(['hrv', 'sleep', 'rhr', 'form']);
    const sleep = m.factors.find(f => f.key === 'sleep');
    expect(sleep.weight).toBe(22);
    expect(Array.isArray(sleep.bands)).toBe(true);
    expect(sleep.what).toMatch(/7h/);
  });
});
