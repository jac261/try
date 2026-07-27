/* Try — phase 2 §6: when to recommend an FTP assessment.
 *
 * A recommendation is a nudge to ride the ramp test, never an automatic
 * change: FTP only ever moves through a proposal the athlete accepts, or a
 * number they type. That separation is the same one the swim retest keeps,
 * and it is why this returns copy and a dismissal signature rather than a
 * retarget payload.
 *
 * The swim version of this shipped three bugs that are designed out here
 * rather than rediscovered:
 *   - every window is the window the copy claims, so a ride from months ago
 *     cannot keep the present tense true
 *   - a fresh plan with nothing ridden yet accuses nobody
 *   - drift is only read from rides on or after the current FTP's own date,
 *     so accepting a retarget cannot immediately produce a nudge saying the
 *     number you just accepted is wrong
 */
import { bikePowerAnchor, RACES } from './domain.js';
import { daysBetween } from './date.js';
import { EFTP_RULES } from './eftp.js';
import { isTrainingRide } from './bikeschema.js';

export const FTP_RETEST_RULES = {
  staleDays: 84,        // twelve weeks: an FTP older than a training block
  lookbackDays: 28,
  driftPct: 0.05,       // a ride 5% off its prescribed average counts
  window: 5,            // judged over the most recent five quality rides
  repeats: 3,           // three of five is a pattern, one ride is a day
  recentTestDays: 28,
  upcomingTestDays: 14,
  gapDays: 28,          // no riding at all for this long makes FTP uncertain
};

// Rides whose prescribed power is specific enough to compare against. An
// Endurance ride is a wide band and a Long ride is mostly unstructured, so
// neither can say much about a threshold.
export const DRIFT_TYPES = ['Threshold', 'Sweet Spot', 'VO2 Intervals', 'Tempo'];

/* The average power a session actually asks for, weighted by segment
   minutes. A whole-ride average includes warm-up and recoveries, so the
   comparison has to include them on the prescribed side too or every ride
   reads easy. */
export function prescribedWatts(workout, ftpWatts) {
  if (!workout || !ftpWatts) return null;
  let min = 0, watts = 0;
  (workout.segments || []).forEach(s => {
    const z = ZONE_BY_NAME[s.zone];
    if (!z || !s.min) return;
    min += s.min;
    watts += s.min * ftpWatts * z;
  });
  return min ? { avgWatts: watts / min, minutes: min } : null;
}
// Zone midpoints as a fraction of FTP, for weighting a whole session.
const ZONE_BY_NAME = { Z1: 0.55, Z2: 0.675, Z3: 0.83, Z4: 1.0, Z5: 1.13 };

function driftSignal({ plan, activities, log, moves, todayISO, sinceISO }) {
  const rides = (plan.weeks || []).flatMap(w => w.workouts)
    .filter(w => isTrainingRide(w) && DRIFT_TYPES.includes(w.type) && log && log[w.id])
    .map(w => ({ w, date: (moves && moves[w.id]) || w.date }))
    .filter(x => {
      const age = daysBetween(x.date, todayISO);
      return age >= 0 && age <= FTP_RETEST_RULES.lookbackDays;
    })
    // a ride from before the current FTP was set cannot judge it
    .filter(x => !sinceISO || x.date >= sinceISO)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const reads = [];
  const used = new Set();
  for (const x of rides) {
    if (reads.length >= FTP_RETEST_RULES.window) break;
    const a = (activities || []).find(act => act && act.date === x.date
      && act.averageWatts > 0 && !used.has(act.id)
      && /Ride/i.test(act.type || ''));
    if (!a) continue;
    used.add(a.id);
    const presc = prescribedWatts(x.w, (plan.profile || {}).ftp);
    if (!presc || !presc.avgWatts) continue;
    // a recording far off the session's length is a wrong match or a cut ride
    const mins = (a.movingTimeSec || 0) / 60;
    if (mins < presc.minutes * 0.75 || mins > presc.minutes * 1.25) continue;
    reads.push({ drift: (a.averageWatts - presc.avgWatts) / presc.avgWatts, date: x.date });
  }
  const over = reads.filter(r => r.drift >= FTP_RETEST_RULES.driftPct).length;
  const under = reads.filter(r => r.drift <= -FTP_RETEST_RULES.driftPct).length;
  const latest = reads.length ? reads[0].date : null;
  if (over >= FTP_RETEST_RULES.repeats) return { key: 'drift-up', latest };
  if (under >= FTP_RETEST_RULES.repeats) return { key: 'drift-down', latest };
  return null;
}

