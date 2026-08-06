import { describe, it, expect } from 'vitest';
import { matchActivities, activityFor, activityUrl, ownerFor, MATCH_WINDOW } from './autolog.js';

const TODAY = '2026-07-09';
const wk = (id, discipline, type, date, durationMin) => ({
  id, discipline, type, title: type + ' ' + discipline, date, durationMin,
});
const plan = { weeks: [{ index: 0, workouts: [
  wk('0-0', 'run', 'Easy', '2026-07-08', 50),
  wk('0-1', 'bike', 'Endurance', '2026-07-08', 60),
  wk('0-2', 'swim', 'Technique', '2026-07-09', 35),
  wk('0-3', 'strength', 'Strength', '2026-07-09', 40),
  wk('9-0', 'brick', 'RACE', '2026-07-09', 0),
] }] };
plan.weeks[0].workouts[4].race = true;

const act = (id, type, date, mins, extra = {}) => ({ id, type, date, movingTimeSec: mins * 60, ...extra });
const base = { plan, log: {}, moves: {}, todayISO: TODAY };

describe('matchActivities (spotted on your watch)', () => {
  it('pairs activities with planned sessions on discipline + date + duration window', () => {
    const m = matchActivities({ ...base, activities: [
      act('a1', 'Run', '2026-07-08', 48, { rpe: 3 }),
      act('a2', 'VirtualRide', '2026-07-08', 65),
      act('a3', 'Swim', '2026-07-09', 33, { rpe: 9 }),
    ] });
    expect(m.map(x => [x.workout.id, x.activity.id])).toEqual([['0-0', 'a1'], ['0-1', 'a2'], ['0-2', 'a3']]);
    expect(m[0].feel).toBe('easy');       // rpe 3
    expect(m[1].feel).toBe(undefined);    // no rpe → no guess
    expect(m[2].feel).toBe('hard');       // rpe 9
    // the exact input feel was derived from rides along for provenance
    expect(m.map(x => x.rpe)).toEqual([3, undefined, 9]);
  });

  it('a junk (non-numeric) rpe from the passthrough yields no feel and no rpe', () => {
    // the feed is verbatim: a schema change upstream must not band to
    // 'right' through failed comparisons or bank NaN into the corpus
    const m = matchActivities({ ...base, activities: [act('a1', 'Run', '2026-07-08', 48, { rpe: 'n/a' })] });
    expect(m.length).toBe(1);
    expect(m[0].feel).toBe(undefined);
    expect(m[0].rpe).toBe(undefined);
  });

  it('each activity claims at most one workout, nearest duration first', () => {
    const twoRuns = { weeks: [{ index: 0, workouts: [
      wk('0-0', 'run', 'Easy', '2026-07-08', 30), wk('0-1', 'run', 'Long', '2026-07-08', 80),
    ] }] };
    const m = matchActivities({ ...base, plan: twoRuns, activities: [act('a1', 'Run', '2026-07-08', 78)] });
    expect(m.length).toBe(1);
    expect(m[0].workout.id).toBe('0-1'); // the long run, not the 30-min easy
  });

  it('respects the duration window, dates outside the last week, and moved sessions', () => {
    expect(matchActivities({ ...base, activities: [act('a1', 'Run', '2026-07-08', 10)] })).toEqual([]); // far too short
    expect(matchActivities({ ...base, activities: [act('a1', 'Run', '2026-06-20', 48)] })).toEqual([]); // stale
    const moved = matchActivities({ ...base, moves: { '0-0': '2026-07-09' }, activities: [act('a1', 'Run', '2026-07-09', 48)] });
    expect(moved.length).toBe(1); // matched on the EFFECTIVE date
  });

  it('never proposes for logged, race, strength or brick sessions', () => {
    const logged = matchActivities({ ...base, log: { '0-0': { done: true } }, activities: [act('a1', 'Run', '2026-07-08', 48)] });
    expect(logged).toEqual([]);
    const raceDay = matchActivities({ ...base, activities: [act('a1', 'Ride', '2026-07-09', 120)] });
    expect(raceDay).toEqual([]); // race + strength are not candidates
  });

  /* Run tune-ups match like sessions (gauntlet catch 2026-07-30). The bRace
     exclusion shipped with the tune-up feature, filed under "behaves like a
     race" — but the same commit made it tickable and load-counted, and the
     exclusion meant a raced, uploaded tune-up could never self-close: the
     digest then reported the athlete's most important day as "Didn't
     happen". Run tune-ups only, and only on an unambiguous day; the
     refusals below are each deliberate (the out-of-window one rides the
     pre-existing MATCH_WINDOW guard — kept because it documents the known
     limit for a slow 5k recorded warm-up-to-cool-down in one file). */
  const tunedRun = { weeks: [{ index: 0, workouts: [
    { ...wk('0-5', 'run', 'RACE', '2026-07-08', 30), bRace: true, title: 'TUNE-UP — 5k Run Race' },
  ] }] };

  it('a run tune-up matches the lone recording on its day', () => {
    const m = matchActivities({ ...base, plan: tunedRun, activities: [act('a1', 'Run', '2026-07-08', 22, { rpe: 9 })] });
    expect(m.map(x => [x.workout.id, x.activity.id])).toEqual([['0-5', 'a1']]);
    expect(m[0].feel).toBe('hard');
  });

  it('two runs on a tune-up day refuse rather than guess which was the race', () => {
    // nearest-to-planned would pick the 25-min warm-up jog over the 22-min
    // race, and the log, feel and recap would all belong to the jog
    const m = matchActivities({ ...base, plan: tunedRun, activities: [
      act('a1', 'Run', '2026-07-08', 25), act('a2', 'Run', '2026-07-08', 22),
    ] });
    expect(m).toEqual([]);
  });

  it('an earlier claim cannot make a tune-up day look unambiguous', () => {
    // an easy run moved onto the day claims the race file first; the
    // tune-up must refuse the leftover jog, not inherit it. Pins the RAW
    // day count (two files → refusal however many are claimed); the
    // two-runs test above pins the same guard without the moved neighbour
    const moved = { weeks: [{ index: 0, workouts: [
      wk('0-1', 'run', 'Easy', '2026-07-06', 20),
      { ...wk('0-5', 'run', 'RACE', '2026-07-08', 30), bRace: true, title: 'TUNE-UP — 5k Run Race' },
    ] }] };
    const m = matchActivities({ ...base, plan: moved, moves: { '0-1': '2026-07-08' }, activities: [
      act('a1', 'Run', '2026-07-08', 25), act('a2', 'Run', '2026-07-08', 22),
    ] });
    expect(m.map(x => x.workout.id)).not.toContain('0-5');
  });

  it('the manual tick resolves no recording on an ambiguous tune-up day either', () => {
    const tune = { ...wk('0-5', 'run', 'RACE', '2026-07-08', 30), bRace: true };
    const two = [act('a1', 'Run', '2026-07-08', 25), act('a2', 'Run', '2026-07-08', 22)];
    expect(activityFor({ workout: tune, activities: two, moves: {} })).toBe(null);
    // a lone recording still resolves — the refusal is ambiguity, not bRace
    expect(activityFor({ workout: tune, activities: [two[1]], moves: {} }).id).toBe('a2');
  });

  it('a lone recording outside the window stays unmatched: the tick remains the path', () => {
    // a slow 5k with warm-up and cool-down in one file overruns 30 × 1.7
    expect(matchActivities({ ...base, plan: tunedRun, activities: [act('a1', 'Run', '2026-07-08', 54)] })).toEqual([]);
  });

  it('a brick tune-up never matches: its recording shape is not pairable honestly', () => {
    // a tri commonly uploads as one multisport file the type map cannot
    // see — and pairing ride+run would log the race minus its swim leg
    const tuned = { weeks: [{ index: 0, workouts: [
      { ...wk('0-6', 'brick', 'RACE', '2026-07-08', 80), bRace: true, title: 'TUNE-UP — Sprint Triathlon' },
    ] }] };
    const m = matchActivities({ ...base, plan: tuned, activities: [
      act('a1', 'Swim', '2026-07-08', 15),
      act('a2', 'Ride', '2026-07-08', 38),
      act('a3', 'Run', '2026-07-08', 26),
    ] });
    expect(m).toEqual([]);
  });

  it('the brick pair never resolves for a tune-up, from any caller', () => {
    // the manual tick resolves its recording through brickPairFor too —
    // without this gate a ticked sprint tune-up banks ride+run minus the
    // swim leg as if measured
    const tune = { ...wk('0-6', 'brick', 'RACE', '2026-07-08', 80), bRace: true };
    const pair = brickPairFor({ workout: tune, activities: [
      act('a2', 'Ride', '2026-07-08', 38), act('a3', 'Run', '2026-07-08', 26),
    ], moves: {}, used: new Set() });
    expect(pair).toBe(null);
  });

  it('the A race is still never a candidate, even with a plausible recording', () => {
    const raced = { weeks: [{ index: 0, workouts: [
      // a real A race carries durationMin 0; 30 here so the race gate is
      // what refuses this, not the !planned guard
      { ...wk('9-9', 'run', 'RACE', '2026-07-08', 30), race: true, title: 'RACE DAY — 5k Run' },
    ] }] };
    expect(matchActivities({ ...base, plan: raced, activities: [act('a1', 'Run', '2026-07-08', 22)] })).toEqual([]);
  });

  it('is quiet with no activities or no plan', () => {
    expect(matchActivities({ ...base, activities: null })).toEqual([]);
    expect(matchActivities({ ...base, activities: [] })).toEqual([]);
    expect(matchActivities({ activities: [act('a1', 'Run', TODAY, 40)], plan: null, log: {}, moves: {}, todayISO: TODAY })).toEqual([]);
  });
});

