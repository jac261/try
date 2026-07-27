/* Phase 3b (spec §5): when to recommend a CSS retest.

   A recommendation is a nudge to swim the 400/200 test, never an automatic
   threshold change: the athlete's CSS only ever moves through a proposal
   they accept. That separation is the spec's own line ("a test
   recommendation should be distinct from an automatic threshold update"),
   and it is why this module returns copy and a dismissal signature rather
   than a retarget payload.

   Signals, in the order they win when several fire at once:
   - missing:    no CSS at all, the plan is swimming on estimates
   - perf-slow:  quality swims repeatedly slower than prescribed (pace may
                 be set too hot, the athlete-protecting signal)
   - perf-fast:  quality swims repeatedly faster than prescribed
   - stale:      the measurement is real but old
   - icu:        intervals.icu holds a materially different threshold
   - unverified: a hand entry with no date we could age

   The performance signals read whole-activity average pace against the
   session's prescribed average (both include the easy work, so the ratio is
   like for like) rather than per-rep laps: honest enough for a nudge, and
   it needs no extra interval fetches. They qualify on every steady or hard
   prescribed-pace swim, not just CSS Intervals: an olympic plan schedules
   only a handful of those in a whole build, so a rule that waited for three
   inside a month could never fire. Endurance and Long swims are the same
   CSS-anchored prescription held longer, which is the purest read there is;
   Technique stays out (drill-fragmented pace), as does anything recorded in
   open water (no comparable pool pace). */
import { swimThreshold, RACES } from './domain.js';
import { daysBetween } from './date.js';
import { activityFor } from './autolog.js';
import { EFTP_RULES } from './eftp.js';

export const RETEST_RULES = {
  staleDays: 56,        // a measured CSS older than eight weeks is due a check
  lookbackDays: 28,     // performance signals read the last four weeks
  perfDriftPct: 0.03,   // a session 3% off its prescribed average pace counts
  perfWindow: 5,        // judged over the most recent five quality swims
  perfRepeats: 3,       // three of five is a pattern; one swim is just a day
  recentTestDays: 28,   // a test swum this recently silences every nudge
  upcomingTestDays: 14, // a test already scheduled soon makes a nudge noise
};

// The swim types whose recorded pace can speak to CSS: a prescribed steady
// or hard pace held for real distance.
export const PERF_TYPES = ['CSS Intervals', 'Race Pace', 'Endurance', 'Long'];

/* The session's prescribed PURE swim time and distance. A recording's moving
   time excludes rests at the wall, so comparing against durationMin (which
   includes them) would read every interval session as fast; instead this
   walks the segments the way the engine wrote them. Continuous blocks carry
   swim.distM and their block minutes are swim time (no caller uses the rest
   padding). Rep segments carry swim.{n,repM,restSec} and interleave rest
   into blocks as [work, rest, work, ...], so the work sits at even indices
   when restSec is set. */
export function prescribedSwim(w) {
  let distM = 0, sec = 0;
  for (const s of w.segments || []) {
    const sw = s.swim;
    if (!sw) continue;
    const bs = s.blocks || [];
    if (sw.distM) {
      distM += sw.distM;
      sec += bs.reduce((t, b) => t + b.min, 0) * 60;
    } else if (sw.repM && sw.n) {
      distM += sw.n * sw.repM;
      const work = sw.restSec > 0 ? bs.filter((b, i) => i % 2 === 0) : bs;
      sec += work.reduce((t, b) => t + b.min, 0) * 60;
    }
  }
  return { distM, sec };
}

function perfSignal({ plan, activities, log, moves, todayISO, sinceISO }) {
  const quality = plan.weeks.flatMap(w => w.workouts)
    .filter(w => w.discipline === 'swim' && !w.test && PERF_TYPES.includes(w.type))
    .filter(w => log[w.id])
    .map(w => ({ w, date: (moves && moves[w.id]) || w.date }))
    .filter(x => daysBetween(x.date, todayISO) >= 0 && daysBetween(x.date, todayISO) <= RETEST_RULES.lookbackDays)
    // retarget regenerates the plan at the NEW paces while logs survive by
    // id, so a swim executed before the current CSS was set would be judged
    // against a prescription that did not exist when it was swum — and a
    // just-retargeted athlete would be told their new CSS is wrong by their
    // old swims (gauntlet catch 2026-07-27). Only reads on or after the
    // current value's date can speak.
    .filter(x => !sinceISO || x.date >= sinceISO)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const reads = [];
  const used = new Set();
  for (const x of quality) {
    if (reads.length >= RETEST_RULES.perfWindow) break;
    const a = activityFor({ workout: x.w, activities, moves });
    // open water and part-swum sets cannot speak to pool CSS: no GPS pace is
    // comparable, and a recording well off the prescribed distance is either
    // a wrong match or a cut session
    if (!a || !a.distance || !a.movingTimeSec || /OpenWater/.test(a.type || '')) continue;
    // one recording, one read: activityFor has no claimed-set of its own, so
    // two same-day quality swims must not both count the same activity
    if (used.has(a.id)) continue;
    used.add(a.id);
    const { distM, sec } = prescribedSwim(x.w);
    if (!distM || !sec) continue;
    if (a.distance < distM * 0.75 || a.distance > distM * 1.25) continue;
    const prescribed = sec / (distM / 100);
    const recorded = a.movingTimeSec / (a.distance / 100);
    reads.push({ drift: (prescribed - recorded) / prescribed, date: x.date }); // positive = swam faster
  }
  const fast = reads.filter(r => r.drift >= RETEST_RULES.perfDriftPct).length;
  const slow = reads.filter(r => r.drift <= -RETEST_RULES.perfDriftPct).length;
  const latest = reads.length ? reads[0].date : null;
  if (slow >= RETEST_RULES.perfRepeats) return { key: 'perf-slow', latest };
  if (fast >= RETEST_RULES.perfRepeats) return { key: 'perf-fast', latest };
  return null;
}

