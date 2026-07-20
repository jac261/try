import { describe, it, expect } from 'vitest';
import { generatePlan, upgradePlanSegments, addCustomWorkout } from './plan.js';
import { toClientState } from './api.js';
import { reviewActivity, intervalRows } from './review.js';
import { isIndoor } from './autolog.js';
import { weakestLink } from './weakest.js';
import { saneWeightKg } from './domain.js';
import { eftpProposal } from './eftp.js';

/* The bike pass (2026-07-18): an FTP estimate so a new rider sees watt
   targets, a zone-mix distance model replacing the flat 30 km/h guess, and
   the estimate-provenance gates the design panel demanded before either
   could ship honestly. */

const noFtp = {
  name: 'B', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, weightKg: 70, // weight but NO ftp
  daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-08-30',
};
const realFtp = { ...noFtp, ftp: 250 };
const noWeight = { ...noFtp, weightKg: null };

const bikes = plan => plan.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'bike');

describe('the FTP estimate', () => {
  it('gives a weight-bearing rider watt ranges marked as estimates', () => {
    const p = generatePlan(noFtp);
    expect(p.paces.ftp).toBe(Math.round(2.6 * 70)); // the intermediate rung
    expect(p.paces.ftpEstimated).toBe(true);
    const detail = bikes(p)[0].segments.map(s => s.detail).join(' ');
    expect(detail).toMatch(/~\d+–\d+ W/);
    expect(detail).toMatch(/RPE/); // the feel band stays alongside the guess
  });

  it('a real FTP is never marked estimated and keeps the zone name', () => {
    const p = generatePlan(realFtp);
    expect(p.paces.ftp).toBe(250);
    expect(p.paces.ftpEstimated).toBe(false);
    const detail = bikes(p)[0].segments.map(s => s.detail).join(' ');
    expect(detail).toMatch(/\d+–\d+ W/);
    expect(detail).not.toMatch(/~\d+–\d+ W/);
  });

  it('without a weight there are still no watts at all', () => {
    const p = generatePlan(noWeight);
    expect(p.paces.ftp).toBe(null);
    expect(p.paces.ftpEstimated).toBe(false);
    expect(bikes(p)[0].segments.map(s => s.detail).join(' ')).not.toMatch(/W/);
  });

  it('never leaks into the profile, so the limiter board and eFTP stay honest', () => {
    const p = generatePlan(noFtp);
    // the estimate lives only on paces
    expect(p.profile.ftp == null).toBe(true);
    // weakest.js needs a real ftp to score the bike; an estimate would make
    // the bike's own score circular
    const wl = weakestLink({ profile: p.profile });
    expect(wl === null || wl.scores.bike === undefined).toBe(true);
    // and the eFTP drift banner has no baseline to drift against
    const prop = eftpProposal({
      activities: [{ id: 'a', type: 'Ride', date: '2026-06-10', eftp: 300, movingTimeSec: 3600 }],
      thresholds: null, plan: p, todayISO: '2026-06-10',
    });
    expect(prop).toBe(null);
  });
});

describe('review gates on FTP provenance', () => {
  const est = generatePlan(noFtp);
  const real = generatePlan(realFtp);
  const easyBike = plan => bikes(plan).find(x => x.type === 'Endurance' || x.type === 'Long');
  const act = watts => ({ id: 'r1', type: 'Ride', date: '2026-06-10', movingTimeSec: 3600, averageWatts: watts, distance: 30000 });

  it('stays quiet about intensity when the FTP is a guess', () => {
    const w = easyBike(est);
    const r = reviewActivity({ workout: w, activity: act(200), paces: est.paces, log: {} });
    expect((r.verdicts || []).some(v => /FTP/.test(v.text))).toBe(false);
  });

  it('judges the same ride against a real FTP', () => {
    const w = easyBike(real);
    const r = reviewActivity({ workout: w, activity: act(230), paces: real.paces, log: {} });
    expect((r.verdicts || []).some(v => /% of FTP/.test(v.text))).toBe(true);
  });

  it('rep rows still show watts on an estimate but carry no on-target tone', () => {
    const thr = addCustomWorkout(est, { discipline: 'bike', type: 'Threshold', durationMin: 60, dateISO: est.weeks[1].start }).workout;
    const rows = intervalRows({
      workout: thr, paces: est.paces,
      intervals: [{ type: 'WORK', movingTimeSec: 480, averageWatts: 180, distance: 4000 }],
    });
    expect(rows.rows[0].watts).toBe(180); // the number is real, show it
    expect(rows.rows[0].tone).toBeUndefined();
    expect(rows.judged).toBe(0);
    // the same rep against a real FTP is judged
    const thrReal = addCustomWorkout(real, { discipline: 'bike', type: 'Threshold', durationMin: 60, dateISO: real.weeks[1].start }).workout;
    const judged = intervalRows({
      workout: thrReal, paces: real.paces,
      intervals: [{ type: 'WORK', movingTimeSec: 480, averageWatts: 250, distance: 4000 }],
    });
    expect(judged.judged).toBe(1);
    expect(judged.rows[0].tone).toBe('good');
  });
});

