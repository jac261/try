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

describe('wellness.history (readiness trend)', () => {
  const recs = [
    ...Array.from({ length: 21 }, (_, i) => ({
      date: '2026-06-' + String(i + 9).padStart(2, '0'), hrv: 58 + (i % 5), rhr: 50, sleepH: 7.5,
    })),
    { date: '2026-06-30', hrv: 60, sleepH: 8, rhr: 50, tsb: 5 },
    { date: '2026-07-01', sleepScore: 70 },                       // no readiness metrics → skipped
    { date: '2026-07-02', hrv: 39, sleepH: 4.5, rhr: 58, tsb: -25 },
  ];

  it('scores each day against its own rolling baseline, ascending by date', () => {
    const h = wellness.history(recs, 14);
    expect(h.length).toBe(14);
    expect(h[h.length - 1].date).toBe('2026-07-02');
    expect(h[h.length - 2].date).toBe('2026-06-30'); // metric-less day skipped
    const good = h.find(x => x.date === '2026-06-30');
    const bad = h.find(x => x.date === '2026-07-02');
    expect(good.band).toBe('green');
    expect(bad.band).toBe('red');
    expect(bad.score).toBeLessThan(good.score);
    // ascending order throughout
    expect([...h].map(x => x.date)).toEqual([...h].map(x => x.date).sort());
  });

  it('caps at the requested number of days', () => {
    expect(wellness.history(recs, 5).length).toBe(5);
    expect(wellness.history([], 14)).toEqual([]);
  });
});

describe('wellness.formZone (TSB training zones)', () => {
  const zoneAt = t => wellness.formZone(t) && wellness.formZone(t).key;

  it('maps TSB to the classic PMC zones with correct boundaries', () => {
    expect(zoneAt(30)).toBe('transition');   // > +25
    expect(zoneAt(25)).toBe('transition');   // boundary belongs upward
    expect(zoneAt(10)).toBe('fresh');
    expect(zoneAt(0)).toBe('grey');
    expect(zoneAt(-10)).toBe('grey');        // boundary belongs upward
    expect(zoneAt(-20)).toBe('optimal');
    expect(zoneAt(-30)).toBe('optimal');
    expect(zoneAt(-35)).toBe('highRisk');
    expect(wellness.formZone(null)).toBe(null);
  });

  it('zones tile the whole TSB axis in order with labels and colors', () => {
    const z = wellness.FORM_ZONES;
    expect(z.map(x => x.label)).toEqual(['Transition', 'Fresh', 'Grey zone', 'Optimal', 'High risk']);
    for (let i = 1; i < z.length; i++) expect(z[i].hi).toBe(z[i - 1].lo); // contiguous
    expect(z[0].hi).toBe(Infinity);
    expect(z[z.length - 1].lo).toBe(-Infinity);
    z.forEach(x => { expect(x.color).toMatch(/^#[0-9a-f]{6}$/i); expect(x.blurb.length).toBeGreaterThan(0); });
  });
});

describe('wellness.rampRate (weekly CTL change)', () => {
  const mk = (date, ctl) => ({ date, ctl });

  it('measures fitness change over the trailing 7 days', () => {
    const recs = [];
    for (let d = 1; d <= 14; d++) recs.push(mk('2026-07-' + String(d).padStart(2, '0'), 40 + d * 0.5));
    // last = 07-14 (ctl 47), 7 days earlier = 07-07 (ctl 43.5) → +3.5
    expect(wellness.rampRate(recs)).toBe(3.5);
  });

  it('uses the nearest record at-or-before the 7-day mark when days are missing', () => {
    const recs = [mk('2026-07-01', 40), mk('2026-07-05', 42), mk('2026-07-14', 47)];
    // target 07-07 → nearest at-or-before is 07-05 (42) → +5
    expect(wellness.rampRate(recs)).toBe(5);
  });

  it('returns null without enough history', () => {
    expect(wellness.rampRate([mk('2026-07-14', 47)])).toBe(null);
    expect(wellness.rampRate([])).toBe(null);
    expect(wellness.rampRate([{ date: '2026-07-01' }, { date: '2026-07-14' }])).toBe(null); // no ctl
  });

  it('zones carry per-zone alpha for distinct banding', () => {
    wellness.FORM_ZONES.forEach(z => expect(z.alpha).toBeGreaterThan(0));
    const highRisk = wellness.FORM_ZONES.find(z => z.key === 'highRisk');
    const grey = wellness.FORM_ZONES.find(z => z.key === 'grey');
    expect(highRisk.alpha).toBeGreaterThan(grey.alpha * 2); // high risk pops, grey recedes
  });
});

describe('wellness.rampHistory & rampZone', () => {
  const mk = (date, ctl) => ({ date, ctl });
  const recs = [];
  for (let d = 1; d <= 21; d++) recs.push(mk('2026-07-' + String(d).padStart(2, '0'), 40 + d * 0.5));

  it('computes a per-day weekly ramp, omitting the leading edge without history', () => {
    const h = wellness.rampHistory(recs);
    // days 1-7 have no record ≥7 days back → first ramp lands on day 8
    expect(h[0].date).toBe('2026-07-08');
    expect(h[0].ramp).toBe(3.5);                       // 0.5/day × 7
    expect(h[h.length - 1].date).toBe('2026-07-21');
    expect(h[h.length - 1].ramp).toBe(3.5);
    expect(h.every(x => x.ramp === 3.5)).toBe(true);   // constant build
  });

  it('caps at the requested days and matches rampRate at the tail', () => {
    expect(wellness.rampHistory(recs, 5).length).toBe(5);
    const h = wellness.rampHistory(recs);
    expect(h[h.length - 1].ramp).toBe(wellness.rampRate(recs));
  });

  it('maps ramp values to the coaching zones with correct boundaries', () => {
    const at = v => wellness.rampZone(v) && wellness.rampZone(v).key;
    expect(at(10)).toBe('risky');
    expect(at(8)).toBe('risky');        // boundary belongs upward
    expect(at(6)).toBe('aggressive');
    expect(at(3)).toBe('building');
    expect(at(0)).toBe('building');
    expect(at(-1)).toBe('steady');
    expect(at(-3)).toBe('steady');
    expect(at(-6)).toBe('detraining');
    expect(wellness.rampZone(null)).toBe(null);
    // zones tile the axis contiguously
    const z = wellness.RAMP_ZONES;
    for (let i = 1; i < z.length; i++) expect(z[i].hi).toBe(z[i - 1].lo);
  });
});