describe('ownerFor (which planned session already speaks for a recording)', () => {
  const ride = wk('b1', 'bike', 'Endurance', '2026-07-08', 60);
  const sessions = [ride];
  const done = { b1: { done: true } };
  const rec = (over = {}) => ({ id: 'a1', type: 'Ride', date: '2026-07-08', movingTimeSec: 3600, ...over });

  it('claims a ticked same-discipline session inside the window', () => {
    expect(ownerFor({ activity: rec(), sessions, log: done })).toBe(ride);
  });

  it('an UNTICKED session claims nothing: a match is not yet a claim', () => {
    expect(ownerFor({ activity: rec(), sessions, log: {} })).toBe(null);
    // a log entry that exists but is not done is still not a claim
    expect(ownerFor({ activity: rec(), sessions, log: { b1: { feel: 2 } } })).toBe(null);
  });

  it('a manual entry never claims a planned session', () => {
    expect(ownerFor({ activity: rec({ manual: true }), sessions, log: done })).toBe(null);
  });

  it('discipline must match', () => {
    expect(ownerFor({ activity: rec({ type: 'Run' }), sessions, log: done })).toBe(null);
  });

  it('honours the shared duration window at both edges', () => {
    const lo = 60 * MATCH_WINDOW.lo * 60, hi = 60 * MATCH_WINDOW.hi * 60;
    expect(ownerFor({ activity: rec({ movingTimeSec: lo }), sessions, log: done })).toBe(ride);
    expect(ownerFor({ activity: rec({ movingTimeSec: hi }), sessions, log: done })).toBe(ride);
    expect(ownerFor({ activity: rec({ movingTimeSec: lo - 60 }), sessions, log: done })).toBe(null);
    expect(ownerFor({ activity: rec({ movingTimeSec: hi + 60 }), sessions, log: done })).toBe(null);
  });

  it('the used set makes claiming one-to-one for callers that need it', () => {
    const used = new Set();
    expect(ownerFor({ activity: rec({ id: 'a1' }), sessions, log: done, used })).toBe(ride);
    used.add(ride.id);
    // the second recording of the day is NOT swallowed by the same session
    expect(ownerFor({ activity: rec({ id: 'a2' }), sessions, log: done, used })).toBe(null);
    // and without a used set both resolve, which is what a list wants
    expect(ownerFor({ activity: rec({ id: 'a2' }), sessions, log: done })).toBe(ride);
  });

  it('claims by NEAREST duration, so feed order cannot change the outcome', () => {
    /* Two ticked runs on one day with overlapping windows: first-fit let the
       short recording claim the long session and orphaned the long one, so
       the calendar's dot count flipped with feed order (gauntlet). */
    const long = wk('L', 'run', 'Long', '2026-07-08', 60);
    const short = wk('S', 'run', 'Easy', '2026-07-08', 30);
    const both = [long, short];
    const lg = { L: { done: true }, S: { done: true } };
    const rec30 = { id: 'a30', type: 'Run', date: '2026-07-08', movingTimeSec: 1800 };
    const rec60 = { id: 'a60', type: 'Run', date: '2026-07-08', movingTimeSec: 3600 };
    expect(ownerFor({ activity: rec30, sessions: both, log: lg }).id).toBe('S');
    expect(ownerFor({ activity: rec60, sessions: both, log: lg }).id).toBe('L');
    // and resolving in either feed order pairs them the same way
    for (const order of [[rec30, rec60], [rec60, rec30]]) {
      const used = new Set(); const got = {};
      order.forEach(a => { const o = ownerFor({ activity: a, sessions: both, log: lg, used }); if (o) { used.add(o.id); got[a.id] = o.id; } });
      expect(got).toEqual({ a30: 'S', a60: 'L' });
    }
  });

  it('degrades to null on junk rather than throwing', () => {
    expect(ownerFor({ activity: null, sessions, log: done })).toBe(null);
    expect(ownerFor({ activity: rec({ type: 'Yoga' }), sessions, log: done })).toBe(null);
    expect(ownerFor({ activity: rec({ movingTimeSec: 0 }), sessions, log: done })).toBe(null);
    expect(ownerFor({ activity: rec(), sessions: null, log: done })).toBe(null);
    expect(ownerFor({ activity: rec(), sessions, log: null })).toBe(null);
  });
});

