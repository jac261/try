/* Fitness watcher: compare what intervals.icu believes about the athlete's
   fitness with what the plan trains to, and propose a one-tap retarget when
   they drift. Three signals, one voice (the biggest drift wins the banner):

   - Bike: the rolling eFTP from recent RIDE activities (the 42-day power
     model; runs carry a RUNNING-power figure that must never reach this).
   - Run: the configured run threshold pace from the athlete's intervals.icu
     sport settings (metres per second), against the plan's threshold pace.
   - Swim: the configured swim threshold pace, against the plan's CSS.

   Each proposal carries the retarget fields for the existing flow (the plan
   regenerates with the same workout ids). Quiet without a connected account,
   fresh data, or meaningful drift; sanity bounds guard against unit garbage. */
import { daysBetween } from './date.js';
import { fmtPace } from './units.js';
import { DISCIPLINE } from './autolog.js';
import { RACES, DEFAULT_POOL } from './domain.js';
import { swimPaceLabel, pacePer100ForDisplay, unitShort } from './swim-units.js';
import { zoneForType } from './bike-zones.js';
import { targetPaceForZone } from './swim-zones.js';

export const EFTP_RULES = {
  minDriftPct: 0.03,
  freshDays: 10,
  // §7: a ride short enough to be a sprint or a fragment cannot establish an
  // hour power, whatever the model says about it.
  minRideSec: 20 * 60,
};

/* Derive CSS from a recorded swim test's interval analysis: the plan's CSS
   test prescribes a 400 then a 200 time trial, and the watch's lap data can
   do the arithmetic the session note asks the athlete to do by hand.
   Deliberately strict — this feeds an automated retarget proposal, so every
   ambiguity fails closed (returns null) rather than guessing:
   - exactly ONE work effort near 400 and ONE near 200 (the bands cover yard
     pools: 400 yd records as ~366 m); two candidates in a band is ambiguity
   - the distances must sit in a honest 2:1 ratio
   - the 200 must not be slower-paced than the 400 (mislabelled laps or a
     busted test; also guarantees the derived CSS lands at or above 400 pace)
   - the result must be a plausible human swim pace
   CSS normalises by the RECORDED distance delta, never a nominal /2: in a
   25-yard pool the "400" is 365.8 m and dividing by 2 would set CSS ~9% too
   fast across the whole plan (design panel catch 2026-07-18). */
/* The recording that holds the CSS test. The generic activityFor matcher
   compares against the session's prescribed 45 minutes, but a strong swimmer
   finishes the whole test in ~21 minutes of moving time and would fall
   outside its window — exactly the athlete auto-CSS serves best (gauntlet
   catch 2026-07-18). So the test gets its own finder: same-day swims inside
   a wide absolute band, closest to a realistic test length first. Picking a
   neighbouring swim by mistake is safe: its laps will not contain a clean
   single 400/200 pair, and cssFromTestIntervals fails closed. */
export function cssTestActivityFor({ activities, date }) {
  if (!Array.isArray(activities) || !date) return null;
  return activities
    .filter(a => a && DISCIPLINE[a.type] === 'swim' && a.date === date
      && a.movingTimeSec >= 600 && a.movingTimeSec <= 4500)
    .sort((x, y) => Math.abs(x.movingTimeSec - 2100) - Math.abs(y.movingTimeSec - 2100))[0] || null;
}

export function cssFromTestIntervals(intervals) {
  if (!Array.isArray(intervals)) return null;
  const work = intervals.filter(i => i && i.type === 'WORK' && i.movingTimeSec > 0 && i.distance > 0);
  const band = (lo, hi) => work.filter(i => i.distance >= lo && i.distance <= hi);
  const fours = band(320, 480), twos = band(150, 250);
  if (fours.length !== 1 || twos.length !== 1) return null;
  const a = fours[0], b = twos[0];
  const ratio = a.distance / b.distance;
  if (ratio < 1.8 || ratio > 2.2) return null;
  const paceA = a.movingTimeSec / (a.distance / 100);
  const paceB = b.movingTimeSec / (b.distance / 100);
  if (paceB > paceA + 1) return null;
  const css = (a.movingTimeSec - b.movingTimeSec) / ((a.distance - b.distance) / 100);
  if (!(css > 55 && css < 240)) return null;
  return {
    css100Sec: Math.round(css),
    t400Sec: Math.round(a.movingTimeSec), t200Sec: Math.round(b.movingTimeSec),
    d400: Math.round(a.distance), d200: Math.round(b.distance),
  };
}

