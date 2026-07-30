/* Try — post-session review: what the recording says about the plan.
 *
 * Pairs a completed session with its matched intervals.icu activity and
 * renders honest verdicts: was an easy day kept easy, did a steady session
 * sit in its band, did the load match the plan. Analysis only uses what can
 * be judged fairly from an activity AVERAGE — interval sessions blur their
 * reps into the recovery, so they get stats and a pointer, never a pace
 * verdict. Fields the backend passthrough doesn't carry yet (avg HR, avg
 * power) simply produce no verdict: missing data stays quiet, same principle
 * as the readiness model.
 */
import { fmtPace } from './units.js';
import { pacePer100ForDisplay, unitShort, poolLengthM, fromMetres, swimPaceLabel } from './swim-units.js';
import { DEFAULT_POOL } from './domain.js';
import { estimateTss } from './adapt.js';
import { isIndoor } from './autolog.js';
import { swimReviewVerdict, plannedSwimReps } from './swim-review.js';
import { runReviewVerdict } from './run-review.js';
import { bikeReviewVerdict, bandForRep } from './bike-review.js';
import { judgeBandForType } from './bike-zones.js';
import { reviewAuthority } from './coaching/review-authority.js';

// Session types whose whole intent is one steady band — the only ones an
// average can judge. Everything else (reps, drills, bricks) is mixed.
const STEADY = {
  run: { 'Easy': 'easy', 'Long': 'long' },
  swim: { 'Endurance': 'steady', 'Race Pace': 'css' },
};
const EASY_INTENT = { 'Easy': 1, 'Endurance': 1, 'Long': 1, 'Technique': 1, 'Recovery': 1 };

const secPerKm = a => a.movingTimeSec / (a.distance / 1000);
const secPer100 = a => a.movingTimeSec / (a.distance / 100);

