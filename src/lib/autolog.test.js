import { describe, it, expect } from 'vitest';
import { matchActivities } from './autolog.js';

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

  it('is quiet with no activities or no plan', () => {
    expect(matchActivities({ ...base, activities: null })).toEqual([]);
    expect(matchActivities({ ...base, activities: [] })).toEqual([]);
    expect(matchActivities({ activities: [act('a1', 'Run', TODAY, 40)], plan: null, log: {}, moves: {}, todayISO: TODAY })).toEqual([]);
  });
});
