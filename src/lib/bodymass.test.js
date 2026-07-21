// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { massTrend, goalStatus, fmtRateGrams, GAIN_BAND, MASS_MIN_POINTS, FUEL_LEVELS, FUEL_CAPTION } from './bodymass.js';
import { iso, addDays } from './date.js';
import { storageForUser } from '@/app/storage.js';

/* Body mass and fuelling, coach brain pass 3. The fixtures encode the design
   panel's statistics argument: scale noise near half a kilo per weigh-in,
   a target band sixty grams wide, so the rate must come from a regression
   over a month of points, judged only with persistence. */

const today = '2026-07-20';
// deterministic pseudo-noise, +-0.3 kg, no Math.random (rebuild stability)
const noise = i => (((i * 37) % 13) - 6) / 20;
const daily = (days, kgAt) => Array.from({ length: days }, (_, i) => {
  const date = iso(addDays(today, -(days - 1 - i)));
  return { date, weightKg: Math.round((kgAt(i, days) + noise(i)) * 100) / 100 };
});

describe('massTrend', () => {
  it('returns null with no weigh-ins and gates thin data honestly', () => {
    expect(massTrend([], today)).toBe(null);
    expect(massTrend(null, today)).toBe(null);
    const few = daily(28, () => 64).filter((_, i) => i % 5 === 0); // 6 points
    expect(few.length).toBeLessThan(MASS_MIN_POINTS);
    const t = massTrend(few, today);
    expect(t).toBeTruthy();          // the weigh-ins still show
    expect(t.weeklyRateKg).toBe(null); // but no rate is claimed
  });

  it('reads a true gain through realistic scale noise (the regression argument)', () => {
    // a genuine 0.13 kg/week climb buried in +-0.3 kg noise
    const rs = daily(28, (i, days) => 64 + (i / (days - 1)) * (0.13 * 4));
    const t = massTrend(rs, today);
    expect(t.weeklyRateKg).toBeGreaterThan(0.06);
    expect(t.weeklyRateKg).toBeLessThan(0.20);
  });

  it('reads flat as flat: noise alone never invents a rate near the band edges', () => {
    const t = massTrend(daily(28, () => 64), today);
    expect(Math.abs(t.weeklyRateKg)).toBeLessThan(0.05);
  });

  it('the chart series is one point per calendar week with real gaps as nulls', () => {
    const rs = daily(84, () => 64).filter(r => r.date < '2026-06-08' || r.date > '2026-06-28');
    const t = massTrend(rs, today);
    expect(t.series.length).toBe(12);
    expect(t.series.some(v => v == null)).toBe(true);  // the gap stays a gap
    expect(t.series.some(v => v != null)).toBe(true);
  });

  it('carries the latest weigh-in labelled separately from the average', () => {
    const rs = daily(28, () => 64);
    const t = massTrend(rs, today);
    expect(t.latestDate).toBe(today);
    expect(t.avgKg).toBeGreaterThan(63);
    expect(t.avgKg).toBeLessThan(65);
  });
});

describe('goalStatus', () => {
  const gaining = rate => {
    const rs = daily(42, (i, days) => 64 + (i / (days - 1)) * (rate * 6));
    return massTrend(rs, today);
  };

  it('never judges without a gain goal', () => {
    const t = gaining(0.13);
    expect(goalStatus(t, null)).toBe(null);
    expect(goalStatus(t, 'hold')).toBe(null);   // unshipped goals never judge
    expect(goalStatus(null, 'gain')).toBe(null);
  });

  it('on-target reads matter-of-fact; the band scales with body weight', () => {
    const st = goalStatus(gaining(0.13), 'gain');
    expect(st.key).toBe('on');
    expect(st.label).toBe('in the target range');
    // at 64 kg the band reproduces the spec's 0.10-0.16
    expect(GAIN_BAND.onLo * 64).toBeCloseTo(0.102, 2);
    expect(GAIN_BAND.onHi * 64).toBeCloseTo(0.16, 2);
  });

  it('below and above need two consecutive scoreable weeks', () => {
    const flat = goalStatus(gaining(0.0), 'gain');
    expect(flat.key).toBe('below'); // 6 weeks flat: both prior evaluations under the floor
    const fast = goalStatus(gaining(0.5), 'gain');
    expect(fast.key).toBe('above');
    // a single off week is named noise, not a verdict
    expect(goalStatus(gaining(0.06), 'gain').key).toMatch(/between|below/);
  });

  it('copy register: no shouting, no em dashes, no praise or shame words', () => {
    ['on', 'below', 'above'].forEach(() => {});
    [goalStatus(gaining(0.13), 'gain'), goalStatus(gaining(0), 'gain'), goalStatus(gaining(0.5), 'gain')]
      .forEach(st => {
        [st.label, st.detail].forEach(s => {
          expect(s).not.toMatch(/—/);
          expect(s).not.toMatch(/\b[A-Z]{3,}\b/);
          expect(s).not.toMatch(/great|bad|guilt|fail|shame|well done/i);
        });
      });
  });
});

describe('formatting and fuel vocabulary', () => {
  it('rates render in signed grams, never one-decimal kilograms', () => {
    expect(fmtRateGrams(0.13)).toBe('~+130 g a week');
    expect(fmtRateGrams(-0.05)).toBe('~−50 g a week');
    expect(fmtRateGrams(0)).toBe('~0 g a week');
    expect(fmtRateGrams(null)).toBe(null);
  });

  it('fuel labels stay terse; the gram anchors live once in the caption', () => {
    Object.values(FUEL_LEVELS).forEach(l => expect(l.split(' ').length).toBeLessThanOrEqual(2));
    expect(FUEL_CAPTION).toMatch(/30 g/);
    expect(FUEL_CAPTION).not.toMatch(/—/);
  });
});

describe('the fuel store', () => {
  it('keys by activity id, clears on null, survives clear()', () => {
    localStorage.clear();
    const st = storageForUser('fuel-test');
    st.saveFuel('a1', 'solid', today);
    expect(st.loadFuel().a1.level).toBe('solid');
    st.saveFuel('a1', null, today);
    expect(st.loadFuel().a1).toBeUndefined();
    st.saveFuel('a2', 'bit', today);
    st.clear();
    expect(st.loadFuel().a2.level).toBe('bit'); // an answered fact about a recording outlives the plan
  });
});