// The review: { stats: [[label, value]], verdicts: [{ tone, text }] } or null.
// tone: 'good' | 'warn' | 'info'.
export function reviewActivity({ workout, activity, paces, log, swimReview, bikeReview, runReview }) {
  if (!workout || !activity || !activity.movingTimeSec) return null;
  /* One voice per session (phase 2 §6): the authority question — which
     review source may speak — now lives in coaching/review-authority.js,
     shared with the recap so the two surfaces cannot disagree about who is
     speaking. Behaviour identical to the inline guards this replaces
     (swim phase 4, bike phase 5, run phase 8 wiring). */
  const authority = reviewAuthority({ workout, activity, swimReview, bikeReview, runReview });
  const perRep = authority.authority === 'structured' ? authority.review : null;
  const perRepSwim = perRep && perRep === swimReview ? perRep : null;
  const perRepBike = perRep && perRep === bikeReview ? perRep : null;
  const perRepRun = perRep && perRep === runReview ? perRep : null;
  const w = workout, a = activity, pc = paces || {};
  // Swim pace shows and compares per 100 of the athlete's pool unit; the
  // comparison thresholds stay canonical per 100 m, only the display converts.
  const pool = pc.pool || DEFAULT_POOL;
  const swimPace = v => swimPaceLabel(v, pool);
  // Phase 2b defensive (§6): if a recording ever carries its own pool length
  // (a backend field not passed today) and it disagrees with the athlete's
  // setting, the distance-derived pace is uncertain. No such field exists yet,
  // so this is a silent no-op until the backend adds it; it never reinterprets.
  const recordedPoolM = a.poolLengthM || null;
  const poolMismatch = recordedPoolM && Math.abs(recordedPoolM - poolLengthM(pool)) > 0.5;
  const stats = [];
  const verdicts = [];
  const actualMin = a.movingTimeSec / 60;

  stats.push(['Time', fmtDur(a.movingTimeSec)]);
  // Indoor recordings carry a virtual distance, so a derived pace or speed
  // would be a fabricated number. The recorded rows already suppress it; this
  // review sits one screen deeper and must agree (gauntlet catch 2026-07-18).
  const derived = a.distance && !isIndoor(a);
  // ...and so is the DISTANCE ITSELF, which this line used to print
  // unconditionally right above a comment explaining why it must not be
  // trusted. A turbo's 30 km is a number its wheel model invented; showing it
  // as "Distance 30 km" beside a suppressed speed presented the fabricated
  // half and hid the honest one. §4's acceptance criterion is that indoor
  // speed AND distance stay suppressed (phase 4 §4).
  if (derived) stats.push(['Distance', (a.distance / 1000).toFixed(a.distance >= 10000 ? 0 : 1) + ' km']);
  if (derived && w.discipline === 'run') stats.push(['Avg pace', fmtPace(secPerKm(a)) + ' /km']);
  if (derived && w.discipline === 'swim') stats.push(['Avg pace', swimPace(secPer100(a))]);
  if (derived && w.discipline === 'bike') stats.push(['Avg speed', (a.distance / 1000 / (a.movingTimeSec / 3600)).toFixed(1) + ' km/h']);
  if (a.averageWatts) stats.push(['Avg power', Math.round(a.averageWatts) + ' W']);
  if (a.averageHeartrate) stats.push(['Avg HR', Math.round(a.averageHeartrate) + ' bpm']);
  if (a.trainingLoad != null) stats.push(['Load', (a.estimated ? '~' : '') + Math.round(a.trainingLoad)]);
  if (a.rpe != null) stats.push(['RPE', Math.round(a.rpe) + '/10']);

  // Duration vs plan (the plan's number, after any ease/trim the athlete saw).
  // Not for tune-ups: their planned number is a slot estimate, and "Cut
  // short" was headlining the recap of a finished 5k race (gauntlet catch
  // 2026-07-30).
  const planned = w.durationMin || 0;
  if (planned && !w.bRace) {
    const r = actualMin / planned;
    if (r < 0.8) verdicts.push({ tone: 'info', text: 'Cut short: ' + fmtDur(a.movingTimeSec) + ' of a planned ' + planned + ' min. Fine occasionally — the load model counts what you did.' });
    else if (r > 1.25) verdicts.push({ tone: 'info', text: 'Ran long: ' + fmtDur(a.movingTimeSec) + ' against a planned ' + planned + ' min. Extra volume adds up — make sure it was deliberate.' });
  }

  // Steady sessions: judge the average against its band.
  const steadyKey = (STEADY[w.discipline] || {})[w.type];
  if (steadyKey && !perRep && a.distance && pc[w.discipline === 'run' ? 'run' : 'swim']) {
    if (w.discipline === 'run' && pc.run[steadyKey]) {
      const actual = secPerKm(a), target = pc.run[steadyKey];
      if (actual < target - 20) verdicts.push({ tone: 'warn', text: 'Averaged ' + fmtPace(actual) + ' /km against an easy-day target around ' + fmtPace(target) + ' /km. Quicker than this session is meant to be — easy days do their job when they stay easy.' });
      else if (actual > target + 45) verdicts.push({ tone: 'info', text: 'Averaged ' + fmtPace(actual) + ' /km, well below the ' + fmtPace(target) + ' /km guide. If you felt fine, no problem; if it was a struggle, the readiness card may explain why.' });
      else verdicts.push({ tone: 'good', text: 'Right in the band: ' + fmtPace(actual) + ' /km against a ' + fmtPace(target) + ' /km guide. Exactly the discipline that makes the hard days count.' });
    }
    if (w.discipline === 'swim' && pc.swim[steadyKey]) {
      const actual = secPer100(a), target = pc.swim[steadyKey];
      if (poolMismatch) verdicts.push({ tone: 'info', text: 'This looks recorded in a ' + Math.round(fromMetres(recordedPoolM, pool.unit)) + ' ' + unitShort(pool) + ' pool, not your ' + pool.length + ' ' + unitShort(pool) + ' setting, so the pace read may be off. Update your pool if that is your usual one.' });
      else if (actual < target - 5) verdicts.push({ tone: 'good', text: 'Averaged ' + swimPace(actual) + ', quicker than the ' + swimPace(target) + ' guide — strong swimming.' });
      else if (actual > target + 8) verdicts.push({ tone: 'info', text: 'Averaged ' + swimPace(actual) + ' against a ' + swimPace(target) + ' guide. Open water, drills or a busy lane can all explain it.' });
      else verdicts.push({ tone: 'good', text: 'On target: ' + swimPace(actual) + ' against ' + swimPace(target) + '.' });
    }
  }

  // Easy-intent bike with power: intensity vs FTP is the honest check — but
  // only against a real FTP. A level-and-weight estimate is too weak a basis
  // for a pass/fail verdict, so it stays quiet, the same principle as the
  // missing threshold HR below (design panel 2026-07-18).
  // ...and yields to the phase 5 engine, which reads the same intensity and
  // says more about it: this line and that one were the same claim.
  if (!perRepBike && w.discipline === 'bike' && EASY_INTENT[w.type] && a.averageWatts && pc.ftp && !pc.ftpEstimated) {
    const pct = a.averageWatts / pc.ftp;
    // 0.83 mirrors BIKE_REVIEW_RULES.easyCeiling (written out for the same
    // TDZ reason as the judge band below); the endurance low-cadence card
    // prescribes up to 0.80, and the judge may not be stricter than the card
    if (pct > 0.83) verdicts.push({ tone: 'warn', text: 'Averaged ' + Math.round(pct * 100) + '% of FTP on a ride meant to be easy. Keeping easy rides genuinely easy is what lets the quality days be quality.' });
    else verdicts.push({ tone: 'good', text: 'Kept it easy: ' + Math.round(pct * 100) + '% of FTP on average. Textbook.' });
  }
  // Easy-intent with HR (needs the backend to pass averageHeartrate + a threshold HR to
  // judge against — until then this stays silent rather than guessing).

  // Interval sessions: an average cannot see the reps. (Ad-hoc recordings have
  // no planned intent to speak of, so this note would be noise — skip it.)
  // No promise of a rep table either: that view loads separately and can
  // legitimately be absent (no WORK laps, fetch failure), so this verdict
  // must stand alone without pointing at numbers that may never render.
  // (Not for tune-ups either: a race is not an interval session, and with
  // the duration verdict gone this line was next in queue to headline the
  // recap of a finished 5k — same class, one block down.)
  if (!w.adhoc && !w.bRace && !perRep && !steadyKey && !EASY_INTENT[w.type] && (w.discipline === 'run' || w.discipline === 'bike' || w.discipline === 'swim')) {
    verdicts.push({ tone: 'info', text: 'Interval session — the average blurs work and recovery together, so no pace verdict here.' });
  }

  // Load vs plan (meaningless for an unplanned session — there is no plan
  // dose; meaningless for a tune-up too, whose slot estimate a race is
  // supposed to exceed — "a much bigger dose than intended" is exactly
  // what racing is).
  if (!w.adhoc && !w.bRace && a.trainingLoad != null) {
    const plannedTss = estimateTss(w, undefined, log && log.actualMin);
    if (plannedTss > 10 && a.trainingLoad / plannedTss > 1.4) {
      verdicts.push({ tone: 'warn', text: 'Training load came in well above the plan’s estimate for this session — a much bigger dose than intended.' });
    }
  }

  // Perceived effort vs intent.
  if (EASY_INTENT[w.type] && a.rpe != null && a.rpe >= 7) {
    verdicts.push({ tone: 'warn', text: 'You rated this ' + Math.round(a.rpe) + '/10 — an easy session that felt hard. One-off is nothing; a pattern is worth a look at recovery.' });
  }

  // The per-rep coaching read closes the list: it is the verdict the others
  // were standing in for, and it carries the next action.
  if (perRep) {
    const v = perRepSwim ? swimReviewVerdict(perRepSwim)
      : perRepBike ? bikeReviewVerdict(perRepBike) : runReviewVerdict(perRepRun);
    if (v) verdicts.push(v);
  }

  return { stats, verdicts };
}

