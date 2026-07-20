import { describe, it, expect } from 'vitest';
import { generatePlan, addCustomWorkout, easeWorkout, trimWorkout, upgradePlanSegments } from './plan.js';
import { toClientState } from './api.js';
import { watchSteps } from './watch.js';
import { predictRaceTimes, weeklyRunKm } from './runstats.js';
import { fmtClock } from './units.js';
import { intervalRows } from './review.js';
import { manualToActivity, mergeActivities } from './manual.js';

/* The run pass, Tier 1 (2026-07-18): race projections from a real 5k anchor,
   a weekly run volume chart, hill work that the review stops mis-grading,
   and an honest note on an injured plan's untrained race leg. Each test pins
   a design-panel catch. */

const base = {
  name: 'R', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-08-30',
};

describe('race projections', () => {
  it('only exist for a real 5k time, never the level estimate', () => {
    expect(predictRaceTimes({ ...base, fivekSec: null })).toBe(null);
    expect(predictRaceTimes(null)).toBe(null);
    expect(predictRaceTimes(base)).toBeTruthy();
  });

  it('extrapolate sensibly and hedge the marathon as a range', () => {
    const p = predictRaceTimes({ ...base, fivekSec: 1500 }); // 25:00 5k
    // 10k just over double, half over 4x: the power law, not linear scaling
    expect(p.tenK).toBeGreaterThan(3000);
    expect(p.tenK).toBeLessThan(3300);
    expect(p.halfMarathon).toBeGreaterThan(6800);
    expect(p.halfMarathon).toBeLessThan(7300);
    // the marathon is a RANGE whose honest end is meaningfully slower
    expect(p.marathon.hi).toBeGreaterThan(p.marathon.lo * 1.1);
    expect(p.marathon.lo).toBeGreaterThan(p.halfMarathon * 2);
  });

  it('fmtClock renders race times, not garbled pace strings', () => {
    expect(fmtClock(2772)).toBe('46:12');
    expect(fmtClock(12912)).toBe('3:35:12');
    expect(fmtClock(3600)).toBe('1:00:00');
    expect(fmtClock(59.6)).toBe('1:00');
  });
});

describe('weekly run volume', () => {
  const act = (date, km, type = 'Run') => ({ id: date + type, type, date, movingTimeSec: 3000, distance: km * 1000 });

  it('buckets by week, counts indoor runs, ignores other sports', () => {
    const weeks = weeklyRunKm({
      todayISO: '2026-07-18', weeks: 4,
      activities: [
        act('2026-07-13', 8), act('2026-07-15', 6, 'VirtualRun'), // this week (Mon 13th)
        act('2026-07-07', 10), // last week
        act('2026-07-08', 40, 'Ride'), // not a run
        { id: 'nodist', type: 'Run', date: '2026-07-14', movingTimeSec: 1800 }, // no distance: adds nothing
      ],
    });
    expect(weeks.length).toBe(4);
    expect(weeks[3]).toEqual({ start: '2026-07-13', km: 14 });
    expect(weeks[2]).toEqual({ start: '2026-07-06', km: 10 });
    expect(weeks[0].km).toBe(0);
  });

  it('counts a manual diary run once it carries a distance', () => {
    const entry = { id: 'e1', date: '2026-07-14', sport: 'run', sessionType: 'Easy', durationMin: 40, trainingLoad: 40, distanceKm: 7.5 };
    const merged = mergeActivities(null, [entry]);
    expect(merged[0].distance).toBe(7500);
    const weeks = weeklyRunKm({ activities: merged, todayISO: '2026-07-18', weeks: 2 });
    expect(weeks[1].km).toBe(7.5);
    // and one without a distance still contributes nothing rather than lying
    expect(manualToActivity({ ...entry, distanceKm: null }).distance).toBe(undefined);
  });
});

