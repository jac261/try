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

export const EFTP_RULES = { minDriftPct: 0.03, freshDays: 10 };

const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'TrackRide', 'Cyclocross']);

export function eftpProposal({ activities, thresholds, plan, todayISO }) {
  const candidates = [];
  const profile = plan && plan.profile;
  const pc = plan && plan.paces;

  // Bike: rolling eFTP from the latest fresh ride.
  const ftp = profile && profile.ftp;
  if (ftp && activities && activities.length) {
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
  if (runV && pc && pc.run) {
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
  if (swimV && pc && pc.swim) {
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