function fmtDur(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + ' min';
}

/* ---- the rep table: per-interval rows with verdicts ----
   Judged only where a rep target genuinely exists for the session type: runs
   and swims by pace (never by average_watts, which is running power on runs),
   rides by watts against an FTP band. Unstructured sessions arrive as auto
   laps, which render as plain splits with no verdicts — a split has no target
   to fail. Sub-30-second slivers (lap-button stubs) are dropped. */
const REP_BANDS = {
  /* 'Race Pace' resolves through pc.run.racePace, which computePaces sets
     ONLY for a solo half or marathon with a real 5 km anchor. The lookup
     below is pc[disc][band[0]], so an estimated athlete finds nothing there
     and the session simply is not graded — the same condition that decided
     whether their card printed a pace at all (phase 7 §2). */
  run: { 'Threshold': ['threshold', 10], 'Tempo': ['tempo', 12], 'VO2 Intervals': ['interval', 10], 'Race Pace': ['racePace', 12] },
  // The Long swim stays OUT of the STEADY map on purpose: its broken and
  // pyramid variants bake planned rest into the recording, so the whole-
  // session average would read slow against a flat steady target. Every rep
  // in every Long variant targets steady, so the rep table judges it fairly.
  swim: { 'CSS Intervals': ['css', 4], 'Race Pace': ['css', 4], 'Long': ['steady', 8] },
  // Bike bands come from bike-zones.js so the review judges a rep against
  // the band the card actually prescribed. They used to be written here
  // separately and had drifted: Tempo was judged at 83-90% while generation
  // prescribed 76-85%, so a rider at 195 W against a 190-213 W card was
  // told they came in under (found 2026-07-27).
  // bike bands are resolved LAZILY, in bikeRepBand() below.
};