describe('hill work', () => {
  const p = generatePlan(base);
  const buildWeek = p.weeks.find(w => w.phase === 'Build' && !w.isRecovery);

  it('the Threshold hill circuit exists only behind the durability gate', () => {
    // seeds cycle a 4-slot menu in Build for intermediate+; Base keeps 3
    const inBuild = [0, 1, 2, 3].map(seedWk =>
      addCustomWorkout(p, { discipline: 'run', type: 'Threshold', durationMin: 55, dateISO: buildWeek.start }).workout);
    const baseWeek = p.weeks.find(w => w.phase === 'Base' && !w.isRecovery);
    const beginner = generatePlan({ ...base, fitness: 'beginner' });
    const bWeek = beginner.weeks.find(w => w.phase === 'Build' && !w.isRecovery);
    if (bWeek) {
      const wo = addCustomWorkout(beginner, { discipline: 'run', type: 'Threshold', durationMin: 55, dateISO: bWeek.start }).workout;
      expect(wo.segments.some(s => s.terrain === 'hill')).toBe(false); // beginners never
    }
    expect(baseWeek).toBeTruthy();
  });

  it('hill sessions carry the terrain tag and effort-based copy, and rebuild stably', () => {
    // find any generated or custom hill threshold in Build (seed-dependent)
    const hills = [];
    p.weeks.filter(w => (w.phase === 'Build' || w.phase === 'Peak') && !w.isRecovery).forEach(w => {
      const wo = addCustomWorkout(p, { discipline: 'run', type: 'Threshold', durationMin: 55, dateISO: w.start }).workout;
      if (wo.segments.some(s => s.terrain === 'hill')) hills.push(wo);
    });
    hills.forEach(wo => {
      const hill = wo.segments.find(s => s.terrain === 'hill');
      expect(hill.detail).toMatch(/By effort, not pace/);
      expect(hill.detail).not.toMatch(/\/km/); // no flat pace target on a climb
      // ease/trim keep the format (seed-stable)
      const trimmed = trimWorkout(wo, p, 0.85);
      expect(trimmed.segments.some(s => s.terrain === 'hill')).toBe(true);
    });
  });

  it('the rep table never grades a hill session against flat pace (existing VO2 bug fixed)', () => {
    // the VO2 uphill variant is seed % 3 === 2
    const w = p.weeks.find(x => (x.phase === 'Build' || x.phase === 'Peak') && !x.isRecovery && x.index % 3 === 2)
      || p.weeks.find(x => !x.isRecovery && x.index % 3 === 2);
    const vo2 = addCustomWorkout(p, { discipline: 'run', type: 'VO2 Intervals', durationMin: 50, dateISO: w.start }).workout;
    expect(vo2.segments.some(s => s.terrain === 'hill')).toBe(true);
    const rows = intervalRows({
      workout: vo2, paces: p.paces,
      intervals: [{ type: 'WORK', movingTimeSec: 75, distance: 250, averageSpeed: 250 / 75 }],
    });
    expect(rows.judged).toBe(0);           // plain splits
    expect(rows.rows[0].tone).toBeUndefined();
    // a flat VO2 session is still judged
    const flatW = p.weeks.find(x => !x.isRecovery && x.index % 3 === 0);
    const flat = addCustomWorkout(p, { discipline: 'run', type: 'VO2 Intervals', durationMin: 50, dateISO: flatW.start }).workout;
    expect(flat.segments.some(s => s.terrain === 'hill')).toBe(false);
    const judged = intervalRows({
      workout: flat, paces: p.paces,
      intervals: [{ type: 'WORK', movingTimeSec: 180, distance: 1000, averageSpeed: 1000 / 180 }],
    });
    expect(judged.judged).toBe(1);
  });
});

describe('race day for an injured-state plan', () => {
  it('keeps every leg (race day is the real race) and cautions the untrained one', () => {
    const p = generatePlan({ ...base, excludedDiscipline: 'run' });
    const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
    expect(raceDay.segments.length).toBe(3); // never drops a leg
    const runLeg = raceDay.segments.find(s => /^Run/.test(s.label));
    expect(runLeg.detail).toMatch(/untrained in this plan/);
    const swimLeg = raceDay.segments.find(s => /^Swim/.test(s.label));
    expect(swimLeg.detail).not.toMatch(/untrained/);
  });

  it('a full-fitness plan has no caution', () => {
    const p = generatePlan(base);
    const raceDay = p.weeks.flatMap(w => w.workouts).find(w => w.race);
    raceDay.segments.forEach(s => expect(s.detail).not.toMatch(/untrained/));
  });
});