describe('activityFor (link-out to the recording)', () => {
  const run = wk('0-0', 'run', 'Easy', '2026-07-08', 50);
  it('finds the recording on discipline + date + duration window, nearest first', () => {
    const a = activityFor({ workout: run, moves: {}, activities: [
      act('a1', 'Ride', '2026-07-08', 48),   // wrong discipline
      act('a2', 'Run', '2026-07-07', 48),    // wrong day
      act('a3', 'Run', '2026-07-08', 70),    // in window, further
      act('a4', 'Run', '2026-07-08', 52),    // nearest
    ] });
    expect(a.id).toBe('a4');
  });
  it('matches on the EFFECTIVE date when the session was moved', () => {
    const a = activityFor({ workout: run, moves: { '0-0': '2026-07-09' }, activities: [act('a1', 'Run', '2026-07-09', 48)] });
    expect(a.id).toBe('a1');
  });
  it('returns null outside the duration window or with nothing loaded', () => {
    expect(activityFor({ workout: run, moves: {}, activities: [act('a1', 'Run', '2026-07-08', 10)] })).toBe(null);
    expect(activityFor({ workout: run, moves: {}, activities: null })).toBe(null);
    expect(activityFor({ workout: null, moves: {}, activities: [] })).toBe(null);
  });
  it('activityUrl points at the intervals.icu activity page', () => {
    expect(activityUrl({ id: 'i80852013' })).toBe('https://intervals.icu/activities/i80852013');
  });
});