/* Phase 3b (spec §7): why a recorded test swim did not produce a CSS.
   Mirrors cssFromTestIntervals guard for guard, so the athlete gets the
   actual reason instead of silence; returns null when the test parses. A
   test pins the two functions to agreeing on every case. */
export function cssTestIssues(intervals) {
  if (!Array.isArray(intervals) || !intervals.length) return 'We could not read any laps from that recording.';
  const work = intervals.filter(i => i && i.type === 'WORK' && i.movingTimeSec > 0 && i.distance > 0);
  const band = (lo, hi) => work.filter(i => i.distance >= lo && i.distance <= hi);
  const fours = band(320, 480), twos = band(150, 250);
  if (fours.length === 0) return 'We could not find a 400 time trial in the laps.';
  if (fours.length > 1) return 'More than one effort looked like the 400, so we could not tell which was the test.';
  if (twos.length === 0) return 'We could not find a 200 time trial in the laps.';
  if (twos.length > 1) return 'More than one effort looked like the 200, so we could not tell which was the test.';
  const a = fours[0], b = twos[0];
  const ratio = a.distance / b.distance;
  if (ratio < 1.8 || ratio > 2.2) return 'The two efforts were not close to a 2 to 1 distance ratio.';
  const paceA = a.movingTimeSec / (a.distance / 100);
  const paceB = b.movingTimeSec / (b.distance / 100);
  if (paceB > paceA + 1) return 'The 200 came out no faster than the 400, which does not happen in an all-out test.';
  const css = (a.movingTimeSec - b.movingTimeSec) / ((a.distance - b.distance) / 100);
  if (!(css > 55 && css < 240)) return 'The calculated CSS fell outside a plausible swimming range.';
  return null;
}

/* The 400/200 protocol in the athlete's own pool: same whole-length rounding
   and derived divisor as buildTest, for the retest sheet to explain. */
export function cssTestProtocol(pc) {
  const P = (pc && pc.pool) || DEFAULT_POOL;
  const rnd = d => Math.max(P.length, Math.round(d / P.length) * P.length);
  const d1 = rnd(400), d2 = rnd(200);
  return { d1, d2, unit: unitShort(P), divisor: Math.round((d1 - d2) / 100 * 100) / 100 };
}

/* Phase 3b (spec §6): the evidence behind a swim CSS retarget proposal, for
   the tap-through sheet. Everything display-ready and pool-aware; the delta
   is per 100 of the pool unit so a yard athlete sees yard seconds. The
   example is the next upcoming CSS Intervals swim, with the rep target band
   from targetPaceForZone so the athlete sees the concrete effect. */
export function cssProposalDetails({ proposal, plan, todayISO }) {
  if (!proposal || proposal.sport !== 'swim' || !proposal.retarget || proposal.retarget.css100Sec == null) return null;
  const pc = plan && plan.paces;
  if (!pc || !pc.swim) return null;
  const pool = pc.pool || DEFAULT_POOL;
  const cur = pc.swim.css, next = proposal.retarget.css100Sec;
  const deltaDisp = Math.round(pacePer100ForDisplay(next, pool) - pacePer100ForDisplay(cur, pool));
  const meta = proposal.retarget.cssMeta || {};
  const upcoming = (plan.weeks || []).flatMap(w => w.workouts || [])
    .filter(w => w.discipline === 'swim' && w.type === 'CSS Intervals' && !w.race && w.date >= todayISO)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
  const band = targetPaceForZone(next, 'css');
  return {
    curLabel: swimPaceLabel(cur, pool), nextLabel: swimPaceLabel(next, pool),
    deltaDisp, unit: unitShort(pool),
    pct: Math.round(Math.abs(next - cur) / cur * 1000) / 10,
    faster: next < cur,
    source: meta.source || null, measuredAt: meta.measuredAt || null, confidence: meta.confidence || null,
    example: upcoming && {
      title: upcoming.title, date: upcoming.date,
      cur: swimPaceLabel(cur, pool), next: swimPaceLabel(next, pool),
      band: swimPaceLabel(band.minSecondsPer100m, pool) + ' to ' + swimPaceLabel(band.maxSecondsPer100m, pool),
    },
  };
}

/* Phase 2 §5: the evidence behind a bike FTP retarget, for the tap-through
   sheet. Everything display-ready. The effect is the athlete's own next
   quality ride, shown at its current and proposed watt targets, because a
   percentage means nothing until it is the numbers on Tuesday's card. */
