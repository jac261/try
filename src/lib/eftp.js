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
import { RACES } from './domain.js';

export const EFTP_RULES = { minDriftPct: 0.03, freshDays: 10 };

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
        why: 'Your CSS test worked out at ' + fmtPace(meas) + ' /100m (' + cssTest.test.d400 + ' m in ' + fmtPace(cssTest.test.t400Sec) + ', ' + cssTest.test.d200 + ' m in ' + fmtPace(cssTest.test.t200Sec) + '); the plan trains to ' + fmtPace(pc.swim.css) + ' /100m.',
        retarget: { css100Sec: meas },
      };
    }
  }

  // Bike: rolling eFTP from the latest fresh ride.
  const ftp = profile && profile.ftp;
  if (trains('bike') && ftp && activities && activities.length) {
    const latest = activities
      .filter(a => a.eftp && a.date && RIDE_TYPES.has(a.type) && daysBetween(a.date, todayISO) <= EFTP_RULES.freshDays)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (latest) {
      const eftp = Math.round(latest.eftp);
      const drift = (eftp - ftp) / ftp;
      if (Math.abs(drift) >= EFTP_RULES.minDriftPct) {
        candidates.push({
          kind: 'eftp', sport: 'bike', ftp, eftp, drift: Math.abs(drift), up: eftp > ftp,
          headline: eftp > ftp ? 'Your bike fitness has moved up' : 'Your bike targets may be set too high',
          why: 'We now estimate your FTP at ' + eftp + ' W; the plan trains to ' + ftp + ' W.',
          retarget: { ftp: eftp },
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
          why: 'Your CSS is now set at ' + fmtPace(icuSec) + ' /100m; the plan trains to ' + fmtPace(planSec) + ' /100m.',
          retarget: { css100Sec: Math.round(icuSec) },
        });
      }
    }
  }

  return candidates.sort((a, b) => b.drift - a.drift)[0] || null;
}
