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

// Trainer and treadmill recordings. Their distance comes from a virtual
// course or a belt reading, so any speed or pace derived from it says nothing
// about how the session went and must never be presented as if it did
// (gauntlet catch 2026-07-18).
export const INDOOR_TYPES = { VirtualRide: 1, VirtualRun: 1 };
export const isIndoor = a => !!(a && INDOOR_TYPES[a.type]);

export const DISCIPLINE = {
  Run: 'run', VirtualRun: 'run',
  Ride: 'bike', VirtualRide: 'bike',
  Swim: 'swim', OpenWaterSwim: 'swim',
  WeightTraining: 'strength',
};

// A brick session's recording pair: same date, exactly ONE unclaimed ride and
// ONE unclaimed run (two of either is ambiguous — never guess), combined
// moving time inside the usual window of the planned duration. Since
// 2026-07-30 the feed carries startedAt, so where BOTH recordings have one,
// ride-before-run is verified — a morning run and an evening ride is not a
// brick, however neatly the durations sum. Recordings without timestamps
// keep the date-only behaviour, byte-identically.
export function brickPairFor({ workout, activities, moves, used }) {
  if (!workout || workout.discipline !== 'brick' || !Array.isArray(activities)) return null;
  /* Never for a brick tune-up — from ANY caller. The candidate gate below
     keeps proposals away, but the manual tick resolves its recording
     through here too (recordingFor), and pairing ride+run would bank the
     race minus its swim leg as if measured. A ticked tune-up records its
     planned slot instead (gauntlet catch 2026-07-30). */
  if (workout.bRace) return null;
  const planned = workout.durationMin || 0;
  if (!planned) return null;
  const date = (moves && moves[workout.id]) || workout.date;
  const on = disc => activities.filter(a => a && (!used || !used.has(a.id))
    && DISCIPLINE[a.type] === disc && a.date === date && a.movingTimeSec != null);
  const rides = on('bike'), runs = on('run');
  if (rides.length !== 1 || runs.length !== 1) return null;
  /* Ordering is only enforced when BOTH timestamps came off a device. A
     manually logged half (intervals.icu hand entry) carries a defaulted or
     carelessly picked start time — commonly the start of the day — and
     trusting it un-matched genuine bricks whose run half was hand-logged
     (gauntlet catch 2026-07-30). deviceName is the delivered marker of a
     real recording; without it on both sides, pairing stays date-only. */
  if (rides[0].startedAt && runs[0].startedAt && rides[0].deviceName && runs[0].deviceName) {
    const rideStart = Date.parse(rides[0].startedAt);
    const runStart = Date.parse(runs[0].startedAt);
    if (Number.isFinite(rideStart) && Number.isFinite(runStart) && runStart < rideStart) return null;
  }
  const min = (rides[0].movingTimeSec + runs[0].movingTimeSec) / 60;
  if (min < planned * MATCH_WINDOW.lo || min > planned * MATCH_WINDOW.hi) return null;
  return { ride: rides[0], run: runs[0] };
}

// Log feel from the athlete's recorded RPE (0-10), when present. Conservative
// bands; an absent — or non-numeric — RPE leaves feel unset rather than
// guessing (the passthrough is verbatim, so a junk value must not fall
// through the comparisons into 'right').
function feelFromRpe(rpe) {
  if (!Number.isFinite(rpe)) return undefined;
  if (rpe <= 4) return 'easy';
  if (rpe >= 8) return 'hard';
  return 'right';
}

// activities: the compact backend passthrough shape ({ id, date, type,
// movingTimeSec, rpe, ... }). Returns [{ workout, activity, activityRun?,
// feel, rpe }] — each activity claims at most one workout, matched on
// discipline + effective date with the duration within [50%, 170%] of plan
// (closest duration wins). `rpe` is the exact input feel was derived from
// (a brick takes the harder leg's), emitted so callers stamping provenance
// never re-derive it.
export function matchActivities({ activities, plan, log, moves, todayISO }) {
  if (!Array.isArray(activities) || !activities.length || !plan || !Array.isArray(plan.weeks)) return [];
  const today = todayISO || iso(new Date());
  const oldest = iso(addDays(today, -7));
  const eff = w => (moves && moves[w.id]) || w.date;

  const candidates = plan.weeks.flatMap(w => w.workouts).filter(w => {
    /* The A race is excluded: it is unloggable by design, and a match would
       write the log entry nothing else can (its durationMin is also 0, so
       the !planned guard below refuses it independently). RUN tune-ups
       (bRace) match like sessions — they are tickable and load-counted, and
       excluding them left a raced, uploaded tune-up reading as "Didn't
       happen" in the digest (gauntlet catch 2026-07-30). Brick tune-ups
       stay manual-tick: pairing ride+run would bank the race minus its
       swim leg as if measured, and a tri recorded as a single multisport
       file is invisible to the type map anyway. Generated plans keep
       tune-ups at least 10 days clear of race day (the B-race pass in
       plan.js), so a race-day recording never sits in a tune-up's window. */
    if ((log || {})[w.id] || w.race || (w.bRace && w.discipline !== 'run')) return false;
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
        const rpes = [pair.ride.rpe, pair.run.rpe].filter(v => Number.isFinite(v));
        const rpe = rpes.length ? Math.max(...rpes) : undefined;
        matches.push({ workout: w, activity: pair.ride, activityRun: pair.run, feel: feelFromRpe(rpe), rpe });
      }
      return;
    }
    /* A tune-up day can hold both a warm-up jog and the race, and
       nearest-to-planned would happily pick the jog — then the recap, the
       feel and the logged minutes all belong to the wrong recording. One
       recording that day or none, counted BEFORE any other session's claim:
       an earlier candidate grabbing the race file must not make the day
       look unambiguous (a lone file already claimed just leaves the pool
       below empty — no clause needed). The same refusal the brick pair
       applies to two rides (gauntlet catch 2026-07-30). */
    if (w.bRace) {
      const day = activities.filter(a => a
        && DISCIPLINE[a.type] === w.discipline && a.date === eff(w) && a.movingTimeSec != null);
      if (day.length !== 1) return;
    }
    const best = activities
      .filter(a => a && !used.has(a.id) && DISCIPLINE[a.type] === w.discipline
        && a.date === eff(w) && a.movingTimeSec != null)
      .map(a => ({ a, min: a.movingTimeSec / 60 }))
      .filter(x => x.min >= planned * MATCH_WINDOW.lo && x.min <= planned * MATCH_WINDOW.hi)
      .sort((x, y) => Math.abs(x.min - planned) - Math.abs(y.min - planned))[0];
    if (best) {
      used.add(best.a.id);
      const rpe = Number.isFinite(best.a.rpe) ? best.a.rpe : undefined;
      matches.push({ workout: w, activity: best.a, feel: feelFromRpe(rpe), rpe });
    }
  });
  return matches;
}

