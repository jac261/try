/* Try — the run's 5 km benchmark: what it is, where it came from, and
 * whether a recorded effort is allowed to become one. (run phase 2)
 *
 * The 5 km time is the single number every run target is built from, and the
 * only number race projections may extrapolate. Phase 1 separated real from
 * estimated; this module gives the real one provenance, history, and a way
 * to arrive from a recorded activity without weak evidence moving it.
 *
 * WHY THIS EXISTS AT ALL: run5k is a first-class test kind (TEST_DISC in
 * plan.js), scheduled on the same rotation as bikeFtp and swimCss, with its
 * own built session. But it was the only one of the three with no provenance
 * anywhere. The swim and bike both write cssMeta/ftpMeta from onboarding,
 * from the fitness editor and from an accepted proposal; the run wrote a bare
 * fivekSec every time, including from intervals.icu. So the app could not say
 * when a 5 km time was measured, how, or whether to trust it, for the one
 * anchor where that matters most.
 *
 * The parsing pair below (fivekFromTestIntervals / fivekTestIssues) mirrors
 * cssFromTestIntervals / cssTestIssues guard for guard, deliberately: the
 * swim pair is tested for agreeing on every case, and the same test here
 * keeps a silent rejection from ever being possible.
 */

import { RUN_5K_SOURCES, FTP_CONFIDENCE, runAnchor } from './domain.js';
import { DISCIPLINE, isIndoor } from './autolog.js';
import { RIEGEL_EXP } from './runstats.js';

/**
 * @typedef {object} RunBenchmark
 * @property {5000} distanceMetres
 * @property {number} timeSeconds
 * @property {'manual'|'recorded-race'|'try-test'|'intervals-icu'} source
 * @property {string|null} measuredAt
 * @property {'low'|'medium'|'high'|null} confidence
 */

export const RUN_5K_RULES = {
  // A lap must be a 5 km lap. Below the floor it is a PARTIAL 5 km, which
  // §6 names explicitly: an athlete who stopped at 4.2 km did not run a 5 km
  // time, and scaling one up would invent the part they did not run.
  minMetres: 4900,
  maxMetres: 5150,
  // The plausible range for a 5 km run. Outside this the recording is wrong
  // rather than the athlete remarkable: 11 minutes beats the world record and
  // 50 minutes is a walk, and either way the anchor must not move.
  minSeconds: 720,
  maxSeconds: 2700,
  // How far the plan's own 5 km pace must be out before a proposal is worth
  // showing. Matches EFTP_RULES.minDriftPct so all three sports agree on what
  // counts as a meaningful change.
  minDriftPct: 0.03,
};

/* The athlete's real 5 km benchmark, or null when the anchor is a level
   estimate. Deliberately returns null rather than an 'estimated' benchmark:
   the spec's whole point is that these are different TYPES, and a caller
   holding a RunBenchmark should never have to re-check which kind it is.
   Ask runAnchor() when the estimate is wanted too. */
export function runBenchmark(profile) {
  const a = runAnchor(profile);
  if (a.kind !== 'real') return null;
  return {
    distanceMetres: 5000,
    timeSeconds: a.timeSec,
    source: a.source,
    measuredAt: a.measuredAt,
    confidence: a.confidence,
  };
}

/* Accepted real 5 km results over time, oldest first, newest last. (§4)
   Mirrors bikeThresholdHistory: a fitnessHistory entry stores the value that
   was SUPERSEDED on that date, so the live value is appended last. Without
   that the trend ends on the number the athlete has just beaten, which is
   the bug the swim dashboard shipped with. */
export function runBenchmarkHistory(profile) {
  const p = profile || {};
  const past = (p.fitnessHistory || [])
    .filter(h => h && h.fivekSec)
    .map(h => ({
      date: h.date,
      timeSeconds: h.fivekSec,
      // snapshots written since this phase carry the superseded value's own
      // provenance; older ones simply have none, and none is shown as none
      ...(h.fivekMeta ? {
        source: RUN_5K_SOURCES.includes(h.fivekMeta.source) ? h.fivekMeta.source : 'manual',
        confidence: FTP_CONFIDENCE.includes(h.fivekMeta.confidence) ? h.fivekMeta.confidence : null,
      } : {}),
    }));
  const b = runBenchmark(p);
  if (!b) return past;
  return past.concat([{
    date: b.measuredAt || null,
    timeSeconds: b.timeSeconds,
    source: b.source,
    confidence: b.confidence,
    current: true,
  }]);
}

/* The recorded run that looks like the plan's 5 km test on a given date.
   Mirrors cssTestActivityFor: same date, right discipline, and a duration
   window wide enough for warm-up plus 5 km plus cool-down. */
export function run5kTestActivityFor({ activities, date }) {
  if (!Array.isArray(activities) || !date) return null;
  return activities
    .filter(a => a && DISCIPLINE[a.type] === 'run' && a.date === date
      && a.movingTimeSec >= 900 && a.movingTimeSec <= 5400)
    .sort((x, y) => Math.abs(x.movingTimeSec - 2700) - Math.abs(y.movingTimeSec - 2700))[0] || null;
}

