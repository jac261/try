import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { RACES } from './domain.js';
import {
  runDashboard, currentPerformance, trainingVolume,
  qualityProgression, durability, nextAction, runStoredReviews,
} from './run-dashboard.js';

/* Run phase 9 — the dashboard.
 *
 * §3, §4 and §5 are NOT implemented, and cannot be from the client: run-only
 * maintenance, duathlon and aquathlon each need a race-type string, and
 * PlanCatalog.RaceTypes is a closed set that rejects unknown strings with a
 * 400. The handoff carries the ask. Building the templates client-side first
 * would produce plans that generate correctly and then fail to save, which is
 * worse than not having them. See the "blocked on the catalog" test below,
 * which pins the reason so it cannot be quietly forgotten.
 */

const TODAY = '2026-07-29';
const base = {
  name: 'R', css100Sec: 110, ftp: 250, weightKg: 70,
  daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const REAL = { fivekSec: 1500, fivekMeta: { source: 'try-test', measuredAt: '2026-07-01', confidence: 'high' } };
const planFor = extra => generatePlan({ ...base, ...extra, raceType: 'runmarathon', fitness: 'intermediate' });
const MONDAY = '2026-07-27';
const day = (back, off) => { const d = new Date(MONDAY); d.setDate(d.getDate() - back * 7 + off); return d.toISOString().slice(0, 10); };
const acts = () => {
  const a = [];
  for (let w = 1; w <= 6; w++) [0, 2, 4].forEach((off, i) =>
    a.push({ type: i === 0 ? 'VirtualRun' : 'Run', date: day(w, off), movingTimeSec: (i === 2 ? 90 : 40) * 60, distance: (i === 2 ? 18000 : 8000) }));
  return a;
};
const review = (type, over) => ({
  discipline: 'run', type, completion: 1, paceAdherence: over ? 50 : 0,
  confidence: 'high', terrainAdjusted: false, intervalFadePercent: 2, date: '2026-07-10',
});

describe('the dashboard distinguishes real from estimated performance', () => {
  it('reports the anchor kind alongside the value', () => {
    const real = currentPerformance({ ...base, ...REAL, raceType: 'runmarathon' });
    expect(real.benchmark.kind).toBe('real');
    expect(real.benchmark.value).toBe(1500);
    expect(real.measuredAt).toBe('2026-07-01');
    const est = currentPerformance({ ...base, fitness: 'intermediate', raceType: 'runmarathon' });
    expect(est.benchmark.kind).toBe('estimated');
    expect(est.benchmark.note).toBe('runner-level');
  });

  it('omits projections entirely for an estimate rather than approximating them', () => {
    // §6. A projection from a level guess is a finish time derived from
    // nothing the athlete has ever done, and a tilde does not fix that.
    const est = currentPerformance({ ...base, fitness: 'intermediate', raceType: 'runmarathon' });
    expect(est.projections).toBe(null);
    expect(est.projectionConfidence).toBe(null);
    const real = currentPerformance({ ...base, ...REAL, raceType: 'runmarathon' });
    expect(real.projections).toBeTruthy();
    expect(real.projections.marathon.lo).toBeGreaterThan(0);
    expect(real.projectionConfidence).toBe('high');
  });

  it('a feel-nudged estimate does not read as a benchmark here either', () => {
    // Phase 5's rule, on phase 9's surface.
    const nudged = currentPerformance({ ...base, fivekSec: 1646, fivekMeta: { source: 'estimated' }, raceType: 'runmarathon' });
    expect(nudged.benchmark.kind).toBe('estimated');
    expect(nudged.projections).toBe(null);
  });
});

describe('the volume section answers whether volume is progressing safely', () => {
  const v = trainingVolume({ activities: acts(), todayISO: TODAY });

  it('keeps the eight-week chart and the dimensions around it', () => {
    expect(v.weeks.length).toBe(8);
    expect(v.frequency).toBe(3);
    expect(v.longShare).toBeGreaterThan(0);
    expect(v.indoorShare).toBeGreaterThan(0);   // indoor counts toward volume
    expect(v.signals).toEqual([]);              // a steady block says nothing
  });

  it('surfaces load cautions rather than a load number', () => {
    const spiked = acts().concat([0, 1, 2, 3, 4, 5].map(i => ({ type: 'Run', date: day(0, i), movingTimeSec: 40 * 60, distance: 8000 })));
    const s = trainingVolume({ activities: spiked, todayISO: TODAY });
    expect(s.signals.length).toBeGreaterThan(0);
    s.signals.forEach(sig => expect(sig.why).toBeTruthy());
  });
});

describe('quality and durability sections', () => {
  it('counts quality by type without inventing a trend from missing data', () => {
    const q = qualityProgression({ reviews: [review('Threshold'), review('Threshold'), review('VO2 Intervals')] });
    expect(q.byType.Threshold.sessions).toBe(2);
    expect(q.byType.Threshold.completed).toBe(2);
    expect(q.byType['VO2 Intervals'].sessions).toBe(1);
    // a type with no sessions reports none, not zero-as-a-verdict
    expect(q.byType.Tempo.sessions).toBe(0);
    expect(q.byType.Tempo.fade).toBe(null);
  });

  it('reports the long run trend from what has actually happened', () => {
    const plan = planFor(REAL);
    const d = durability({ plan, todayISO: '2026-08-15' });
    expect(d.longestMin).toBeGreaterThan(0);
    expect(d.mix.total).toBeGreaterThan(0);
    expect(d.mix.withinGuidance).toBe(true);
    // and nothing beyond today counts as done
    const early = durability({ plan, todayISO: '2026-06-15' });
    expect(early.mix.total).toBeLessThan(d.mix.total);
  });
});

describe('the next action is explicit and evidenced', () => {
  it('names a limiter and never a score', () => {
    const plan = planFor(REAL);
    const n = nextAction({
      profile: { ...base, ...REAL }, reviews: [], plan, raceKey: 'runmarathon',
      volume: [{ minutes: 200 }, { minutes: 210 }], signals: [{ key: 'x', caution: 'ramping fast' }],
      longs: plan.weeks.flatMap(w => w.workouts).filter(x => x.type === 'Long'),
    });
    expect(n.limiter).toBeTruthy();
    expect(n.limiter.why).toBeTruthy();
    expect(n.readiness.loadStability.state).toBe('at-risk');
  });

  it('an at-risk component outranks a building one wherever it sits', () => {
    /* The fixture matters. A first version put the only at-risk component
       LAST, so picking the last gap returned it too and the test passed with
       the priority deleted. This puts at-risk EARLY (speed, from sessions
       landing off target) and building LATE (fuelling, part-rehearsed), so
       only an ordering that actually prefers at-risk can pass. */
    const plan = planFor(REAL);
    const offTarget = Array.from({ length: 3 }, () => review('VO2 Intervals', true));
    const n = nextAction({
      profile: { ...base, ...REAL }, plan, raceKey: 'runmarathon',
      reviews: offTarget,
      volume: [{ minutes: 200 }, { minutes: 210 }],
      signals: [],                       // load is fine, so it is not a gap
      fuelLogs: [{ level: 'solid' }],    // partially rehearsed: 'building'
      longs: plan.weeks.flatMap(w => w.workouts).filter(x => x.type === 'Long'),
    });
    expect(n.readiness.speed.state).toBe('at-risk');
    expect(n.readiness.fuelling.state).toBe('building');
    expect(n.limiter.component).toBe('speed');
    expect(n.limiter.state).toBe('at-risk');
  });

  it('changes nothing on a single session, however emphatic', () => {
    // The dashboard must not be the surface that quietly lets one run
    // retarget a plan.
    const one = nextAction({ profile: { ...base, ...REAL }, reviews: [review('Threshold', true)], raceKey: 'runmarathon' });
    expect(one.response).toBe(null);
    const three = nextAction({
      profile: { ...base, ...REAL }, raceKey: 'runmarathon',
      reviews: [review('Threshold'), review('Threshold'), review('Tempo')],
    });
    expect(three.response).toBeTruthy();
    expect(three.response.because).toMatch(/3 recent sessions/);
  });

  it('recommends a benchmark only when there is not a real one', () => {
    expect(nextAction({ profile: { ...base, ...REAL }, raceKey: 'runmarathon' }).nextBenchmark).toBe(null);
    expect(nextAction({ profile: { ...base, fitness: 'intermediate' }, raceKey: 'runmarathon' }).nextBenchmark).toMatch(/5 km test/);
  });
});

describe('stored reviews reaching the dashboard', () => {
  it('stale tune-up reviews persisted before the run-review gate never surface', () => {
    // the persistence layer never deletes (a null must not clear a stored
    // review), so the shared derivation filters them out instead
    const plan = { weeks: [{ workouts: [
      { id: 'a', date: '2026-07-01', discipline: 'run', type: 'Threshold' },
      { id: 'b', date: '2026-07-03', discipline: 'run', type: 'RACE', bRace: true },
    ] }] };
    const log = {
      a: { done: true, runReview: { discipline: 'run', type: 'Threshold', confidence: 'high' } },
      b: { done: true, runReview: { discipline: 'run', type: 'RACE', confidence: 'low' } },
    };
    expect(runStoredReviews(plan, log, {}).map(r => r.type)).toEqual(['Threshold']);
  });
});

describe('the whole dashboard', () => {
  it('assembles on a day-one athlete with nothing recorded', () => {
    // No activities, no reviews, no history. Empty sections, not a crash and
    // not a fabricated zero.
    const plan = planFor({ fitness: 'intermediate' });
    const d = runDashboard({ profile: plan.profile, plan, todayISO: TODAY, raceKey: 'runmarathon' });
    expect(d.discipline).toBe('run');
    expect(d.currentPerformance.benchmark.kind).toBe('estimated');
    expect(d.currentPerformance.projections).toBe(null);
    expect(d.trainingVolume.weeks.length).toBe(8);
    expect(d.nextAction.response).toBe(null);
    expect(d.nextAction.nextBenchmark).toBeTruthy();
  });

  it('assembles on a fully evidenced athlete', () => {
    const plan = planFor(REAL);
    const d = runDashboard({
      profile: plan.profile, plan, activities: acts(), todayISO: TODAY, raceKey: 'runmarathon',
      reviews: [review('Threshold'), review('Threshold'), review('Tempo')],
      fuelLogs: [{ level: 'solid' }, { level: 'race' }],
    });
    expect(d.currentPerformance.benchmark.kind).toBe('real');
    expect(d.currentPerformance.projections).toBeTruthy();
    expect(d.trainingVolume.frequency).toBe(3);
    expect(d.durability.fuelledLongs).toBe(2);
    expect(d.nextAction.readiness.speed).toBeTruthy();
  });

  it('does not redraw what intervals.icu already draws', () => {
    // §6. Every section supports a decision the plan is about to make;
    // anything merely interesting belongs in the tool already open.
    const plan = planFor(REAL);
    const d = runDashboard({ profile: plan.profile, plan, activities: acts(), todayISO: TODAY, raceKey: 'runmarathon' });
    const keys = JSON.stringify(d);
    ['heartRateZones', 'powerCurve', 'trainingLoad', 'ctl', 'atl', 'tsb']
      .forEach(k => expect(keys.includes(k), 'dashboard redraws ' + k).toBe(false));
  });
});

describe('maintenance, duathlon and aquathlon are blocked on the catalog', () => {
  it('no race type combines a run-only plan with no race day', () => {
    /* §3 asks for run-only maintenance blocks. They cannot exist client-side:
       the template choice reads race.solo, the maintenance race has none, and
       excluding swim from it still leaves a bike plan. Expressing it needs a
       NEW race-type string, and PlanCatalog.RaceTypes rejects unknown strings
       with a 400 that trips the sync-failure banner.

       Pinned as a test rather than left as a comment so that whoever adds the
       catalog entry finds the exact shape waiting for them, and so the gap
       cannot be mistaken for an oversight. */
    const runOnlyMaintenance = Object.entries(RACES).filter(([, r]) => r.noRace && r.solo === 'run');
    expect(runOnlyMaintenance).toEqual([]);
    // and the shape it would need, so the intent is unambiguous
    expect(RACES.maintenance.noRace).toBe(true);
    expect(RACES.maintenance.solo).toBeUndefined();
  });

  it('duathlon and aquathlon do not exist yet, in either catalog', () => {
    // §4 and §5. Two run legs and a swim-to-run transition are real product
    // design, not a template rename, and the handoff already records that
    // they were deliberately not batched with the Tier 2 run race types.
    expect(RACES.duathlon).toBeUndefined();
    expect(RACES.aquathlon).toBeUndefined();
  });
});
