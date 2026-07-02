import { describe, it, expect } from 'vitest';
import { generatePlan, easeWorkout } from './plan.js';
import { iso, addDays } from './date.js';

const profile = (raceDate, startDate) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  raceDate, startDate,
});

describe('generatePlan', () => {
  it('produces weeks, paces and a clamped week count', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    expect(Array.isArray(p.weeks)).toBe(true);
    expect(p.weeks.length).toBe(p.totalWeeks);
    expect(p.totalWeeks).toBeGreaterThanOrEqual(4);
    expect(p.totalWeeks).toBeLessThanOrEqual(40);
    expect(p.paces).toBeTruthy();
  });

  it('marks race day on the EXACT race date across every offset (regression: ceil week count)', () => {
    const start = '2026-07-01';
    for (let d = 28; d <= 200; d += 1) {
      const raceDate = iso(addDays(start, d));
      const p = generatePlan(profile(raceDate, start));
      if (p.totalWeeks >= 40) continue; // beyond the clamp the race is unreachable by design
      const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
      expect(raceDay, `offset ${d} days`).toBeTruthy();
      expect(raceDay.date, `offset ${d} days`).toBe(raceDate);
    }
  });

  it('clamps very short and very long horizons', () => {
    const short = generatePlan(profile(iso(addDays('2026-07-01', 10)), '2026-07-01'));
    expect(short.totalWeeks).toBe(4);
    const long = generatePlan(profile(iso(addDays('2026-07-01', 500)), '2026-07-01'));
    expect(long.totalWeeks).toBe(40);
  });
});

describe('easeWorkout', () => {
  it('downgrades a run to easy aerobic at reduced volume', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    const run = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'run' && w.durationMin > 0);
    const eased = easeWorkout(run, p);
    expect(eased.eased).toBe(true);
    expect(eased.type).toBe('Easy');
    expect(eased.durationMin).toBeLessThanOrEqual(run.durationMin);
    expect(eased.easedFrom).toBe(run.type);
  });

  it('leaves non-swim/bike/run sessions untouched', () => {
    const p = generatePlan(profile('2026-09-23', '2026-07-01'));
    const strength = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'strength');
    if (strength) expect(easeWorkout(strength, p)).toBe(strength);
  });
});