describe('the zone-mix distance model', () => {
  it('an interval ride and an endurance ride of equal length now differ', () => {
    const p = generatePlan(realFtp);
    const day = p.weeks[1].start;
    const endur = addCustomWorkout(p, { discipline: 'bike', type: 'Endurance', durationMin: 90, dateISO: day }).workout;
    const vo2 = addCustomWorkout(p, { discipline: 'bike', type: 'VO2 Intervals', durationMin: 90, dateISO: day }).workout;
    // The old flat model called these identical. They are not: an interval
    // session spends most of its time warming up and spinning easy between
    // short reps, so it covers LESS ground than a steady endurance ride of
    // the same length. That direction is the honest one.
    expect(vo2.distance).not.toBe(endur.distance);
    expect(vo2.distance).toBeLessThan(endur.distance);
    // both stay honest about being estimates
    expect(endur.distEst).toBe(true);
    expect(vo2.distEst).toBe(true);
  });

  it('a stronger rider covers more ground in the same session', () => {
    const day = w => w.weeks[1].start;
    const strong = generatePlan({ ...noFtp, fitness: 'elite' });
    const weak = generatePlan({ ...noFtp, fitness: 'beginner' });
    const dS = addCustomWorkout(strong, { discipline: 'bike', type: 'Endurance', durationMin: 90, dateISO: day(strong) }).workout.distance;
    const dW = addCustomWorkout(weak, { discipline: 'bike', type: 'Endurance', durationMin: 90, dateISO: day(weak) }).workout.distance;
    expect(dS).toBeGreaterThan(dW);
    // speed scales far more slowly than power: not a 2x spread for 2x W/kg
    expect(dS / dW).toBeLessThan(1.5);
  });

  it('every generated ride stays in a believable speed range', () => {
    ['beginner', 'intermediate', 'advanced', 'elite'].forEach(fitness => {
      // the FTP test carries no distance by design (its length is a protocol,
      // not a ride), so it has no speed to check
      bikes(generatePlan({ ...noFtp, fitness })).filter(w => !w.test && w.distance).forEach(w => {
        const kmh = w.distance / (w.durationMin / 60);
        expect(kmh, fitness + ' ' + w.type + ' ' + w.durationMin + 'min').toBeGreaterThan(18);
        expect(kmh, fitness + ' ' + w.type + ' ' + w.durationMin + 'min').toBeLessThan(45);
      });
    });
  });

  it('upgrades a cached plan built under the old flat 30 km/h guess', () => {
    const p = generatePlan(realFtp);
    // simulate the old model: every ride at a flat 30 km/h
    const stale = {
      ...p,
      weeks: p.weeks.map(w => ({
        ...w,
        workouts: w.workouts.map(x => x.discipline === 'bike' && x.durationMin
          ? { ...x, distance: Math.round(x.durationMin / 60 * 30) } : x),
      })),
    };
    const fixed = upgradePlanSegments(stale);
    expect(fixed).not.toBe(stale);
    const before = bikes(stale).map(x => x.distance);
    const after = bikes(fixed).map(x => x.distance);
    expect(after).not.toEqual(before);
    // and it is a fixed point: upgrading again changes nothing
    expect(upgradePlanSegments(fixed)).toBe(fixed);
  });

  it('leaves a freshly generated plan alone', () => {
    const p = generatePlan(realFtp);
    expect(upgradePlanSegments(p)).toBe(p);
  });

  it('carries the estimate flag onto the workout so the tilde can render', () => {
    // distEst lived only on the builder return value and never reached the
    // workout, so no renderer could ever have shown it (design panel).
    const p = generatePlan(realFtp);
    bikes(p).filter(w => !w.test && w.distance).forEach(w => expect(w.distEst).toBe(true));
    const runs = p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && x.distance);
    // a real 5k time means run paces are known, so run distance is NOT flagged
    runs.forEach(w => expect(w.distEst).toBe(false));
    const est = generatePlan({ ...realFtp, fivekSec: null });
    est.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && x.distance && !x.test)
      .forEach(w => expect(w.distEst).toBe(true));
  });
});