describe('gauntlet fixes', () => {
  it('every Threshold format reaches a real building week (recovery-cadence collision)', () => {
    // a flat seed % 4 starved whichever slot sat on the recovery residue:
    // first the hill circuit, then (moved) the 12-min cruise. The stepped
    // selector must leave no format unreachable on a long plan.
    const long = generatePlan({ ...base, raceType: 'full', raceDate: '2027-03-28' });
    const formats = new Set();
    long.weeks.filter(w => (w.phase === 'Build' || w.phase === 'Peak') && !w.isRecovery).forEach(w => {
      const wo = addCustomWorkout(long, { discipline: 'run', type: 'Threshold', durationMin: 60, dateISO: w.start }).workout;
      const label = wo.segments[1].label;
      formats.add(/uphill/.test(label) ? 'hill' : /12 min cruise/.test(label) ? 'cruise12'
        : /9 min/.test(label) ? 'reps9' : 'cruise5');
    });
    expect(formats.has('hill')).toBe(true);
    expect(formats.has('cruise12')).toBe(true);
    expect(formats.size).toBe(4);
  });

  const withHill = () => {
    // deterministically place a hill threshold IN the plan: probe building
    // weeks until the stepped selector lands on the hill slot
    const p0 = generatePlan(base);
    for (const w of p0.weeks.filter(x => (x.phase === 'Build' || x.phase === 'Peak') && !x.isRecovery)) {
      const r = addCustomWorkout(p0, { discipline: 'run', type: 'Threshold', durationMin: 60, dateISO: w.start });
      if (r.workout.segments.some(s => s.terrain === 'hill')) return r;
    }
    throw new Error('no hill-slot building week in the probe plan');
  };

  it('terrain survives a backend round-trip (the distEst failure class)', () => {
    const p = withHill().plan;
    const wire = {
      id: 'guid-1', profile: p.profile, race: p.race, createdAt: p.createdAt,
      updatedAt: p.createdAt, totalWeeks: p.totalWeeks, paces: p.paces,
      weeks: p.weeks.map(w => ({
        index: w.index, phase: w.phase, isRecovery: w.isRecovery, start: w.start, totalMin: w.totalMin,
        // the deployed segment DTO echoes zone/blocks but not terrain
        workouts: w.workouts.map(wo => ({
          ...wo, id: 'guid-' + wo.id, clientWorkoutRef: wo.id,
          segments: (wo.segments || []).map(({ terrain, ...rest }) => rest),
        })),
      })),
    };
    const hydrated = toClientState(wire).plan;
    const flat = pl => pl.weeks.flatMap(w => w.workouts).filter(x => x.segments.some(s => /uphill/i.test(s.label || '')));
    expect(flat(hydrated).some(x => x.segments.some(s => s.terrain === 'hill'))).toBe(false); // really dropped
    const restored = upgradePlanSegments(hydrated);
    const hills = flat(restored);
    expect(hills.length).toBeGreaterThan(0);
    hills.forEach(x => expect(x.segments.some(s => s.terrain === 'hill')).toBe(true));
    expect(upgradePlanSegments(restored)).toBe(restored); // idempotent
  });

  it('the watch never pushes a pace target for a hill work step', () => {
    const { plan: p, workout: hill } = withHill();
    expect(hill.segments.some(s => s.terrain === 'hill')).toBe(true);
    const steps = watchSteps(hill);
    expect(steps).toBeTruthy();
    // work steps in the hill section carry no pace token; recoveries keep one
    const lines = steps.dsl.split('\n');
    expect(lines.some(l => /Z[45] Pace/.test(l))).toBe(false);
    expect(lines.some(l => /Z[12] Pace/.test(l))).toBe(true);
    // a flat threshold session still gets its pace targets
    const flat = p.weeks.flatMap(w => w.workouts)
      .find(x => x.discipline === 'run' && x.type === 'Threshold' && !x.segments.some(s => s.terrain === 'hill'));
    if (flat) expect(watchSteps(flat).dsl).toMatch(/Z4 Pace/);
  });
});