import { brickPairFor, headlineSpot, recordingFor, brickRecording } from './autolog.js';

describe('headlineSpot (which spotted session leads the recap)', () => {
  const spot = (id, { key, durationMin = 60, actMin = 0, runMin = 0 } = {}) => ({
    workout: { id, key: !!key, durationMin },
    activity: { id: id + '-a', movingTimeSec: actMin * 60 },
    ...(runMin ? { activityRun: { id: id + '-r', movingTimeSec: runMin * 60 } } : {}),
  });

  it('the key session beats an earlier easy one, whichever comes first in the plan', () => {
    const easy = spot('easy', { actMin: 35 });
    const long = spot('long', { key: true, actMin: 180 });
    expect(headlineSpot([easy, long]).workout.id).toBe('long');
    expect(headlineSpot([long, easy]).workout.id).toBe('long');
  });

  it('without a key flag the longest recorded session leads, a brick counting both legs', () => {
    const run = spot('run', { actMin: 50 });
    const rideOnly = spot('rideOnly', { actMin: 40 });      // single recording, no run leg
    const pair = spot('pair', { actMin: 40, runMin: 20 });  // brick: ride 40 + run 20
    expect(headlineSpot([run, rideOnly]).workout.id).toBe('run');
    expect(headlineSpot([run, pair]).workout.id).toBe('pair'); // 60 recorded min vs 50
  });

  it('falls back to planned duration, then plan order — fully deterministic', () => {
    const a = spot('a', { durationMin: 45 });
    const b = spot('b', { durationMin: 90 });
    expect(headlineSpot([a, b]).workout.id).toBe('b'); // nothing recorded → planned wins
    const t1 = spot('t1', { durationMin: 60, actMin: 50 });
    const t2 = spot('t2', { durationMin: 60, actMin: 50 });
    expect(headlineSpot([t1, t2]).workout.id).toBe('t1'); // exact tie → plan order
    expect(headlineSpot([])).toBe(null);
    expect(headlineSpot(null)).toBe(null);
  });

  it('never reads feel or rpe: the outcome label does not choose the celebration', () => {
    const rated = { ...spot('rated', { actMin: 40 }), feel: 'hard' };
    const longer = spot('longer', { actMin: 60 });
    expect(headlineSpot([rated, longer]).workout.id).toBe('longer');
  });
});