export function ftpRetestRecommendation({ plan, activities, thresholds, log, moves, todayISO }) {
  if (!plan || plan.race === 'tracker' || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const profile = plan.profile || {};
  // nothing to assess on a plan that does not ride towards a race
  const solo = (RACES[plan.race] || {}).solo || null;
  if (solo && solo !== 'bike') return null;
  if (profile.excludedDiscipline === 'bike') return null;

  const anchor = bikePowerAnchor(profile);
  const meta = profile.ftpMeta || {};

  // A test ridden recently answers the question; one already scheduled soon
  // will. Either way a nudge is noise.
  const tests = plan.weeks.flatMap(w => w.workouts).filter(w => w.test && w.testKind === 'bikeFtp');
  const swum = tests.filter(w => log && log[w.id])
    .map(w => (moves && moves[w.id]) || w.date)
    .filter(d => daysBetween(d, todayISO) >= 0 && daysBetween(d, todayISO) <= FTP_RETEST_RULES.recentTestDays);
  if (swum.length) return null;
  const upcoming = tests.filter(w => !(log && log[w.id]))
    .map(w => (moves && moves[w.id]) || w.date)
    .filter(d => d >= todayISO && daysBetween(todayISO, d) <= FTP_RETEST_RULES.upcomingTestDays);
  if (upcoming.length) return null;

  const reasons = [];
  if (anchor.kind !== 'real') reasons.push({ key: 'missing' });
  else {
    const drift = driftSignal({ plan, activities, log: log || {}, moves, todayISO, sinceISO: meta.measuredAt });
    if (drift) reasons.push(drift);
    if (meta.measuredAt && daysBetween(meta.measuredAt, todayISO) > FTP_RETEST_RULES.staleDays) reasons.push({ key: 'stale' });
    const icu = thresholds && thresholds.bikeFtp;
    if (icu > 0 && Math.abs(anchor.ftpWatts - icu) / anchor.ftpWatts >= EFTP_RULES.minDriftPct) reasons.push({ key: 'icu' });
    // a long silence makes any threshold uncertain, whatever its date
    const lastRide = (activities || []).filter(a => a && /Ride/i.test(a.type || '') && a.date)
      .map(a => a.date).sort().pop();
    if (lastRide && daysBetween(lastRide, todayISO) > FTP_RETEST_RULES.gapDays) reasons.push({ key: 'returning', latest: lastRide });
    if (!meta.measuredAt && anchor.source !== 'try-test') reasons.push({ key: 'unverified' });
  }
  if (!reasons.length) return null;

  const order = ['missing', 'drift-up', 'drift-down', 'returning', 'stale', 'icu', 'unverified'];
  reasons.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const r = reasons[0];
  const weeks = meta.measuredAt ? Math.round(daysBetween(meta.measuredAt, todayISO) / 7) : null;
  const COPY = {
    missing: ['Anchor your bike targets', 'You are riding without a measured FTP, so every watt target is derived from your level. The ramp test takes twenty minutes and fixes that.'],
    'drift-up': ['Your rides are coming in strong', 'Recent quality rides have averaged above what they asked for. A ramp test may earn you higher targets.'],
    'drift-down': ['Your rides are coming in under', 'Recent quality rides have averaged below what they asked for. A retest will check whether your targets are set too high.'],
    returning: ['Worth re-anchoring after the break', 'You have not ridden in a while, and an FTP set before a break is a poor guide to what you can hold now.'],
    stale: ['Time to retest your FTP', 'Your FTP was set about ' + weeks + ' weeks ago. A fresh ramp test keeps every bike target honest.'],
    icu: ['Worth checking your FTP', 'intervals.icu has your cycling threshold set materially different from the plan. A ramp test would settle it.'],
    unverified: ['Verify your FTP', 'Your FTP came from a hand entry. A ramp test will confirm the targets every ride is built from.'],
  };
  const sig = 'ftp-retest:' + r.key + ':' + (r.latest || meta.measuredAt || anchor.ftpWatts || '');
  return { reason: r.key, reasons: reasons.map(x => x.key), headline: COPY[r.key][0], why: COPY[r.key][1], sig };
}