/* Phase 4 §7: how far off a prescribed band an OUTDOOR rep may sit before it
 * is called off target.
 *
 * Outdoors the road is in the session. A junction, a descent, a car, a
 * gradient that runs out: each puts zero-power seconds inside a rep, and a
 * rep average is arithmetic, so the effort reads low even when it was ridden
 * exactly right. Indoors none of that exists, which is why the shipped
 * tolerance is tight and why applying it outdoors is the "indoor-style
 * second-by-second adherence" the spec says outdoor rides must not be judged
 * by.
 *
 * IT IS DELIBERATELY ONE-SIDED. Interruptions can only ever remove work from
 * an average, never add it, so the low side widens and the high side does
 * not: a rider who went too hard outdoors went too hard, and the road is no
 * defence. elapsedTimeSec arrives since 2026-07-30 and bike-review's
 * rideInterruption now measures the stopped time — but it EXPLAINS the
 * lenient read rather than moving these thresholds, because per-rep
 * coasting still needs a power stream and a wrong reason attached to a
 * real verdict is worse than no reason. */
export const REP_TOLERANCE = 0.03;
export const OUTDOOR_REP_TOLERANCE = 0.08;

/* Phase 5: the SAME band the interval engine uses, resolved at call time.
 *
 * These two judged the same laps against different numbers and rendered the
 * disagreement in one block of the workout sheet — bandForRep unions tempo
 * and sweet spot for Z3 and judgeBandForType does not, so a rep could read
 * 'under' in the table and in target in the verdict directly above it. One
 * table, which is the phase 2 lesson.
 *
 * It is a function and not a const because resolving it at module scope
 * evaluated bandForRep while bike-review.js was still initialising, and its
 * zone table was still in the temporal dead zone. Lazy is also just correct
 * here: nothing needs these bands until a rep is judged. */
const JUDGE_ZONE = { Tempo: 'Z3', 'Sweet Spot': 'Z3', Threshold: 'Z4', 'VO2 Intervals': 'Z5' };

// resolved lazily and cached per call site for the same TDZ reason as the
// bike band below: swim-review is still initialising when this module loads
function swimRepTargets(workout, pc) {
  try { return plannedSwimReps(workout, pc).filter(r => r.targetSec); } catch (e) { return []; }
}
function bikeRepBand(type) {
  return JUDGE_ZONE[type] ? bandForRep(type, JUDGE_ZONE[type]) : null;
}

