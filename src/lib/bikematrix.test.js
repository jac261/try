import { describe, it, expect } from 'vitest';
import { generatePlan, easeWorkout, trimWorkout, swapForLimiter, detectLimiterSwap, segMinutes } from './plan.js';
import { bikePowerAnchor, hasRealFtp, saneWeightKg, FITNESS } from './domain.js';
import { eftpProposal } from './eftp.js';
import { reviewActivity, intervalRows } from './review.js';
import {
  BIKE_TYPES, BIKE_EASY_TYPE, BIKE_POWER_TYPES,
  bikeWorkoutIssues, isTrainingRide, isBikeSegment,
} from './bikeschema.js';

/* Bike phase 1: lock down what already shipped.
 *
 * These tests exist to make the 2026-07-18 behaviour explicit rather than
 * remembered. Where a rule was won by a bug, the test names the bug, so a
 * future change that breaks it fails with the reason attached.
 */

const base = {
  name: 'B', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-09-27',
};
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
const RACES = ['sprint', 'olympic', 'half', 't100', 'full', 'maintenance'];
const ridesOf = p => p.weeks.flatMap(w => w.workouts).filter(isTrainingRide);
const plan = (over = {}) => generatePlan({ ...base, ...over });

describe('the matrix: every ride the engine can build is well formed (§1)', () => {
  it('covers every level, race, phase and recovery state without a malformed ride', () => {
    const types = new Set(), phases = new Set();
    let rides = 0, recovery = 0, deep = 0;
    LEVELS.forEach(fitness => RACES.forEach(raceType => {
      const p = plan({ fitness, raceType });
      p.weeks.forEach(wk => wk.workouts.filter(isTrainingRide).forEach(w => {
        rides++;
        types.add(w.type);
        phases.add(w.phase);
        if (wk.isRecovery) recovery++;
        expect(bikeWorkoutIssues(w), fitness + '/' + raceType + ' ' + w.type + ' ' + w.durationMin + 'min').toEqual([]);
      }));
      p.weeks.filter(wk => wk.isRecovery).forEach(wk => { if (wk.index === 0) deep++; });
    }));
    // non-vacuous: the sweep really did reach everything
    expect(rides).toBeGreaterThan(500);
    expect([...types].sort()).toEqual([...BIKE_TYPES].sort());
    ['Base', 'Build', 'Peak', 'Taper'].forEach(ph => expect(phases).toContain(ph));
    expect(recovery).toBeGreaterThan(0);
  });

  it('covers one, two and three ride weeks (three needs the limiter swap)', () => {
    const counts = new Set();
    [3, 4, 5, 6, 7].forEach(days => {
      const td = [0, 1, 2, 3, 4, 5, 6].slice(0, days);
      const p = plan({ daysPerWeek: days, trainingDays: td, longDay: td[td.length - 1] });
      p.weeks.forEach(wk => counts.add(wk.workouts.filter(isTrainingRide).length));
      ridesOf(p).forEach(w => expect(bikeWorkoutIssues(w)).toEqual([]));
    });
    // the base templates carry at most two rides: one on four days or fewer
    expect(counts).toContain(1);
    expect(counts).toContain(2);
    expect(Math.max(...counts)).toBe(2);

    // A third ride exists for a bike-LIMITED athlete, and the frequency
    // change is applied during generation rather than by a later swap:
    // swapForLimiter returns the same plan because it is already swapped.
    // FOUR rides a week is not reachable in this engine at all, so the
    // spec's four-ride case has nothing to test.
    const limited = plan({ ftp: 110, weightKg: 85, fivekSec: 1020, css100Sec: 90, raceType: 'half' });
    const maxLimited = Math.max(...limited.weeks.map(wk => wk.workouts.filter(isTrainingRide).length));
    expect(maxLimited).toBe(3);
    expect(swapForLimiter(limited, 'bike')).toBe(limited);
    expect(detectLimiterSwap(limited)).toBeTruthy();
    ridesOf(limited).forEach(w => expect(bikeWorkoutIssues(w)).toEqual([]));
  });

  it('survives a far-out full-distance plan with a distant race date', () => {
    const p = plan({ raceType: 'full', fitness: 'advanced', raceDate: '2027-06-01' });
    expect(p.weeks.some(w => w.phase === 'Maintain')).toBe(true);
    ridesOf(p).forEach(w => expect(bikeWorkoutIssues(w), w.phase + ' ' + w.type).toEqual([]));
  });

  it('survives the bike limiter frequency swap', () => {
    // a rider whose bike is clearly the weak leg
    const weak = plan({ ftp: 120, weightKg: 80, fivekSec: 1080, css100Sec: 95 });
    const swapped = swapForLimiter(weak, 'bike');
    if (swapped && swapped !== weak) {
      ridesOf(swapped).forEach(w => expect(bikeWorkoutIssues(w)).toEqual([]));
      expect(detectLimiterSwap(swapped)).toBeTruthy();
    }
  });

  it('degraded and trimmed rides stay well formed and keep their character', () => {
    const p = plan({ fitness: 'elite', raceType: 'full' });
    ridesOf(p).slice(0, 40).forEach(w => {
      [0.6, 0.8].forEach(f => {
        const t = trimWorkout(w, p, f);
        if (t) {
          expect(bikeWorkoutIssues(t), 'trim ' + w.type).toEqual([]);
          expect(t.type).toBe(w.type);          // a trim re-sizes, never re-formats
        }
      });
    });
  });
});

