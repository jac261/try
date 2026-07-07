/* eFTP watcher: intervals.icu re-estimates FTP from every ride with power
   (rolling 42-day model), and the activities passthrough carries the estimate
   as `eftp`. When the latest estimate drifts meaningfully from the FTP the
   plan trains to, propose a one-tap retarget through the existing flow (the
   plan regenerates with the same workout ids, so logs, moves and adjustments
   all survive; only watt targets change). Quiet without a connected account,
   a plan FTP, or a fresh estimate. */
import { daysBetween } from './date.js';

export const EFTP_RULES = { minDriftPct: 0.03, freshDays: 10 };

export function eftpProposal({ activities, plan, todayISO }) {
  const ftp = plan && plan.profile && plan.profile.ftp;
  if (!ftp || !activities || !activities.length) return null;
  const latest = activities
    .filter(a => a.eftp && a.date && daysBetween(a.date, todayISO) <= EFTP_RULES.freshDays)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!latest) return null;
  const eftp = Math.round(latest.eftp);
  const drift = (eftp - ftp) / ftp;
  if (Math.abs(drift) < EFTP_RULES.minDriftPct) return null;
  const up = eftp > ftp;
  return {
    kind: 'eftp', ftp: ftp, eftp: eftp, drift: drift, up: up,
    headline: up ? 'Your bike fitness has moved up' : 'Your bike targets may be set too high',
    why: 'intervals.icu now estimates your FTP at ' + eftp + ' W; the plan trains to ' + ftp + ' W.',
  };
}
