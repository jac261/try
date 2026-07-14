import { describe, it, expect } from 'vitest';
import { generatePlan, planEnded } from './plan.js';
import { RACES } from './domain.js';

const iso = d => d.toISOString().slice(0, 10);
function mkProfile(raceType, buildWeeksTarget, extra = {}) {
  // startDate a Monday; raceDate = start + (N*7 - 1) days => totalWeeks == N
  const start = new Date('2026-01-05T00:00:00Z'); // Monday
  const raceDate = new Date(start.getTime() + (buildWeeksTarget * 7 - 1) * 86400000);
  return {
    raceType, fitness: 'intermediate', daysPerWeek: 5,
    startDate: start, raceDate: iso(raceDate), postRace: false, ...extra,
  };
}

const raceKinds = ['sprint', 'olympic', 'half', 't100', 'full'];

describe('cap arithmetic', () => {
  for (const rk of raceKinds) {
    for (let N = 4; N <= 52; N++) {
      it(`${rk} ${N}wk-out: total<=40 savable invariants`, () => {
        const plan = generatePlan(mkProfile(rk, N));
        // weeks.length === totalWeeks always
        expect(plan.weeks.length).toBe(plan.totalWeeks);
        // build portion = N (clamped 4..52)
        const expectedBuild = Math.min(52, Math.max(4, N));
        if (expectedBuild < 40) {
          // recovery appended
          expect(plan.totalWeeks).toBe(expectedBuild + 1);
          expect(plan.totalWeeks).toBeLessThanOrEqual(40);
          expect(plan.weeks[plan.weeks.length - 1].isRecovery).toBe(true);
        } else {
          // legacy shape, no appended recovery
          expect(plan.totalWeeks).toBe(expectedBuild);
          expect(plan.weeks[plan.weeks.length - 1].isRecovery).toBe(false);
        }
        // Savability: anything savable before (old total <= 40) still savable now.
        const oldTotal = expectedBuild;
        if (oldTotal <= 40) expect(plan.totalWeeks).toBeLessThanOrEqual(40);
      });
    }
  }
});

describe('boundary 39/40', () => {
  it('full 39wk build -> recovery appended, total 40', () => {
    const plan = generatePlan(mkProfile('full', 39));
    expect(plan.totalWeeks).toBe(40);
    expect(plan.weeks.at(-1).isRecovery).toBe(true);
  });
  it('full 40wk build -> legacy, total 40, last week not recovery', () => {
    const plan = generatePlan(mkProfile('full', 40));
    expect(plan.totalWeeks).toBe(40);
    expect(plan.weeks.at(-1).isRecovery).toBe(false);
  });
});

describe('phases-array vs loop postRaceWeek', () => {
  for (const rk of raceKinds) {
    it(`${rk} 12wk: appended phase is Maintain and last week isRecovery`, () => {
      const plan = generatePlan(mkProfile(rk, 12));
      const last = plan.weeks.at(-1);
      expect(last.phase).toBe('Maintain');
      expect(last.isRecovery).toBe(true);
      // race day NOT in last week
      const hasRace = last.workouts.some(w => w.race);
      expect(hasRace).toBe(false);
    });
  }
});

describe('maintenance last week never isRecovery', () => {
  for (let H = 4; H <= 52; H++) {
    it(`maintenance horizon ${H}: last week not recovery, total==H`, () => {
      const start = new Date('2026-01-05T00:00:00Z');
      const plan = generatePlan({ raceType: 'maintenance', fitness: 'intermediate', daysPerWeek: 5, startDate: start, horizonWeeks: H });
      expect(plan.totalWeeks).toBe(H);
      expect(plan.weeks.length).toBe(H);
      expect(plan.weeks.at(-1).isRecovery).toBe(false);
    });
  }
});

describe('planEnded grace: new plan no grace, legacy 7-day', () => {
  it('new race plan ends morning after recovery week', () => {
    const plan = generatePlan(mkProfile('sprint', 8));
    const last = plan.weeks.at(-1);
    expect(last.isRecovery).toBe(true);
    // day 6 of last week: not ended; day 7: ended (no grace)
    const day6 = last.start; // compute
    // planEnded true when todayISO > start+6
    const d = new Date(last.start + 'T00:00:00Z');
    const start6 = iso(new Date(d.getTime() + 6 * 86400000));
    const start7 = iso(new Date(d.getTime() + 7 * 86400000));
    expect(planEnded(plan, start6)).toBe(false);
    expect(planEnded(plan, start7)).toBe(true);
  });
  it('legacy race plan (last week not recovery) gets 7-day grace', () => {
    const plan = generatePlan(mkProfile('full', 45)); // buildWeeks 45 >=40, legacy
    const last = plan.weeks.at(-1);
    expect(last.isRecovery).toBe(false);
    const d = new Date(last.start + 'T00:00:00Z');
    const day13 = iso(new Date(d.getTime() + 13 * 86400000)); // 6+7 grace
    const day14 = iso(new Date(d.getTime() + 14 * 86400000));
    expect(planEnded(plan, day13)).toBe(false);
    expect(planEnded(plan, day14)).toBe(true);
  });
});