// The one match that headlines the recap deck when several spotted sessions
// log in one tap. Plan order is layout, not significance: the plan's own key
// flag wins, then the longest recorded session (a brick counts both legs —
// the same sum logSpotted banks as actualMin), then the longer planned card.
// The sort is stable, so plan order stays the final tiebreak and the pick is
// deterministic. Feel and RPE stay out of it on purpose: the outcome label
// must never choose what gets celebrated.
export function headlineSpot(matches) {
  if (!Array.isArray(matches) || !matches.length) return null;
  const recorded = m => ((m.activity && m.activity.movingTimeSec) || 0)
    + ((m.activityRun && m.activityRun.movingTimeSec) || 0);
  return [...matches].sort((a, b) =>
    ((b.workout.key ? 1 : 0) - (a.workout.key ? 1 : 0))
    || (recorded(b) - recorded(a))
    || ((b.workout.durationMin || 0) - (a.workout.durationMin || 0)))[0];
}

/* The reverse direction: which planned session, if any, already SPEAKS FOR
 * this recording. Used by surfaces that must not present one session twice —
 * the recorded list tags a claimed recording "Matched" instead of standing it
 * alone, and the calendar grid lets the planned dot represent it rather than
 * adding a second.
 *
 * Four conjuncts, exactly as the recorded list has enforced them since it
 * shipped. A manual entry never claims a planned session (routing it through
 * the matched branch would lend it plan-relative verdicts it has no data
 * for). The session must be TICKED: an unticked session that merely happens
 * to match is not yet a claim on anything, which is why a spotted recording
 * still shows as itself until the athlete logs it.
 *
 * `used` is optional one-to-one bookkeeping. Without it two recordings inside
 * one session's window both resolve to it, which is right for a list (both
 * rows still render, each opening its own file) and wrong for a grid, where
 * it would silently hide the second ride of the day.
 */
export function ownerFor({ activity, sessions, log, used }) {
  if (!activity || activity.manual || !Array.isArray(sessions)) return null;
  const disc = DISCIPLINE[activity.type];
  const min = (activity.movingTimeSec || 0) / 60;
  if (!disc || !min) return null;
  /* NEAREST duration wins, matching matchActivities and activityFor rather
     than taking the first session that merely fits. On a day holding two
     ticked same-discipline sessions with overlapping windows, first-fit let
     a short recording claim the long session and orphaned the long
     recording, so the grid's dot count changed with the order the feed
     happened to arrive in (gauntlet 2026-08-01). */
  return sessions.filter(w => w.discipline === disc
    && !(used && used.has(w.id))
    && (log || {})[w.id] && log[w.id].done
    && w.durationMin
    && min >= w.durationMin * MATCH_WINDOW.lo
    && min <= w.durationMin * MATCH_WINDOW.hi)
    .sort((a, b) => Math.abs(min - a.durationMin) - Math.abs(min - b.durationMin)
      || (a.id < b.id ? -1 : 1))[0] || null;
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
  /* The manual tick resolves its recording through here, so a tune-up gets
     the same one-recording-or-none refusal as the proposal path: on a
     jog-plus-race day, nearest-to-planned returns the jog, and the ticked
     tune-up would log and recap the wrong file (gauntlet catch 2026-07-30).
     Refusing means the tick records the planned slot — honest fallback. */
  if (workout.bRace && activities.filter(a => a && DISCIPLINE[a.type] === workout.discipline
    && a.date === date && a.movingTimeSec != null).length !== 1) return null;
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