export function intervalRows({ workout, intervals, paces, activity }) {
  if (!workout || !Array.isArray(intervals)) return null;
  const disc = workout.discipline;
  const pc = paces || {};
  const work = intervals.filter(i => i && i.type === 'WORK' && i.movingTimeSec >= 30);
  if (!work.length) return null;
  // A hill session's reps are honest efforts at dishonest GPS paces: grading
  // them against the flat-terrain target called a well-run rep 'off target'
  // every time. Fail silent instead, the same principle as a missing FTP
  // (design panel 2026-07-18).
  const hilly = (workout.segments || []).some(s => s && s.terrain === 'hill');
  const band = hilly ? null
    : disc === 'bike' ? bikeRepBand(workout.type)
      : (REP_BANDS[disc] || {})[workout.type] || null;
  // §7. Absent an activity nothing changes, so a caller that cannot say where
  // the ride happened gets the behaviour it has always had rather than the
  // benefit of a doubt nobody expressed.
  const outdoor = disc === 'bike' && !!activity && !isIndoor(activity);
  const lowTol = outdoor ? OUTDOOR_REP_TOLERANCE : REP_TOLERANCE;
  let judged = 0, onTarget = 0, forgiven = 0;
  const rows = work.map((i, idx) => {
    const row = {
      n: idx + 1,
      label: i.label || null,
      timeSec: Math.round(i.movingTimeSec),
      distance: i.distance || null,
      hr: i.averageHeartrate != null ? Math.round(i.averageHeartrate) : null,
      watts: disc === 'bike' && i.averageWatts != null ? Math.round(i.averageWatts) : null,
      paceSec: disc !== 'bike' && i.averageSpeed ? (disc === 'swim' ? 100 : 1000) / i.averageSpeed : null,
    };
    // Watts still show on every row; only the on-target JUDGEMENT needs a real
    // FTP to mean anything (design panel 2026-07-18).
    if (band && disc === 'bike' && row.watts != null && pc.ftp && !pc.ftpEstimated) {
      judged++;
      const p = row.watts / pc.ftp;
      row.tone = p > band[1] + REP_TOLERANCE ? 'warn' : p < band[0] - lowTol ? 'info' : 'good';
      // did the road, rather than the rider, make the difference to this row?
      if (outdoor && row.tone === 'good' && p < band[0] - REP_TOLERANCE) forgiven++;
    } else if (band && disc !== 'bike' && row.paceSec && pc[disc] && pc[disc][band[0]]) {
      judged++;
      /* A swim rep is judged against ITS OWN prescribed pace when the card
         carries one. The flat CSS band judged every CSS Intervals rep at CSS,
         but the sprint variant prescribes its 50s at the FASTER sprint pace
         and prints that pace on the card — so a swimmer executing the card
         exactly read "0 of 24 reps on target", every rep marked hot, directly
         under a review verdict saying pace sat right on target. The bike
         fixed this exact class by sharing the generation band; the swim's
         version is the per-rep target the prescription already stores.
         Pairing is by order with the engine's own distance tolerance, and a
         lap that pairs with nothing falls back to the flat band. */
      const planned = swimRepTargets(workout, pc);
      const own = planned[idx];
      const target = own && row.distance
        && Math.abs(row.distance - own.repM) / own.repM <= 0.12
        ? own.targetSec : pc[disc][band[0]];
      const tol = band[1];
      row.tone = row.paceSec < target - tol ? 'warn' : row.paceSec > target + tol ? 'info' : 'good';
    }
    if (row.tone === 'good') onTarget++;
    return row;
  });
  const summary = judged
    ? onTarget + ' of ' + judged + ' rep' + (judged === 1 ? '' : 's') + ' on target'
    : rows.length + ' split' + (rows.length === 1 ? '' : 's');
  // Only said when it actually changed a verdict, so it reads as an
  // explanation rather than a disclaimer printed on every outdoor ride.
  const note = forgiven
    ? 'Judged with outdoor allowance: ' + (forgiven === 1 ? 'one rep' : forgiven + ' reps')
      + ' averaged low, which is what junctions, descents and coasting do to a rep average.'
    : null;
  return { rows, summary, judged, note, outdoor };
}
