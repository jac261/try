import { describe, it, expect } from 'vitest';
import { generatePlan, trimWorkout } from './plan.js';
import { weeklyRunKm } from './runstats.js';
import { runVolumeModel } from './run-durability.js';
import { soloPlanIssues, soloWeekSpacingIssues, SOLO_SPACING } from './run-plans.js';
import { RUN_QUALITY_TYPES } from './runschema.js';

/* The 2026-07-29 audit's correctness findings, pinned. Six defects, all
 * found by a reviewer executing generated output, all verified by
 * reproduction before fixing. Each test here fails on the pre-fix engine.
 */

const base = {
  name: 'R', fivekSec: 1500, fivekMeta: { source: 'try-test' }, css100Sec: 110,
  ftp: 250, weightKg: 70, startDate: '2026-06-01', longDay: 5,
};
const D5 = [0, 1, 3, 5, 6];
const longsWithRp = p => p.weeks.flatMap(w => w.workouts)
  .filter(x => x.type === 'Long' && x.racePaceMin);
const blockOf = x => (x.segments || []).find(s => /marathon effort|half marathon effort/i.test(s.label || ''));

describe('audit C1: every rebuild path carries racePaceMin', () => {
  it('the weekly-hours anchor cut keeps the race-pace block on the card', () => {
    // The anchor post-pass rebuilt the long without racePaceMin: the block
    // vanished from the card while the stored field survived, and a later
    // boost would have silently reinstated it.
    const p = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'elite', daysPerWeek: 5, trainingDays: D5, raceDate: '2026-10-04', weeklyHours: 2 });
    const longs = longsWithRp(p);
    expect(longs.length).toBeGreaterThan(0);
    longs.forEach(x => expect(blockOf(x), x.date + ' lost its block').toBeTruthy());
  });

  it('a trim keeps the block, rescaled to the smaller session', () => {
    const p = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5, trainingDays: D5, raceDate: '2026-10-04' });
    const long = longsWithRp(p)[0];
    const trimmed = trimWorkout(long, p, 0.5);
    const b = blockOf(trimmed);
    expect(b).toBeTruthy();
    expect(b.min).toBeLessThanOrEqual(trimmed.durationMin - 25);
  });
});

describe('audit C2: the block is rescaled against the duration it has', () => {
  it('an anchored low-volume athlete never gets a long that is mostly race pace', () => {
    // Before: longest recent run 20 minutes produced a 45-minute long that
    // was 89% marathon effort — the session's character inverted for exactly
    // the athlete the start-volume anchor exists to protect.
    const p = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5, trainingDays: D5, raceDate: '2026-10-04', longestRunMin: 20 });
    const longs = longsWithRp(p);
    expect(longs.length).toBeGreaterThan(0);
    longs.forEach(x => {
      const b = blockOf(x);
      if (!b) return; // squeezed under the floor: a plain long is the right card
      expect(b.min / x.durationMin, x.date + ' block share').toBeLessThanOrEqual(0.5);
      // the lead-in the rescale exists to protect
      expect(x.durationMin - b.min).toBeGreaterThanOrEqual(20);
    });
  });

  it('unanchored race-sized longs are untouched by the rescale', () => {
    // min(rp, dur - 25) only binds when the session is small; across the
    // normal matrix no race-sized long is within 25 minutes of its block.
    const p = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5, trainingDays: D5, raceDate: '2026-10-04' });
    longsWithRp(p).forEach(x => {
      const b = blockOf(x);
      expect(b.min, x.date).toBe(x.racePaceMin);
    });
  });
});

describe('audit C3: a plan does not train past its own race', () => {
  it('weeks after race week are recovery, not Peak and Taper', () => {
    // The clamp to race.minWeeks put the race in an early week; the weeks
    // after it ran the untouched program — two more VO2/Threshold weeks and
    // a taper toward nothing, the class phase 1b removed from race week.
    const p = generatePlan({ ...base, raceType: 'run5k', fitness: 'intermediate', daysPerWeek: 5, trainingDays: D5, raceDate: '2026-06-11' });
    const rwi = p.weeks.findIndex(w => w.workouts.some(x => x.race));
    expect(rwi).toBeLessThan(p.weeks.length - 2); // the short runway really is short
    p.weeks.forEach((w, i) => {
      if (i <= rwi) return;
      expect(w.isRecovery, 'wk' + i + ' after the race is not recovery').toBe(true);
      const hard = w.workouts.filter(x => x.discipline === 'run' && RUN_QUALITY_TYPES.includes(x.type));
      expect(hard.length, 'wk' + i + ' trains after the race').toBe(0);
      expect(w.workouts.some(x => x.test), 'wk' + i + ' hosts a test after the race').toBe(false);
    });
  });

  it('a normal runway is byte-unaffected: race week is the last build week', () => {
    const p = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5, trainingDays: D5, raceDate: '2026-10-04' });
    const rwi = p.weeks.findIndex(w => w.workouts.some(x => x.race));
    expect(rwi).toBe(p.weeks.length - 2); // only the appended recovery week follows
  });
});