describe('gauntlet fixes', () => {
  it('level still drives ride distance when no weight is recorded', () => {
    // W/kg is a ratio and needs no body weight; tying bikeWkg to weightKg
    // flattened every weightless plan to one speed.
    const day = p => p.weeks[1].start;
    const beg = generatePlan({ ...noWeight, fitness: 'beginner' });
    const eli = generatePlan({ ...noWeight, fitness: 'elite' });
    expect(beg.paces.bikeWkg).toBe(2.0);
    expect(eli.paces.bikeWkg).toBe(4.0);
    const d = pl => addCustomWorkout(pl, { discipline: 'bike', type: 'Endurance', durationMin: 90, dateISO: day(pl) }).workout.distance;
    expect(d(eli)).toBeGreaterThan(d(beg));
  });

  it('the distance tilde survives a backend round trip', () => {
    // the plan DTO drops distEst; upgradePlanSegments backfills it on load
    const p = generatePlan(realFtp);
    const wire = {
      id: 'guid-1', profile: p.profile, race: p.race, createdAt: p.createdAt,
      updatedAt: p.createdAt, totalWeeks: p.totalWeeks, paces: p.paces,
      weeks: p.weeks.map(w => ({
        index: w.index, phase: w.phase, isRecovery: w.isRecovery, start: w.start, totalMin: w.totalMin,
        workouts: w.workouts.map(wo => ({ ...wo, id: 'guid-' + wo.id, clientWorkoutRef: wo.id })),
      })),
    };
    const hydrated = toClientState(wire).plan;
    const rides = hydrated.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'bike' && x.distance);
    expect(rides.length).toBeGreaterThan(0);
    expect(rides.some(x => x.distEst)).toBe(false); // the wire really does drop it
    const restored = upgradePlanSegments(hydrated);
    restored.weeks.flatMap(w => w.workouts)
      .filter(x => x.discipline === 'bike' && x.distance).forEach(x => expect(x.distEst).toBe(true));
  });

  it('never fabricates a speed for a trainer ride', () => {
    const p = generatePlan(realFtp);
    const w = bikes(p).find(x => x.type === 'Endurance' || x.type === 'Long');
    const indoor = { id: 'v1', type: 'VirtualRide', date: '2026-06-10', movingTimeSec: 3600, distance: 30000, averageWatts: 150 };
    expect(isIndoor(indoor)).toBe(true);
    const r = reviewActivity({ workout: w, activity: indoor, paces: p.paces, log: {} });
    expect((r.stats || []).some(st => st[0] === 'Avg speed')).toBe(false);
    // an outdoor ride still gets it
    const out = reviewActivity({ workout: w, activity: { ...indoor, id: 'r1', type: 'Ride' }, paces: p.paces, log: {} });
    expect((out.stats || []).some(st => st[0] === 'Avg speed')).toBe(true);
  });
});

describe('gauntlet round 2 fixes', () => {
  it('refuses to project an absurd weight onto a watt target', () => {
    // pounds typed as kilos, or a stray minus: no estimate beats a confident
    // wrong one. 500 kg used to render a ~975 W endurance ride.
    [-70, 0, 12, 500, 1000].forEach(weightKg => {
      const p = generatePlan({ ...noFtp, weightKg });
      expect(p.paces.ftp, String(weightKg)).toBe(null);
      expect(p.paces.ftpEstimated, String(weightKg)).toBe(false);
      const detail = bikes(p)[0].segments.map(s => s.detail).join(' ');
      expect(detail, String(weightKg)).not.toMatch(/W/);
    });
    // and the sane range still estimates
    [40, 70, 120].forEach(weightKg => {
      expect(generatePlan({ ...noFtp, weightKg }).paces.ftpEstimated).toBe(true);
    });
  });

  it('a real FTP with an absurd weight still scales distance sanely', () => {
    const p = generatePlan({ ...realFtp, weightKg: 500 });
    expect(p.paces.ftp).toBe(250);         // the athlete's own number stands
    expect(p.paces.bikeWkg).toBe(2.6);     // but 0.5 W/kg is not used to scale
  });

  it('the weakest-link ladder and the plan estimate share one source', () => {
    // they were separate literals; a rebalanced rung would have desynced them
    const wl = weakestLink({ profile: { ...realFtp, fivekSec: 1500, css100Sec: 110 } });
    expect(wl).toBeTruthy();
    // an athlete exactly on the elite rung scores at the top of the ladder
    const elite = weakestLink({ profile: { fivekSec: 1110, css100Sec: 90, ftp: 4.0 * 70, weightKg: 70, raceType: 'olympic' } });
    expect(elite.scores.bike).toBeCloseTo(3, 5);
  });
});

describe('weight sanity is one rule everywhere', () => {
  it('the limiter board refuses the same weights the plan refuses', () => {
    // it used to score the bike at the ladder floor off a typo, which could
    // name the bike the limiter and reshape the whole plan around it
    [-70, 0, 12, 500, 1000].forEach(weightKg => {
      const wl = weakestLink({ profile: { ...realFtp, weightKg } });
      expect(wl === null || wl.scores.bike === undefined, String(weightKg)).toBe(true);
    });
    const ok = weakestLink({ profile: { ...realFtp, weightKg: 70 } });
    expect(ok.scores.bike).toBeGreaterThan(0);
  });

  it('saneWeightKg is the single definition', () => {
    expect(saneWeightKg(70)).toBe(70);
    expect(saneWeightKg('70')).toBe(70);
    expect(saneWeightKg(30)).toBe(30);
    expect(saneWeightKg(250)).toBe(250);
    [29, 251, -70, 0, null, undefined, '', 'heavy'].forEach(v => expect(saneWeightKg(v), String(v)).toBe(null));
  });
});