export function cssRetestRecommendation({ plan, activities, thresholds, log, moves, todayISO, unresolvedTest }) {
  if (!plan || plan.race === 'tracker' || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const profile = plan.profile || {};
  // §6's gate, applied to the nudge as well: a solo run or bike plan has no
  // swim branch to retest, and a triathlete who excluded swimming opted out
  const solo = (RACES[plan.race] || {}).solo || null;
  if (solo && solo !== 'swim') return null;
  if (profile.excludedDiscipline === 'swim') return null;
  const t = swimThreshold(profile);

  // A recently swum test answers every question; one already on the
  // calendar soon will. Either way a nudge is noise. EXCEPT when the caller
  // knows that swum test resolved to nothing (no recording matched, laps
  // unreadable): a test that answered no question must not buy four weeks
  // of silence (gauntlet catch 2026-07-27).
  const tests = plan.weeks.flatMap(w => w.workouts).filter(w => w.test && w.testKind === 'swimCss');
  const swum = tests.filter(w => log && log[w.id])
    .map(w => (moves && moves[w.id]) || w.date)
    .filter(d => daysBetween(d, todayISO) >= 0 && daysBetween(d, todayISO) <= RETEST_RULES.recentTestDays);
  if (swum.length && !unresolvedTest) return null;
  const upcoming = tests.filter(w => !(log && log[w.id]))
    .map(w => (moves && moves[w.id]) || w.date)
    .filter(d => d >= todayISO && daysBetween(todayISO, d) <= RETEST_RULES.upcomingTestDays);
  if (upcoming.length) return null;

  const reasons = [];
  if (!t.cssSecondsPer100m) reasons.push({ key: 'missing' });
  if (t.cssSecondsPer100m) {
    const perf = perfSignal({ plan, activities: activities || [], log: log || {}, moves, todayISO, sinceISO: t.measuredAt });
    if (perf) reasons.push(perf);
    if (t.measuredAt && daysBetween(t.measuredAt, todayISO) > RETEST_RULES.staleDays) reasons.push({ key: 'stale' });
    const swimV = thresholds && thresholds.swimThresholdPace;
    if (swimV) {
      const icuSec = 100 / swimV;
      if (icuSec > 55 && icuSec < 240
        && Math.abs(t.cssSecondsPer100m - icuSec) / t.cssSecondsPer100m >= EFTP_RULES.minDriftPct) reasons.push({ key: 'icu' });
    }
    if (!t.measuredAt && t.source !== 'try-test') reasons.push({ key: 'unverified' });
  }
  if (!reasons.length) return null;

  const order = ['missing', 'perf-slow', 'perf-fast', 'stale', 'icu', 'unverified'];
  reasons.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const r = reasons[0];
  const weeks = t.measuredAt ? Math.round(daysBetween(t.measuredAt, todayISO) / 7) : null;
  const COPY = {
    missing: ['Anchor your swim paces', 'You are training without a measured CSS. Swim the 400/200 test and the app can work it out from your laps.'],
    'perf-slow': ['Your swims are coming in slow', 'Recent sessions have been slower than their prescribed paces. A retest will check whether your CSS is set too hot.'],
    'perf-fast': ['Your swims are coming in quick', 'You have been swimming faster than prescribed lately. A retest may earn you faster training paces.'],
    stale: ['Time to retest your CSS', 'Your last CSS measurement was about ' + weeks + ' weeks ago. A fresh 400/200 test keeps your paces honest.'],
    icu: ['Worth checking your CSS', 'intervals.icu has your swim threshold set materially different from the plan. A 400/200 test would settle it.'],
    unverified: ['Verify your swim CSS', 'Your CSS came from a hand entry. A swum 400/200 test will confirm your training paces.'],
  };
  // The signature makes a dismissal stick until the situation genuinely
  // changes: a new qualifying swim, a new measurement date, a new value.
  const sig = 'retest:' + r.key + ':' + (r.latest || t.measuredAt || t.cssSecondsPer100m || '');
  return { reason: r.key, reasons: reasons.map(x => x.key), headline: COPY[r.key][0], why: COPY[r.key][1], sig };
}
