/* Try — completed-session matching ("spotted on your watch").
 *
 * Pairs recent intervals.icu activities with planned sessions so the athlete
 * can log them in one tap instead of remembering to tick boxes. Pure: takes
 * state, returns matches; the UI proposes and the athlete accepts (same
 * philosophy as the engine — never silently rewrite training state).
 */
import { iso, addDays } from './date.js';

// intervals.icu activity type → our discipline. Bricks have no single type —
// they match as a ride+run PAIR (see brickPairFor); the old strength exclusion
// predates keying on the WeightTraining type, which maps cleanly.
// The matcher's acceptance window: a recording within [lo, hi] of the planned
// (or manually logged) duration counts as the same session. One constant so
// auto-matching, brick pairing and manual-entry shadowing can never drift.
export const MATCH_WINDOW = { lo: 0.5, hi: 1.7 };

export const DISCIPLINE = {
  Run: 'run', VirtualRun: 'run',
  Ride: 'bike', VirtualRide: 'bike',
  Swim: 'swim', OpenWaterSwim: 'swim',
  WeightTraining: 'strength',
};

// A brick session's recording pair: same date, exactly ONE unclaimed ride and
// ONE unclaimed run (two of either is ambiguous — never guess), combined
// moving time inside the usual window of the planned duration. The feed
// carries no start times, so ride-then-run order cannot be verified; the
// one-of-each rule keeps this honest.
export function brickPairFor({ workout, activities, moves, used }) {
  if (!workout || workout.discipline !== 'brick' || !Array.isArray(activities)) return null;
  const planned = workout.durationMin || 0;
  if (!planned) return null;
  const date = (moves && moves[workout.id]) || workout.date;
  const on = disc => activities.filter(a => a && (!used || !used.has(a.id))
    && DISCIPLINE[a.type] === disc && a.date === date && a.movingTimeSec != null);
  const rides = on('bike'), runs = on('run');
  if (rides.length !== 1 || runs.length !== 1) return null;
  const min = (rides[0].movingTimeSec + runs[0].movingTimeSec) / 60;
  if (min < planned * MATCH_WINDOW.lo || min > planned * MATCH_WINDOW.hi) return null;
  return { ride: rides[0], run: runs[0] };
}

// Log feel from the athlete's recorded RPE (0-10), when present. Conservative
// bands; absent RPE leaves feel unset rather than guessing.
function feelFromRpe(rpe) {
  if (rpe == null) return undefined;
  if (rpe <= 4) return 'easy';
  if (rpe >= 8) return 'hard';
  return 'right';
}

// activities: the compact backend passthrough shape ({ id, date, type,
// movingTimeSec, rpe, ... }). Returns [{ workout, activity, feel }] — each
// activity claims at most one workout, matched on discipline + effective date
// with the duration within [50%, 170%] of plan (closest duration wins).
export function matchActivities({ activities, plan, log, moves, todayISO }) {
  if (!Array.isArray(activities) || !activities.length || !plan || !Array.isArray(plan.weeks)) return [];
  const today = todayISO || iso(new Date());
  const oldest = iso(addDays(today, -7));
  const eff = w => (moves && moves[w.id]) || w.date;

  const candidates = plan.weeks.flatMap(w => w.workouts).filter(w => {
    if ((log || {})[w.id] || w.race || w.bRace) return false;
    if (w.discipline !== 'run' && w.discipline !== 'bike' && w.discipline !== 'swim'
      && w.discipline !== 'strength' && w.discipline !== 'brick') return false;
    const d = eff(w);
    return d >= oldest && d <= today;
  });

  const used = new Set();
  const matches = [];
  candidates.forEach(w => {
    const planned = w.durationMin || 0;
    if (!planned) return;
    if (w.discipline === 'brick') {
      const pair = brickPairFor({ workout: w, activities, moves, used });
      if (pair) {
        used.add(pair.ride.id); used.add(pair.run.id);
        const rpes = [pair.ride.rpe, pair.run.rpe].filter(v => v != null);
        matches.push({ workout: w, activity: pair.ride, activityRun: pair.run, feel: rpes.length ? feelFromRpe(Math.max(...rpes)) : undefined });
      }
      return;
    }
    const best = activities
      .filter(a => a && !used.has(a.id) && DISCIPLINE[a.type] === w.discipline
        && a.date === eff(w) && a.movingTimeSec != null)
      .map(a => ({ a, min: a.movingTimeSec / 60 }))
      .filter(x => x.min >= planned * MATCH_WINDOW.lo && x.min <= planned * MATCH_WINDOW.hi)
      .sort((x, y) => Math.abs(x.min - planned) - Math.abs(y.min - planned))[0];
    if (best) {
      used.add(best.a.id);
      matches.push({ workout: w, activity: best.a, feel: feelFromRpe(best.a.rpe) });
    }
  });
  return matches;
}

// Link-out matching for a single (typically logged) session: the same
// discipline + effective-date + duration-window rule as matchActivities,
// without the claimed-set bookkeeping. A view helper, not a logging proposal —
// worst case a near-miss opens the wrong recording, which the athlete can see.
export function activityFor({ workout, activities, moves }) {
  if (!workout || !Array.isArray(activities)) return null;
  const planned = workout.durationMin || 0;
  if (!planned) return null;
  const date = (moves && moves[workout.id]) || workout.date;
  const best = activities
    .filter(a => a && DISCIPLINE[a.type] === workout.discipline && a.date === date && a.movingTimeSec != null)
    .map(a => ({ a, min: a.movingTimeSec / 60 }))
    .filter(x => x.min >= planned * MATCH_WINDOW.lo && x.min <= planned * MATCH_WINDOW.hi)
    .sort((x, y) => Math.abs(x.min - planned) - Math.abs(y.min - planned))[0];
  return best ? best.a : null;
}

// The athlete-facing intervals.icu page for a passthrough activity (ids come
// through verbatim, e.g. "i80852013").
export function activityUrl(a) {
  return 'https://intervals.icu/activities/' + a.id;
}