describe('the invariants that were won by bugs (§2)', () => {
  it('Endurance is always the easy ride, and no ride falls through to Threshold', () => {
    LEVELS.forEach(fitness => RACES.forEach(raceType => {
      ridesOf(plan({ fitness, raceType })).forEach(w => {
        if (w.role === 'easy') expect(w.type, fitness + '/' + raceType).toBe(BIKE_EASY_TYPE);
      });
    }));
  });

  it('each ladder type builds its own session rather than borrowing another format', () => {
    // the builder's final branch IS Threshold, so a type that lost its branch
    // would silently render as Threshold. Titles must stay distinct.
    const byType = {};
    LEVELS.forEach(fitness => RACES.forEach(raceType => {
      ridesOf(plan({ fitness, raceType })).forEach(w => {
        (byType[w.type] = byType[w.type] || new Set()).add(w.title);
      });
    }));
    BIKE_TYPES.forEach(t => expect(byType[t], t).toBeTruthy());
    // no two types share a title, which is what a fall-through would produce
    const titles = Object.entries(byType).flatMap(([t, set]) => [...set].map(x => t + '::' + x));
    const bare = titles.map(x => x.split('::')[1]);
    const shared = bare.filter((x, i) => bare.indexOf(x) !== i);
    shared.forEach(title => {
      const owners = Object.entries(byType).filter(([, set]) => set.has(title)).map(([t]) => t);
      expect(owners.length, 'title "' + title + '" shared by ' + owners.join(' and ')).toBe(1);
    });
  });

  it('an easy ride is never given interval blocks meant for quality work', () => {
    ridesOf(plan({ fitness: 'elite' })).filter(w => w.role === 'easy').forEach(w => {
      w.segments.forEach(s => expect(isBikeSegment(s)).toBe(true));
    });
  });

  it('far-out Maintain long rides hold to maintenance scale, at every level', () => {
    // The cap is on the SCALE, not on the finished minutes: a far-out long
    // ride is sized as if the athlete were on a maintenance plan, and the
    // level volume multiplier then applies exactly as it does everywhere
    // else. So an elite rider's capped ride is longer than a beginner's and
    // that is correct; what must never happen is a far-out full spending
    // months on its full-distance long ride.
    const longsIn = (p, phase) => p.weeks.filter(w => w.phase === phase)
      .flatMap(w => w.workouts).filter(w => w.discipline === 'bike' && w.role === 'long')
      .map(w => w.durationMin);
    LEVELS.forEach(fitness => {
      const farOut = plan({ fitness, raceType: 'full', raceDate: '2027-06-01' });
      const maintenance = plan({ fitness, raceType: 'maintenance' });
      const maintain = longsIn(farOut, 'Maintain');
      const build = longsIn(farOut, 'Build');
      const puremaint = longsIn(maintenance, 'Maintain');   // a maintenance plan is all Maintain
      expect(maintain.length, fitness).toBeGreaterThan(0);
      expect(build.length, fitness).toBeGreaterThan(0);
      // capped to what a maintenance plan would have given this same athlete
      expect(Math.max(...maintain), fitness).toBeLessThanOrEqual(Math.max(...puremaint));
      // and far below what the same athlete's Build asks for
      expect(Math.max(...maintain), fitness).toBeLessThan(Math.max(...build) * 0.6);
    });
  });
});

describe('the power anchor keeps the estimate away from everything real (§2, §4)', () => {
  it('names what kind of number it is holding', () => {
    expect(bikePowerAnchor({ ftp: 250 })).toMatchObject({ kind: 'real', ftpWatts: 250, source: 'manual' });
    expect(bikePowerAnchor({ ftp: 250, ftpMeta: { source: 'eftp', measuredAt: '2026-07-01' } }))
      .toMatchObject({ kind: 'real', source: 'eftp', measuredAt: '2026-07-01' });
    const est = bikePowerAnchor({ fitness: 'intermediate', weightKg: 75 });
    expect(est.kind).toBe('estimated');
    expect(est.ftpWatts).toBe(Math.round(FITNESS.intermediate.estWkg * 75));
    expect(est.weightKg).toBe(75);
    expect(bikePowerAnchor({ fitness: 'intermediate' }).kind).toBe('none');
    expect(bikePowerAnchor({}).kind).toBe('none');
    expect(bikePowerAnchor(null).kind).toBe('none');
  });

  it('an unusable weight produces no estimate, never a confident wrong number', () => {
    // 500 kg once read as a 975 W endurance ride
    [500, 5, 0, -70, null, undefined, 'seventy'].forEach(weightKg => {
      expect(saneWeightKg(weightKg)).toBe(null);
      expect(bikePowerAnchor({ fitness: 'elite', weightKg }).kind, String(weightKg)).toBe('none');
    });
  });

  it('an estimate is never a real FTP, whatever the level or weight', () => {
    LEVELS.forEach(fitness => {
      expect(hasRealFtp({ fitness, weightKg: 75 })).toBe(false);
      expect(hasRealFtp({ fitness, weightKg: 75, ftp: 200 })).toBe(true);
    });
  });

  it('generating a plan on an estimate never writes an FTP onto the profile', () => {
    LEVELS.forEach(fitness => {
      const p = plan({ fitness, ftp: null, weightKg: 75 });
      expect(p.profile.ftp).toBeFalsy();
      expect(p.paces.ftp).toBeGreaterThan(0);       // the card still shows watts
      expect(p.paces.ftpEstimated).toBe(true);
      expect(hasRealFtp(p.profile)).toBe(false);
    });
  });

  it('no weight means no watts anywhere, on the profile or the card', () => {
    const p = plan({ ftp: null, weightKg: null });
    expect(p.paces.ftp).toBeFalsy();
    expect(p.profile.ftp).toBeFalsy();
    expect(bikePowerAnchor(p.profile).kind).toBe('none');
  });
});