// Normalise a lap that is nearly 5 km to exactly 5 km, on the same power law
// the projections use. Over the ±2% the rules allow this is a correction of a
// few seconds; using Riegel rather than a linear scale keeps one model in the
// module rather than two.
function toFiveK(distanceM, timeSec) {
  return timeSec * Math.pow(5000 / distanceM, RIEGEL_EXP);
}

/* The 5 km time inside a recorded test, or null when the recording does not
   contain one. Reads the LAPS, not the whole activity: the built session is
   warm-up + 5 km time trial + cool-down, so the activity's own distance and
   duration describe the session, not the effort. */
export function fivekFromTestIntervals(intervals) {
  if (!Array.isArray(intervals)) return null;
  const work = intervals.filter(i => i && i.type === 'WORK' && i.movingTimeSec > 0 && i.distance > 0);
  const fives = work.filter(i => i.distance >= RUN_5K_RULES.minMetres && i.distance <= RUN_5K_RULES.maxMetres);
  if (fives.length !== 1) return null;
  const lap = fives[0];
  const sec = toFiveK(lap.distance, lap.movingTimeSec);
  if (!(sec >= RUN_5K_RULES.minSeconds && sec <= RUN_5K_RULES.maxSeconds)) return null;
  return {
    fivekSec: Math.round(sec),
    lapMetres: Math.round(lap.distance),
    lapSec: Math.round(lap.movingTimeSec),
    scaled: Math.abs(lap.distance - 5000) >= 1,
  };
}

/* Why a recorded test run did not produce a 5 km time. (§6)
   Mirrors fivekFromTestIntervals guard for guard so the athlete gets the
   actual reason instead of silence; returns null when the test parses.
   A test pins the two functions to agreeing on every case.

   The activity is optional and checked FIRST where given, because the
   treadmill rejection is a property of the recording, not of its laps. */
export function fivekTestIssues(intervals, activity) {
  // A treadmill 5 km has a belt-derived distance, so the pace it implies says
  // nothing about how fast the athlete ran (§6). Never becomes an anchor.
  if (activity && isIndoor(activity)) {
    return 'That was recorded indoors, where the distance comes from the treadmill rather than GPS, so we cannot use it to set your 5 km time.';
  }
  if (!Array.isArray(intervals) || !intervals.length) return 'We could not read any laps from that recording.';
  const work = intervals.filter(i => i && i.type === 'WORK' && i.movingTimeSec > 0 && i.distance > 0);
  if (!work.length) return 'We could not read any laps from that recording.';
  const fives = work.filter(i => i.distance >= RUN_5K_RULES.minMetres && i.distance <= RUN_5K_RULES.maxMetres);
  if (fives.length === 0) {
    const longest = work.reduce((a, b) => (b.distance > a.distance ? b : a));
    if (longest.distance < RUN_5K_RULES.minMetres) {
      return 'The longest effort in that recording was '
        + (Math.round(longest.distance / 10) / 100) + ' km, short of a full 5 km.';
    }
    return 'We could not find a 5 km effort in the laps.';
  }
  if (fives.length > 1) return 'More than one effort looked like the 5 km, so we could not tell which was the test.';
  const lap = fives[0];
  const sec = toFiveK(lap.distance, lap.movingTimeSec);
  if (!(sec >= RUN_5K_RULES.minSeconds && sec <= RUN_5K_RULES.maxSeconds)) {
    return 'That 5 km time fell outside a plausible running range, so we have left your benchmark alone.';
  }
  return null;
}

/* The evidence behind a run benchmark proposal. Built for a tap-through
   sheet like the swim's and bike's; the run currently keeps the one-tap
   retarget flow (deliberate, App.jsx), so nothing renders this yet.
   (§5 steps 6 and 7, §7 "projection assumptions are visible")

   Everything display-ready. The effect is shown twice, because a 5 km time
   changes two different things and an athlete cares about both: the paces on
   the next quality session, and the race projections. */
export function runProposalDetails({ proposal, plan, todayISO }) {
  if (!proposal || proposal.sport !== 'run' || !proposal.retarget || proposal.retarget.fivekSec == null) return null;
  const pc = plan && plan.paces;
  if (!pc || !pc.run) return null;
  const curFivek = (plan.profile && plan.profile.fivekSec) || null;
  const next = proposal.retarget.fivekSec;
  const meta = proposal.retarget.fivekMeta || {};
  const upcoming = (plan.weeks || []).flatMap(w => w.workouts || [])
    .filter(w => w.discipline === 'run' && !w.race && !w.test
      && (w.type === 'Threshold' || w.type === 'Tempo' || w.type === 'VO2 Intervals')
      && w.date >= todayISO)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
  // The proposed threshold pace, derived the same way computePaces does, so
  // the sheet cannot quote a pace the plan will not actually train to.
  const curThresh = pc.run.threshold;
  const nextThresh = next / 5 + 12;
  return {
    curSec: curFivek, nextSec: next,
    faster: curFivek != null && next < curFivek,
    pct: curFivek ? Math.round(Math.abs(next - curFivek) / curFivek * 1000) / 10 : null,
    source: meta.source || null, measuredAt: meta.measuredAt || null, confidence: meta.confidence || null,
    thresholdCur: Math.round(curThresh), thresholdNext: Math.round(nextThresh),
    example: upcoming && { title: upcoming.title, date: upcoming.date, type: upcoming.type },
  };
}