describe('strength and brick matching (2026-07-11 field decisions)', () => {
  const brickPlan = { weeks: [{ index: 0, workouts: [
    wk('1-0', 'brick', 'Brick', '2026-07-09', 90),
    wk('1-1', 'strength', 'Strength', '2026-07-08', 40),
  ] }] };
  const b = { plan: brickPlan, log: {}, moves: {}, todayISO: TODAY };

  it('WeightTraining recordings match strength sessions like any other sport', () => {
    const m = matchActivities({ ...b, activities: [act('g1', 'WeightTraining', '2026-07-08', 35, { rpe: 5 })] });
    expect(m.map(x => [x.workout.id, x.activity.id])).toEqual([['1-1', 'g1']]);
  });

  it('a brick matches one ride + one run whose combined time fits the window, feel from the harder leg', () => {
    const m = matchActivities({ ...b, activities: [
      act('r1', 'Ride', '2026-07-09', 60, { rpe: 4 }),
      act('r2', 'Run', '2026-07-09', 25, { rpe: 8 }),
    ] });
    expect(m.length).toBe(1);
    expect(m[0].workout.id).toBe('1-0');
    expect(m[0].activity.id).toBe('r1');
    expect(m[0].activityRun.id).toBe('r2');
    expect(m[0].feel).toBe('hard'); // max rpe of the pair
  });

  it('two rides on the day is ambiguous: the brick never guesses', () => {
    const m = matchActivities({ ...b, activities: [
      act('r1', 'Ride', '2026-07-09', 60), act('r2', 'Ride', '2026-07-09', 55), act('r3', 'Run', '2026-07-09', 25),
    ] });
    expect(m.length).toBe(0);
    expect(brickPairFor({ workout: brickPlan.weeks[0].workouts[0], activities: [act('r1', 'Ride', '2026-07-09', 60)], moves: {} })).toBe(null);
  });

  it('a combined time outside the window refuses the pair', () => {
    const m = matchActivities({ ...b, activities: [
      act('r1', 'Ride', '2026-07-09', 20), act('r2', 'Run', '2026-07-09', 10), // 30m vs planned 90m
    ] });
    expect(m.length).toBe(0);
  });
});