describe('the estimate never reaches a judgement (§2)', () => {
  const ride = p => ridesOf(p).find(w => BIKE_POWER_TYPES.includes(w.type));
  const activity = { id: 'a', type: 'Ride', date: '2026-07-01', movingTimeSec: 3600, distance: 30000, averageWatts: 240 };

  it('a power verdict needs a real FTP', () => {
    const real = plan({ ftp: 250 });
    const guess = plan({ ftp: null, weightKg: 75 });
    const w = ride(real);
    const easy = ridesOf(real).find(x => x.type === 'Endurance');
    const withReal = reviewActivity({ workout: easy, activity, paces: real.paces });
    const withGuess = reviewActivity({ workout: easy, activity, paces: guess.paces });
    const powerish = v => /FTP/.test(v.text);
    expect(withReal.verdicts.some(powerish)).toBe(true);
    expect(withGuess.verdicts.some(powerish)).toBe(false);
    expect(w).toBeTruthy();
  });

  it('rep rows still show watts on an estimate but carry no on-target tone', () => {
    const guess = plan({ ftp: null, weightKg: 75 });
    const w = ride(guess);
    const laps = [{ type: 'WORK', movingTimeSec: 300, averageWatts: 220, distance: 3000 }];
    const rows = intervalRows({ workout: w, intervals: laps, paces: guess.paces });
    expect(rows.rows[0].watts).toBe(220);
    expect(rows.rows[0].tone).toBeUndefined();
    expect(rows.judged).toBe(0);
  });

  it('an eFTP proposal is refused on an estimate and offered on a real FTP', () => {
    const acts = [{ id: 'r', type: 'Ride', date: '2026-07-01', movingTimeSec: 3600, eftp: 300 }];
    const guess = plan({ ftp: null, weightKg: 75 });
    const real = plan({ ftp: 250 });
    expect(eftpProposal({ activities: acts, plan: guess, todayISO: '2026-07-02', thresholds: null })).toBe(null);
    const prop = eftpProposal({ activities: acts, plan: real, todayISO: '2026-07-02', thresholds: null });
    expect(prop && prop.sport).toBe('bike');
    expect(prop.retarget.ftp).toBe(300);
  });

  it('a solo run plan never receives a bike retarget', () => {
    const acts = [{ id: 'r', type: 'Ride', date: '2026-07-01', movingTimeSec: 3600, eftp: 300 }];
    ['run5k', 'run10k', 'runhalf', 'runmarathon'].forEach(raceType => {
      const solo = plan({ raceType, ftp: 250 });
      expect(eftpProposal({ activities: acts, plan: solo, todayISO: '2026-07-02', thresholds: null })).toBe(null);
    });
  });
});

describe('indoor rides keep what was measured and drop what was not (§2)', () => {
  const real = plan({ ftp: 250 });
  const easy = ridesOf(real).find(w => w.type === 'Endurance');
  const indoor = { id: 'v', type: 'VirtualRide', date: '2026-07-01', movingTimeSec: 3600, distance: 30000, averageWatts: 180, trainingLoad: 60 };
  const outdoor = { ...indoor, id: 'o', type: 'Ride' };

  it('keeps duration and power indoors', () => {
    const rv = reviewActivity({ workout: easy, activity: indoor, paces: real.paces });
    const stats = Object.fromEntries(rv.stats);
    expect(stats.Time).toBeTruthy();
    expect(stats['Avg power']).toBe('180 W');
  });

  it('suppresses derived speed and distance indoors, but not outdoors', () => {
    const inside = Object.fromEntries(reviewActivity({ workout: easy, activity: indoor, paces: real.paces }).stats);
    const outside = Object.fromEntries(reviewActivity({ workout: easy, activity: outdoor, paces: real.paces }).stats);
    expect(inside['Avg speed']).toBeUndefined();
    expect(outside['Avg speed']).toBeTruthy();
  });
});