describe('audit C4: a demoted race-week test stops being a test', () => {
  it('the pre-race easy jog carries no test flags', () => {
    // Leaving test/testKind on the demoted jog made the auto-5k matcher
    // treat the shakeout as the benchmark test day and pair its recording.
    const p = generatePlan({ ...base, raceType: 'run5k', fitness: 'intermediate', daysPerWeek: 5, trainingDays: D5, raceDate: '2026-06-09' });
    const demoted = p.weeks.flatMap(w => w.workouts).filter(x => x.raceWeekFrom === 'Test');
    expect(demoted.length).toBeGreaterThan(0); // the fixture really demotes one
    demoted.forEach(x => {
      expect(x.test).toBeUndefined();
      expect(x.testKind).toBeUndefined();
      expect(x.type).toBe('Easy');
    });
  });
});

describe('audit C5: the dashboard and the Progress chart agree on kilometres', () => {
  it('a distance-only diary entry counts in both, identically', () => {
    const acts = [
      { type: 'Run', date: '2026-07-27', distance: 10000, movingTimeSec: 3000 },
      { type: 'Run', date: '2026-07-28', distance: 8000 },              // no duration
      { type: 'Run', date: '2026-07-28', movingTimeSec: 1800 },         // no distance
    ];
    const wk = weeklyRunKm({ activities: acts, todayISO: '2026-07-29' }).slice(-1)[0];
    const vm = runVolumeModel({ activities: acts, todayISO: '2026-07-29' }).slice(-1)[0];
    expect(vm.km).toBe(wk.km);
    expect(vm.km).toBe(18);
    expect(vm.minutes).toBe(80); // duration metrics still only count duration
    expect(vm.runs).toBe(3);
  });
});

describe('audit C6: impossible spacing geometry demotes rather than crowds', () => {
  it('a dayset where no placement honours both rules yields one quality and no violations', () => {
    // Tue/Wed/Fri/Sat, long on Saturday: every second-quality candidate is
    // adjacent to the first quality or to the long. The shipped tie-break
    // placed it the day before the long, and the engine's own checker
    // flagged the engine's own output.
    const p = generatePlan({ ...base, raceType: 'run10k', fitness: 'intermediate', daysPerWeek: 4, trainingDays: [1, 2, 4, 5], raceDate: '2026-10-03' });
    expect(soloPlanIssues(p, 4)).toEqual([]);
    const w = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery && !x.workouts.some(y => y.test));
    const q = w.workouts.filter(x => x.discipline === 'run' && RUN_QUALITY_TYPES.includes(x.type));
    expect(q.length).toBe(1);
    expect(w.workouts.filter(x => x.discipline === 'run' && !x.race).length).toBe(4); // demoted, not deleted
  });

  it('possible geometries keep both qualities exactly as before', () => {
    const p = generatePlan({ ...base, raceType: 'run10k', fitness: 'intermediate', daysPerWeek: 4, trainingDays: [1, 2, 4, 6], raceDate: '2026-10-03' });
    const w = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery && !x.workouts.some(y => y.test));
    const q = w.workouts.filter(x => x.discipline === 'run' && RUN_QUALITY_TYPES.includes(x.type));
    expect(q.length).toBe(2);
    expect(soloWeekSpacingIssues(w)).toEqual([]);
    expect(SOLO_SPACING.minQualityGapDays).toBe(2);
  });
});

describe('audit completeness: the phase 8 and 9 surfaces have callers', () => {
  /* The audit's completeness lens found runReview, runFuellingPlan,
     runDashboard and the test-failure explanations all built with no caller:
     value tests passed while nothing rendered. These assert the SOURCE of
     each wiring point, the same shape as phase 2's provenance guard, so
     deleting the wiring fails here rather than shipping quietly. */
  const read = async rel => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL(rel, import.meta.url), 'utf8');
  };

  it('DetailSheet feeds the run review into the one review voice', async () => {
    /* Phase 1 moved the computation into computeReviews (review-persist.js)
       so the sheet and the recap share one write path; the wiring this
       guard protects — a run review actually reaching reviewActivity —
       now spans two files. */
    const src = await read('../components/DetailSheet.jsx');
    expect(src).toMatch(/T\.computeReviews\(\{ workout: w/);
    expect(src).toMatch(/reviewActivity\(\{[\s\S]{0,200}runReview: reviews\.runReview/);
    const persist = await read('./review-persist.js');
    expect(persist).toMatch(/runReview\(\{ workout,/);
    // and the fuel tap is graded against the RUN's numbers on a run
    expect(src).toMatch(/runFuellingOutcome/);
    expect(src).toMatch(/runFuellingPlan/);
  });

  it('reviewActivity accepts and renders the run review', async () => {
    const src = await read('./review.js');
    expect(src).toMatch(/reviewActivity\(\{ workout, activity, paces, log, swimReview, bikeReview, runReview \}/);
    expect(src).toMatch(/runReviewVerdict\(perRepRun\)/);
  });

  it('a failed or unmatched run test reaches the athlete', async () => {
    const app = await read('../app/App.jsx');
    expect(app).toMatch(/const runFail = /);
    expect(app).toMatch(/testKind === 'run5k' && log\[w\.id\]/); // the unmatched branch
    expect(app).toMatch(/runFail=\{runFail\}/);
    const today = await read('../features/today/TodayView.jsx');
    expect(today).toMatch(/could not read a 5 km time/);
    expect(today).toMatch(/runFailDismissed/);
  });

  it('the run dashboard is mounted beside the other two', async () => {
    const pv = await read('../features/progress/ProgressView.jsx');
    expect(pv).toMatch(/<RunDashboard plan=\{plan\}/);
    expect(pv).toMatch(/solo !== 'run'|solo\) && \(T\.RACES\[plan\.race\] \|\| \{\}\)\.solo !== 'run'/);
  });
});
