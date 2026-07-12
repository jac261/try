import { describe, it, expect } from 'vitest';
import { weakestLink, weakBias, WEAK_BIAS } from './weakest.js';
import { generatePlan } from './plan.js';

describe('weakestLink (which sport is limiting)', () => {
  it('a strong runner and rider with an intermediate swim gets the swim named, with its race share', () => {
    // Jon-shaped: 20:18 5k (~2.5 on the ladder), 222 W at 64.3 kg (~2.3), CSS 2:00 (1.0)
    const wl = weakestLink({ profile: { raceType: 'olympic', fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 } });
    expect(wl.weakest).toBe('swim');
    expect(wl.gap).toBeGreaterThanOrEqual(1);
    expect(wl.share).toBeGreaterThan(10); // swim ≈ 20% of an olympic
    expect(wl.share).toBeLessThan(30);
  });

  it('a maintenance block has no race, so the limiter carries no race share', () => {
    const wl = weakestLink({ profile: { raceType: 'maintenance', fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 } });
    expect(wl.weakest).toBe('swim');
    expect(wl.share).toBe(null); // never "33% of your race" when there is no race
  });

  it('balanced athletes get no limiter — near-ties never name a weakest link', () => {
    const wl = weakestLink({ profile: { raceType: 'olympic', fivekSec: 1620, css100Sec: 120, ftp: 167, weightKg: 64.2 } });
    expect(wl.weakest).toBe(null); // all ≈ intermediate
  });

  it('missing data removes a sport honestly instead of guessing', () => {
    const wl = weakestLink({ profile: { raceType: 'olympic', fivekSec: 1218, css100Sec: 120 } }); // no ftp/weight
    expect(wl.missing).toContain('bike');
    expect(wl.weakest).toBe('swim'); // judged between the two known sports
    expect(weakestLink({ profile: { fivekSec: 1218 } })).toBe(null); // one sport is no comparison
    expect(weakestLink({ profile: null })).toBe(null);
  });

  it('weakBias maps the limiter to its multiplier and stays empty when balanced', () => {
    expect(weakBias({ fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 })).toEqual({ swim: WEAK_BIAS });
    expect(weakBias({ fivekSec: 1620, css100Sec: 120 })).toEqual({});
  });
});

describe('generatePlan weakest-link bias', () => {
  const base = { name: 'J', raceType: 'olympic', fitness: 'intermediate',
    trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
    startDate: '2026-07-06', raceDate: '2026-09-21' };
  // Sum across the building weeks: round5 can absorb 10% on one short session,
  // never across a month of them.
  const mins = (p, disc) => p.weeks.slice(0, 4).flatMap(w => w.workouts)
    .filter(w => w.discipline === disc && !w.test && !w.race).reduce((a, w) => a + w.durationMin, 0);

  it('the limiter earns extra time in building weeks; balanced profiles are untouched', () => {
    const plain = generatePlan(base);
    const biased = generatePlan({ ...base, fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 });
    expect(mins(biased, 'swim')).toBeGreaterThan(mins(plain, 'swim'));
    expect(mins(biased, 'run')).toBe(mins(plain, 'run')); // only the limiter moves
  });

  it('taper keeps its race-specific shape: no bias applied', () => {
    const biased = generatePlan({ ...base, fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 });
    const plain = generatePlan(base);
    const taperSwim = p => p.weeks[p.weeks.length - 1].workouts.filter(w => w.discipline === 'swim' && !w.race);
    expect(taperSwim(biased).map(w => w.durationMin)).toEqual(taperSwim(plain).map(w => w.durationMin));
  });
});