/* The pairing rule App used to keep to itself. It is exported now because the
   calendar has to name the same recording for the same session, and the two
   must not be able to disagree. */
describe('recordingFor: one session, one recording', () => {
  const act = (over = {}) => ({ id: 'a1', date: '2026-07-06', type: 'Ride', movingTimeSec: 3600, trainingLoad: 60, ...over });
  const ride = { id: 'w1', discipline: 'bike', date: '2026-07-06', durationMin: 60 };

  it('finds the single matching activity', () => {
    expect(recordingFor({ workout: ride, activities: [act()], moves: {} }).id).toBe('a1');
  });

  it('never hands back a hand-typed diary entry', () => {
    /* The guard lives in the helper, not the call site: App passes the raw
       feed but the calendar passes the display list, and a typed duration
       banked as actualMin would enter the log and the calibration corpus. */
    const typed = act({ id: 'm1', manual: true, estimated: true });
    expect(recordingFor({ workout: ride, activities: [typed], moves: {} })).toBe(null);
  });

  it('folds a brick pair into one recording', () => {
    const brick = { id: 'b1', discipline: 'brick', date: '2026-07-06', durationMin: 90 };
    const pair = [act({ id: 'r1', movingTimeSec: 3600, trainingLoad: 60, startedAt: '2026-07-06T08:00:00Z', deviceName: 'w' }),
      act({ id: 'r2', type: 'Run', movingTimeSec: 1800, trainingLoad: 30, startedAt: '2026-07-06T09:10:00Z', deviceName: 'w' })];
    const rec = recordingFor({ workout: brick, activities: pair, moves: {} });
    expect(rec.pair).toBe(true);
    expect(rec.trainingLoad).toBe(90);
    expect(rec.estimated).toBe(false);
  });
});

describe('brickRecording: a pair is measured only if both legs were', () => {
  const ride = { id: 'r1', date: '2026-07-06', movingTimeSec: 3600, trainingLoad: 60, rpe: 5 };
  const run = { id: 'r2', date: '2026-07-06', movingTimeSec: 1800, trainingLoad: 30, rpe: 7 };

  it('sums two measured legs and keeps the harder rpe', () => {
    const r = brickRecording(ride, run);
    expect(r.trainingLoad).toBe(90);
    expect(r.estimated).toBe(false);
    expect(r.rpe).toBe(7);
  });

  it('estimates the leg that carries no load, and says the pair is an estimate', () => {
    /* The old sum treated the pair as measured when EITHER leg had a load, so
       a metered ride plus a watch-less run reported 60 as though it were the
       whole brick. */
    const r = brickRecording(ride, { ...run, trainingLoad: null });
    expect(r.estimated).toBe(true);
    expect(r.trainingLoad).toBeGreaterThan(60);   // the run is not free
    // unrounded, like estimateTss itself: the display rounds, the model does not
    expect(r.trainingLoad).toBe(60 + (30 / 60) * 0.7 * 0.7 * 100);
  });

  it('a pair with no load at all reports none', () => {
    expect(brickRecording({ ...ride, trainingLoad: null }, { ...run, trainingLoad: null }).trainingLoad).toBe(null);
  });
});