export function ftpProposalDetails({ proposal, plan, todayISO }) {
  if (!proposal || proposal.sport !== 'bike' || !proposal.retarget || proposal.retarget.ftp == null) return null;
  const cur = plan && plan.profile && plan.profile.ftp;
  if (!cur) return null;
  const next = proposal.retarget.ftp;
  const meta = proposal.retarget.ftpMeta || {};
  const upcoming = (plan.weeks || []).flatMap(w => w.workouts)
    .filter(w => w.discipline === 'bike' && !w.race && !w.test && w.role === 'quality' && w.date >= todayISO)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
  // the hardest prescribed block on that card is the one worth quoting
  const key = upcoming && (upcoming.segments || [])
    .filter(s => s.zone && s.zone !== 'Z1')
    .sort((a, b) => (b.zone > a.zone ? 1 : -1))[0];
  const band = key ? zoneForType(upcoming.type) : null;
  return {
    currentWatts: cur,
    proposedWatts: next,
    deltaWatts: next - cur,
    pct: Math.round(Math.abs(next - cur) / cur * 1000) / 10,
    up: next > cur,
    source: meta.source || null,
    measuredAt: meta.measuredAt || null,
    confidence: meta.confidence || null,
    example: upcoming && band ? {
      title: upcoming.title, date: upcoming.date, label: key.label,
      cur: Math.round(cur * band.min) + ' to ' + Math.round(cur * band.max) + ' W',
      next: Math.round(next * band.min) + ' to ' + Math.round(next * band.max) + ' W',
    } : null,
  };
}

const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'TrackRide', 'Cyclocross']);

