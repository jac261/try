import { describe, it, expect } from 'vitest';
import { generatePlan, easeWorkout, trimWorkout } from './plan.js';
import { intervalRows } from './review.js';
import { RUN_TYPES, RUN_LADDER_TYPES, RUN_QUALITY_TYPES } from './runschema.js';
import { longRunMix, MAX_HARD_LONG_SHARE } from './run-durability.js';
import {
  RACE_PACE_CALENDAR, RACE_PACE_MIDWEEK_CAP, racePaceForWeek, racePaceSession,
} from './run-race-pace.js';
import {
  KM_PER_MILE, RUN_UNITS, kmToMiles, milesToKm, distanceForMinutes,
  fmtDistance, preferredUnit, runWorkoutDistance, repDistanceLabel,
} from './run-units.js';

/* Run phase 7 — deterministic race pace, a midweek Race Pace session, and
 * distance prescriptions.
 *
 * The first phase of this arc that adds features rather than formalising
 * them, so it is also the first whose generation deliberately changes.
 */

const DAYSETS = { 3: [1, 3, 5], 5: [0, 1, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const base = { name: 'R', css100Sec: 110, ftp: 250, weightKg: 70, startDate: '2026-06-01', raceDate: '2026-10-03' };
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
const REAL = { fivekSec: 1500, fivekMeta: { source: 'try-test' } };
const planFor = (rt, fit, d, extra) => generatePlan({
  ...base, ...REAL, ...extra, raceType: rt, fitness: fit,
  daysPerWeek: d, trainingDays: DAYSETS[d], longDay: 5,
});
const allRuns = p => p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && !x.race);

describe('the race-pace calendar is deterministic', () => {
  it('depends only on race, phase and phase-week, never on a seed', () => {
    const call = () => racePaceForWeek({ raceKey: 'runmarathon', phase: 'Peak', phaseWeek: 0, isRecovery: false, isRaceWeek: false });
    expect(call()).toEqual(call());
    expect(call()).toEqual({ longMin: 50 });
  });

  it('runs off the end of the schedule rather than repeating its last entry', () => {
    // Clamping here is what drove a first draft to a 41% hard-long share: a
    // long Build phase kept firing the final entry every week.
    const late = racePaceForWeek({ raceKey: 'runhalf', phase: 'Build', phaseWeek: 9, isRecovery: false, isRaceWeek: false });
    expect(late).toBe(null);
  });

  it('is silent in recovery weeks, race week, and for races without one', () => {
    const args = { raceKey: 'runmarathon', phase: 'Build', phaseWeek: 3 };
    expect(racePaceForWeek({ ...args, isRecovery: true })).toBe(null);
    expect(racePaceForWeek({ ...args, isRaceWeek: true })).toBe(null);
    expect(racePaceForWeek({ ...args, raceKey: 'run5k' })).toBe(null);
    expect(racePaceForWeek({ ...args, raceKey: 'olympic' })).toBe(null);
    expect(racePaceForWeek({ ...args })).toEqual({ longMin: 40 });
  });

  it('covers only the half and marathon', () => {
    expect(Object.keys(RACE_PACE_CALENDAR).sort()).toEqual(['runhalf', 'runmarathon']);
  });

  it('beginners are not excluded', () => {
    /* A first draft gated them out. The modulo trap that once made the
       race-pace slot unreachable for beginners was found and fixed
       deliberately, and re-excluding them would quietly undo that fix under a
       new justification. */
    const p = planFor('runmarathon', 'beginner', 5);
    const rp = allRuns(p).flatMap(x => x.segments || [])
      .filter(s => /marathon effort/i.test(s.label || ''));
    expect(rp.length).toBeGreaterThan(0);
  });

  it('still honours the ceiling on hard long runs', () => {
    // The rule phase 6 established. A deterministic calendar makes it easy to
    // prescribe more race pace than the long run can absorb.
    for (const rt of ['runhalf', 'runmarathon']) {
      for (const fit of LEVELS) {
        const p = planFor(rt, fit, 5);
        const rwi = p.weeks.findIndex(w => w.workouts.some(x => x.race));
        const longs = p.weeks.filter((w, i) => i < rwi).flatMap(w => w.workouts.filter(x => x.type === 'Long'));
        const mix = longRunMix(longs);
        expect(mix.hardShare, rt + '/' + fit + ' hard share ' + (mix.hardShare * 100).toFixed(0) + '%')
          .toBeLessThanOrEqual(MAX_HARD_LONG_SHARE);
      }
    }
  });

  it('progresses: each exposure is at least as long as the one before', () => {
    const p = planFor('runmarathon', 'intermediate', 5);
    const rwi = p.weeks.findIndex(w => w.workouts.some(x => x.race));
    const sizes = [];
    p.weeks.forEach((w, i) => {
      if (i >= rwi) return;
      w.workouts.filter(x => x.type === 'Long').forEach(x => { if (x.racePaceMin) sizes.push(x.racePaceMin); });
    });
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });
});

describe('the midweek Race Pace session', () => {
  it('is a distinct type, in the closed set, and is quality without being a rung', () => {
    expect(RUN_TYPES).toContain('Race Pace');
    expect(RUN_QUALITY_TYPES).toContain('Race Pace');
    // NOT a ladder rung: it is prescribed by a calendar, not climbed toward
    expect(RUN_LADDER_TYPES).not.toContain('Race Pace');
    // and never the lowercase spelling the spec proposed, which would 400
    expect(RUN_TYPES).not.toContain('race-pace');
  });

  it('appears on half and marathon plans, and nowhere else', () => {
    const seen = {};
    for (const rt of [...SOLO, 'olympic', 'full']) {
      for (const fit of LEVELS) {
        const n = allRuns(planFor(rt, fit, 5)).filter(x => x.type === 'Race Pace').length;
        if (n) seen[rt] = (seen[rt] || 0) + n;
      }
    }
    expect(Object.keys(seen).sort()).toEqual(['runhalf', 'runmarathon']);
  });

  it('swaps a quality slot rather than adding a hard day', () => {
    // The week must not gain a session: it trades one.
    const p = planFor('runmarathon', 'intermediate', 5);
    const rwi = p.weeks.findIndex(w => w.workouts.some(x => x.race));
    p.weeks.forEach((w, i) => {
      if (i >= rwi) return;
      const runs = w.workouts.filter(x => x.discipline === 'run' && !x.race);
      expect(runs.length).toBe(5);
      const quality = runs.filter(x => RUN_QUALITY_TYPES.includes(x.type));
      expect(quality.length).toBeLessThanOrEqual(2);
    });
  });

  it('is capped well under the long run block', () => {
    /* The cap governs race-pace WORK, not the segment holding it: a segment
       of 3 × 10 min with two 3-minute floats is 39 minutes long and 30
       minutes of race pace. Measuring the segment was the wrong reading, and
       it hid the real defect underneath — the builder was sizing the block
       from the SLOT it landed in rather than from the calendar, so a 73
       minute slot produced 48 minutes of race pace against a prescribed 25. */
    for (const rt of ['runhalf', 'runmarathon']) {
      for (const fit of LEVELS) {
        allRuns(planFor(rt, fit, 5)).filter(x => x.type === 'Race Pace')
          .forEach(x => {
            expect(x.racePaceMin, rt + '/' + fit).toBeLessThanOrEqual(RACE_PACE_MIDWEEK_CAP);
            // and the Z3 work really is that many minutes, not more
            const work = (x.segments || []).filter(s => /effort/.test(s.label || ''))
              .flatMap(s => s.blocks || []).filter(b => b.zone === 'Z3')
              .reduce((t, b) => t + b.min, 0);
            expect(work, rt + '/' + fit + ' Z3 work').toBeLessThanOrEqual(RACE_PACE_MIDWEEK_CAP);
          });
      }
    }
  });

  it('speaks in the same voice as the long run, per distance', () => {
    // Two surfaces describing one effort in two voices is how an athlete ends
    // up believing they are different sessions.
    const est = racePaceSession({ raceKey: 'runhalf', minutes: 20, pacePerKm: null });
    expect(est.detail).toBe('Around your tempo pace, controlled');
    const estM = racePaceSession({ raceKey: 'runmarathon', minutes: 20, pacePerKm: null });
    expect(estM.detail).toBe('Between your long run and tempo pace, smooth and controlled');
  });
});

describe('exact pace requires a real benchmark, and so does the verdict', () => {
  it('the card prints a pace only from a real anchor', () => {
    const real = planFor('runmarathon', 'intermediate', 5);
    const est = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5, trainingDays: DAYSETS[5], longDay: 5 });
    const detailOf = p => allRuns(p).filter(x => x.type === 'Race Pace')
      .flatMap(x => x.segments || []).filter(s => /effort/.test(s.label || '')).map(s => s.detail);
    expect(detailOf(real).every(d => /^~\d+:\d\d \/km/.test(d))).toBe(true);
    expect(detailOf(est).every(d => !/~\d/.test(d))).toBe(true);
    expect(real.paces.run.racePace).toBeGreaterThan(0);
    expect(est.paces.run.racePace).toBeUndefined();
  });

  it('a feel-nudged estimate does not unlock an exact race pace', () => {
    /* Phase 5's rule, applied to the surface phase 7 added. A tuning nudge
       stores a fivekSec derived from the level table, so testing "no fivekSec"
       is not testing the guard at all: the number IS there, it is simply not
       evidence. Without this case, deleting the anchor check from computePaces
       left the whole suite green. */
    const nudged = generatePlan({
      ...base, raceType: 'runmarathon', fitness: 'intermediate',
      fivekSec: 1646, fivekMeta: { source: 'estimated', confidence: 'low' },
      daysPerWeek: 5, trainingDays: DAYSETS[5], longDay: 5,
    });
    expect(nudged.paces.run.racePace).toBeUndefined();
    const details = allRuns(nudged).filter(x => x.type === 'Race Pace')
      .flatMap(x => x.segments || []).filter(s => /effort/.test(s.label || '')).map(s => s.detail);
    expect(details.length).toBeGreaterThan(0);
    expect(details.every(d => !/~\d/.test(d)), 'a nudged estimate quoted an exact pace').toBe(true);
  });

  it('the review grades it under exactly the same condition', () => {
    /* THE POINT. One gate decides both, so an estimated athlete is never
       GRADED against a number they were never SHOWN — the failure mode the
       bike arc hit when adherence was scored off a band the card never
       printed. */
    const wo = { discipline: 'run', type: 'Race Pace', durationMin: 50, segments: [{ label: '3 × (10 min at marathon effort / 3 min float)', min: 30, zone: 'Z3' }] };
    const ivs = [{ type: 'WORK', movingTimeSec: 600, distance: 2000, averageSpeed: 1000 / 300 }];
    expect(intervalRows({ workout: wo, intervals: ivs, paces: { run: { racePace: 300 } } }).judged).toBe(1);
    expect(intervalRows({ workout: wo, intervals: ivs, paces: { run: { threshold: 312 } } }).judged).toBe(0);
  });

  it('a race-pace long survives an ease or trim rebuild', () => {
    // racePaceMin rides on the workout for exactly this reason: the calendar
    // is not reachable from a rebuild, so the session would lose its block.
    const p = planFor('runmarathon', 'intermediate', 5);
    const long = p.weeks.flatMap(w => w.workouts).find(x => x.type === 'Long' && x.racePaceMin);
    expect(long).toBeTruthy();
    const trimmed = trimWorkout(long, p, 0.8);
    expect(trimmed.segments.some(s => /marathon effort/i.test(s.label || ''))).toBe(true);
    // an EASED long becomes an easy run by design, and loses the block with it
    expect(easeWorkout(long, p).type).toBe('Easy');
  });
});

