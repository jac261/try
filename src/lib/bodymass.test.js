// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { massTrend, goalStatus, fmtRateGrams, GAIN_BAND, HOLD_BAND, MASS_MIN_POINTS, BODYMASS_RULE_VERSION, FUEL_LEVELS, FUEL_CAPTION } from './bodymass.js';
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

  it('never judges without a declared goal', () => {
    const t = gaining(0.13);
    expect(goalStatus(t, null)).toBe(null);
    expect(goalStatus(t, 'lose')).toBe(null);   // no lose goal exists, by safety panel verdict
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

describe('the hold goal (safety panel 2026-07-22)', () => {
  const trending = rate => {
    const rs = daily(42, (i, days) => 64 + (i / (days - 1)) * (rate * 6));
    return massTrend(rs, today);
  };

  it('rule version is 2 and there is no lose band anywhere', () => {
    expect(BODYMASS_RULE_VERSION).toBe(2);
    expect(HOLD_BAND.on).toBe(GAIN_BAND.onLo);
    expect(HOLD_BAND.fast).toBe(GAIN_BAND.ceiling);
  });

  it('little change within the band, drift needs two weeks, direction words stay calm', () => {
    const on = goalStatus(trending(0.0), 'hold');
    expect(on.key).toBe('on');
    expect(on.label).toBe('little change');
    const up = goalStatus(trending(0.3), 'hold');
    expect(up.key).toBe('driftUp');
    expect(up.detail).toMatch(/holding is still the goal/);
    // between the on band (0.10 at 64 kg) and the fast line (0.25)
    const down = goalStatus(trending(-0.18), 'hold');
    expect(down.key).toBe('driftDown');
    expect(down.detail).toMatch(/fuelling around training/);
  });

  it('fast unintended loss escalates to the amber warning with the qualified-person line', () => {
    const fast = goalStatus(trending(-0.5), 'hold');
    expect(fast.key).toBe('downFast');
    expect(fast.label).toBe('coming down quickly');
    expect(fast.detail).toMatch(/someone qualified sees more than a chart does/);
    // one fast week plus one drift week must not escalate
    const rs = daily(42, (i, days) => {
      const t2 = i / (days - 1);
      return t2 < 0.67 ? 65 - t2 * 0.4 : 65 - 0.268 - (t2 - 0.67) * 3.5;
    });
    const mixed = goalStatus(massTrend(rs, today), 'hold');
    expect(mixed.key).not.toBe('downFast');
  });

  it('no hold detail carries a signed figure or a banned word', () => {
    [-0.5, -0.18, 0, 0.12, 0.18].forEach(r => {
      const st = goalStatus(trending(r), 'hold');
      [st.label, st.detail].forEach(sx => {
        expect(sx).not.toMatch(/—/);
        expect(sx).not.toMatch(/\b[A-Z]{3,}\b/);
        expect(sx).not.toMatch(/\d/);
        expect(sx).not.toMatch(/cut|deficit|calorie|fat\b|race weight|burn|streak/i);
        expect(sx).not.toMatch(/great|bad|guilt|fail|shame|well done/i);
      });
    });
  });
});

describe('the settling gate', () => {
  const rs = daily(42, (i, days) => 64 + (i / (days - 1)) * 1.2); // gaining fast
  const t = massTrend(rs, today);

  it('a fresh goal is not judged against the trend the old goal shaped', () => {
    const st = goalStatus(t, 'hold', { setISO: iso(addDays(today, -3)), todayISO: today });
    expect(st.key).toBe('settling');
    expect(st.judgedRateKg).toBeUndefined(); // the rate line hides mechanically
  });

  it('a stamp older than the full window judges normally; a null stamp is the legacy path', () => {
    const judged = goalStatus(t, 'hold', { setISO: iso(addDays(today, -40)), todayISO: today });
    expect(judged.key).not.toBe('settling');
    const legacy = goalStatus(t, 'gain', { setISO: null, todayISO: today });
    expect(legacy).toEqual(goalStatus(t, 'gain'));
  });

  it('a stamp inside the prior window resets persistence without gating the latest read', () => {
    // window start of the PRIOR evaluation predates the stamp; the latest
    // does not: prior treated null, so two-week states cannot fire
    const st = goalStatus(massTrend(daily(42, () => 64 - 0), today), 'hold',
      { setISO: iso(addDays(today, -32)), todayISO: today });
    expect(st).toBeTruthy();
    expect(['on', 'between', 'settling']).toContain(st.key);
  });
});

describe('gain: losing during a build', () => {
  it('a genuinely falling trend under a gain goal names fuelling; a stall keeps the shipped words', () => {
    const falling = goalStatus(massTrend(daily(42, (i, days) => 65 - (i / (days - 1)) * 1.0), today), 'gain');
    expect(falling.key).toBe('below');
    expect(falling.detail).toMatch(/fuelling is not keeping up with the training/);
    const stalled = goalStatus(massTrend(daily(42, () => 64), today), 'gain');
    expect(stalled.key).toBe('below');
    expect(stalled.detail).toBe('Two weeks running under it.');
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
