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

  it('ramps smoothly within a band instead of a flat tier (no cliff edges)', () => {
    // Sleep penalty is a convex curve from 7h (0) to 4h (full weight). Isolate it
    // by leaving the other factors at neutral values.
    const at = h => wellness.readiness({ hrv: 60, sleepH: h, tsb: 0 }, base).score;
    expect(at(7.0)).toBe(100);      // met need, no penalty
    expect(at(6.0)).toBe(97);       // −3
    expect(at(6.4)).toBe(99);       // −1, between the tiers (would be a flat −3 before)
    expect(at(5.0)).toBe(90);       // −10
    // monotonic: less sleep never scores higher
    expect(at(6.4)).toBeLessThan(at(7.0));
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
    expect(sleep.points).toBe(-10);
  });

  it('exposes a render-ready MODEL with derived weights for the support page', () => {
    const m = wellness.MODEL;
    expect(m.start).toBe(100);
    expect(m.bands.map(b => b.key)).toEqual(['green', 'amber', 'red']);
    expect(m.factors.map(f => f.key)).toEqual(['hrv', 'sleep', 'rhr', 'form']);
    // weights are derived from importance 4/3/2/2 and the band-anchored budget,
    // not hand-set: HRV 26, sleep 19, resting HR 13, form 13.
    expect(m.factors.map(f => f.weight)).toEqual([26, 19, 13, 13]);
    expect(m.policy).toMatch(/two compromised signals/i);
    const sleep = m.factors.find(f => f.key === 'sleep');
    expect(sleep.what).toMatch(/7h/);
    expect(sleep.bands).toEqual([['7h or more', '0'], ['6h', '−3'], ['5h', '−10'], ['4h or less', '−19']]);
  });

  it('derives magnitudes so it takes two compromised signals to reach red', () => {
    // The policy that fixes the budget: HRV alone at its worst stays amber; HRV +
    // sleep both at worst land on the red line (55). These are outputs, not knobs.
    const hrvOnlyWorst = wellness.readiness({ hrv: base.hrvMean - base.hrvSd * 2.6 }, base);
    expect(hrvOnlyWorst.band).toBe('amber');
    const twoWorst = wellness.readiness({ hrv: base.hrvMean - base.hrvSd * 2.6, sleepH: 4 }, base);
    expect(twoWorst.score).toBe(55);
    expect(twoWorst.band).toBe('amber'); // exactly on the amber/red edge
  });
});