export function eftpProposal({ activities, thresholds, plan, todayISO, cssTest }) {
  const candidates = [];
  const profile = plan && plan.profile;
  const pc = plan && plan.paces;
  // A solo plan trains one discipline; a proposal to retarget paces the plan
  // does not train is noise however real the signal behind it (a leftover
  // intervals.icu swim sport setting, a stray ride). Gate each branch by the
  // sport it would retarget. Tracker and triathlon plans are never solo.
  const solo = (RACES[plan && plan.race] || {}).solo || null;
  const swimPool = (pc && pc.pool) || DEFAULT_POOL;
  const trains = sport => !solo || solo === sport;

  // Swim, from the athlete's own recorded CSS test (cssTest.test is a
  // cssFromTestIntervals result, fetched and cached by the app when the
  // plan's swim test is logged and matched). A directly measured effort
  // outranks every passive signal below, so it returns immediately instead
  // of competing on drift size.
  if (trains('swim') && cssTest && cssTest.test && pc && pc.swim) {
    const meas = cssTest.test.css100Sec;
    const drift = (pc.swim.css - meas) / pc.swim.css;
    if (meas > 55 && meas < 240 && Math.abs(drift) >= EFTP_RULES.minDriftPct) {
      return {
        kind: 'csstest', sport: 'swim', drift: Math.abs(drift), up: drift > 0,
        headline: drift > 0 ? 'Your swim test says you are faster than the plan' : 'Your swim test says the plan paces are too hot',
        // Quote the RECORDED distances, not nominal 400/200: a yard-pool
        // test records 366 m and 183 m, and the banner must not dress those
        // up as metric splits.
        why: 'Your CSS test worked out at ' + swimPaceLabel(meas, swimPool) + ' (' + cssTest.test.d400 + ' m in ' + fmtPace(cssTest.test.t400Sec) + ', ' + cssTest.test.d200 + ' m in ' + fmtPace(cssTest.test.t200Sec) + '); the plan trains to ' + swimPaceLabel(pc.swim.css, swimPool) + '.',
        // A directly swum test is the highest-trust source, dated to the swim
        // itself; accepting it records that provenance on the profile so the
        // threshold model (domain.swimThreshold) can reason about staleness.
        retarget: { css100Sec: meas, cssMeta: { source: 'try-test', measuredAt: cssTest.date || todayISO, confidence: 'high' } },
      };
    }
  }

  // Bike: rolling eFTP from the latest fresh ride.
  const ftp = profile && profile.ftp;
  if (trains('bike') && ftp && activities && activities.length) {
    // Phase 2 §7 guardrails. An FTP is the number every bike target is built
    // from, so weak evidence must not be able to move it. Each active check
    // rejects rather than downgrades: a proposal the athlete has to think
    // hard about is worse than no proposal.
    //
    // The §7 ledger, so a later audit can tell skipped from forgotten:
    //   one isolated effort   covered by the nature of the evidence: eftp is
    //                         intervals.icu's 42-day rolling model, not a
    //                         single-effort estimate, so one anomalous file
    //                         moves it only as far as a rolling model moves
    //   short sprint          minRideSec below (tested)
    //   incomplete power      eftp can only exist when the ride carried real
    //                         power (the model is computed FROM power), so
    //                         the field's presence is the completeness check.
    //                         An explicit averageWatts guard was tried and
    //                         was a no-op: undefined passed !== null, and
    //                         real rides never carry an explicit null
    //   estimated power       the tripwire below. Today no synced ride sets
    //                         `estimated` (only manual entries do, and they
    //                         never carry eftp), so it enforces nothing yet;
    //                         it exists so a backend that later flags
    //                         estimated power under this name is rejected
    //                         without a client change
    //   untrusted source /    NOT EXPRESSIBLE yet: needs the deviceName /
    //   indoor-outdoor mix    deviceSource fields already asked of the
    //                         backend in the stroke passthrough PR
    //   low-confidence match  not applicable: this proposal reads the
    //                         activity feed directly, never a matched pair
    const latest = activities
      .filter(a => a.eftp && a.date && RIDE_TYPES.has(a.type)
        && daysBetween(a.date, todayISO) <= EFTP_RULES.freshDays
        && (a.movingTimeSec || 0) >= EFTP_RULES.minRideSec
        && !a.estimated)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (latest) {
      const eftp = Math.round(latest.eftp);
      const drift = (eftp - ftp) / ftp;
      if (Math.abs(drift) >= EFTP_RULES.minDriftPct) {
        candidates.push({
          kind: 'eftp', sport: 'bike', ftp, eftp, drift: Math.abs(drift), up: eftp > ftp,
          headline: eftp > ftp ? 'Your bike fitness has moved up' : 'Your bike targets may be set too high',
          why: 'We now estimate your FTP at ' + eftp + ' W; the plan trains to ' + ftp + ' W.',
          // an intervals.icu rolling model estimate: a real threshold, but
          // modelled from rides rather than tested, so medium confidence
          retarget: { ftp: eftp, ftpMeta: { source: 'activity-model', measuredAt: latest.date || todayISO, confidence: 'medium' } },
        });
      }
    }
  }

  // Run: configured threshold pace (m/s → s/km) vs the plan's threshold pace.
  const runV = thresholds && thresholds.runThresholdPace;
  if (trains('run') && runV && pc && pc.run) {
    const icuSec = 1000 / runV;
    const planSec = pc.run.threshold;
    if (icuSec > 150 && icuSec < 720) {
      const drift = (planSec - icuSec) / planSec; // positive → intervals is faster
      if (Math.abs(drift) >= EFTP_RULES.minDriftPct) {
        candidates.push({
          kind: 'eftp', sport: 'run', drift: Math.abs(drift), up: drift > 0,
          headline: drift > 0 ? 'Your run fitness has moved up' : 'Your run paces may be set too hot',
          why: 'Your run threshold is now set at ' + fmtPace(icuSec) + ' /km; the plan trains to ' + fmtPace(planSec) + ' /km.',
          retarget: { fivekSec: Math.round((icuSec - 12) * 5) },
        });
      }
    }
  }

  // Swim: configured threshold pace (m/s → s/100m) vs the plan's CSS.
  const swimV = thresholds && thresholds.swimThresholdPace;
  if (trains('swim') && swimV && pc && pc.swim) {
    const icuSec = 100 / swimV;
    const planSec = pc.swim.css;
    if (icuSec > 55 && icuSec < 240) {
      const drift = (planSec - icuSec) / planSec;
      if (Math.abs(drift) >= EFTP_RULES.minDriftPct) {
        candidates.push({
          kind: 'eftp', sport: 'swim', drift: Math.abs(drift), up: drift > 0,
          headline: drift > 0 ? 'Your swim fitness has moved up' : 'Your swim paces may be set too hot',
          why: 'Your CSS is now set at ' + swimPaceLabel(icuSec, swimPool) + '; the plan trains to ' + swimPaceLabel(planSec, swimPool) + '.',
          // A configured intervals.icu threshold is a fresh but indirect
          // signal, not a swum test: medium trust, dated to now.
          retarget: { css100Sec: Math.round(icuSec), cssMeta: { source: 'intervals-icu', measuredAt: todayISO, confidence: 'medium' } },
        });
      }
    }
  }

  return candidates.sort((a, b) => b.drift - a.drift)[0] || null;
}