describe('distance prescriptions', () => {
  it('converts honestly in both units', () => {
    expect(KM_PER_MILE).toBeCloseTo(1.609344, 6);
    expect(kmToMiles(milesToKm(3))).toBeCloseTo(3, 9);
    expect(RUN_UNITS).toEqual(['minutes', 'km', 'miles', 'auto']);
    // 40 min at 5:00/km is 8 km
    expect(distanceForMinutes(40, 300, 'km')).toBe(8);
    expect(distanceForMinutes(40, 300, 'miles')).toBeCloseTo(4.97, 1);
    // no pace, no distance: an unanchored number is a fabrication, not an
    // estimate
    expect(distanceForMinutes(40, null, 'km')).toBe(null);
  });

  it('labels approximate conversions with the tilde the app already uses', () => {
    expect(fmtDistance(8, 'km', true)).toBe('~8 km');
    expect(fmtDistance(8, 'km', false)).toBe('8 km');
    expect(fmtDistance(5, 'miles', true)).toBe('~5 mi');
  });

  it('marks a distance estimated exactly when the plan behind it is', () => {
    const real = planFor('runhalf', 'intermediate', 5);
    const est = generatePlan({ ...base, raceType: 'runhalf', fitness: 'intermediate', daysPerWeek: 5, trainingDays: DAYSETS[5], longDay: 5 });
    const longOf = p => p.weeks.flatMap(w => w.workouts).find(x => x.type === 'Long');
    expect(runWorkoutDistance({ workout: longOf(real), unit: 'km', profile: real.profile }).approximate).toBe(false);
    const e = runWorkoutDistance({ workout: longOf(est), unit: 'km', profile: est.profile });
    expect(e.approximate).toBe(true);
    expect(e.label.startsWith('~')).toBe(true);
  });

  it('minutes remain canonical: nothing here writes back into a workout', () => {
    const p = planFor('runhalf', 'intermediate', 5);
    const long = p.weeks.flatMap(w => w.workouts).find(x => x.type === 'Long');
    const before = JSON.stringify(long);
    runWorkoutDistance({ workout: long, unit: 'miles', profile: p.profile });
    expect(JSON.stringify(long)).toBe(before);
    // and 'minutes' returns null so a caller falls through to duration copy
    expect(runWorkoutDistance({ workout: long, unit: 'minutes', profile: p.profile })).toBe(null);
  });

  it('rep labels snap to distances a coach would actually say', () => {
    // 4 min at 4:00/km is exactly 1 km
    expect(repDistanceLabel({ reps: 6, perMin: 4, secPerKm: 240, unit: 'km', approximate: false })).toBe('6 × 1 km');
    expect(repDistanceLabel({ reps: 6, perMin: 4, secPerKm: 240, unit: 'km', approximate: true })).toBe('~6 × 1 km');
    // and it declines when asked for minutes
    expect(repDistanceLabel({ reps: 6, perMin: 4, secPerKm: 240, unit: 'minutes' })).toBe(null);
    expect(repDistanceLabel({ reps: 6, perMin: 4, secPerKm: null, unit: 'km' })).toBe(null);
  });

  it('the preference table follows the athlete, then the session', () => {
    const long = { type: 'Long' }, easy = { type: 'Easy' };
    // an explicit preference always wins
    expect(preferredUnit({ workout: long, preference: 'minutes', soloRun: true })).toBe('minutes');
    expect(preferredUnit({ workout: easy, preference: 'miles', soloRun: true })).toBe('miles');
    // auto: long runs by distance on a standalone plan, easy by time
    expect(preferredUnit({ workout: long, preference: 'auto', soloRun: true, athleteUnit: 'km' })).toBe('km');
    expect(preferredUnit({ workout: long, preference: 'auto', soloRun: true, athleteUnit: 'miles' })).toBe('miles');
    expect(preferredUnit({ workout: easy, preference: 'auto', soloRun: true })).toBe('minutes');
    // and every triathlon run by time, where the week has to hold three sports
    expect(preferredUnit({ workout: long, preference: 'auto', soloRun: false })).toBe('minutes');
    // an unknown preference falls back rather than throwing
    expect(preferredUnit({ workout: long, preference: 'furlongs', soloRun: false })).toBe('minutes');
  });
});

describe('the barrel exports both new modules', () => {
  it('run-race-pace and run-units are reachable from the entry point', async () => {
    const barrel = await import('./index.js');
    ['RACE_PACE_CALENDAR', 'racePaceForWeek', 'racePaceSession',
      'RUN_UNITS', 'kmToMiles', 'preferredUnit', 'runWorkoutDistance', 'repDistanceLabel']
      .forEach(k => expect(barrel[k], k + ' missing from the barrel').toBeTruthy());
  });
});
