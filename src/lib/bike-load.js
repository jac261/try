/* Try — power-derived load (phase 5 §6).
 *
 * Intensity factor, power-based TSS and variability index, all of which need
 * NORMALIZED power and none of which can be honestly produced without it.
 *
 * THE GATE IS REAL, AND IT IS THE POINT OF THIS FILE. The spec's §1 claims
 * the client lacks per-ride average power; it does not, and the interval
 * review in bike-review.js ships on what already arrives. What is actually
 * missing is normalized power, and normalized power cannot be recovered from
 * what we have. It is a thirty-second rolling average raised to the fourth
 * power, averaged, then rooted: it is a statement about the SHAPE of a ride,
 * and the shape is exactly what an average throws away.
 *
 * WHY IT IS NOT APPROXIMATED FROM INTERVAL AVERAGES. It could be. Treating
 * each recorded interval as a constant block and weighting across them gives
 * a number, and that number would be wrong in a specific and unhelpful
 * direction: it captures variability BETWEEN efforts and none within them, so
 * a ragged effort and a metronomic one of the same average score identically,
 * which is the single thing normalized power exists to tell apart. It would
 * then flow into TSS, into fitness and fatigue, into readiness, and into
 * every recommendation built on those. A wrong number with a right name is
 * worse than a missing one, because nothing downstream can tell.
 *
 * So every function here returns null until the field arrives, the formulas
 * are written and tested against known values so the day it arrives is a
 * wiring day rather than a maths day, and the ask is in the backend handoff.
 *
 * WHAT STILL WORKS MEANWHILE: adapt.js keeps producing its duration-and-type
 * TSS estimate, which is honest about being an estimate and never claimed to
 * be power-derived. Nothing here replaces it until it can beat it.
 */
import { bikePowerAnchor } from './domain.js';

/* The backend field this is all waiting on. Named here so there is exactly
   one place to change when it lands, and so a search for it finds the ask. */
export const NP_FIELD = 'normalizedWatts';

export const POWER_LOAD_RULES = {
  minRideSec: 20 * 60,   // the same floor eftp uses: a short ride cannot anchor load
  maxIf: 1.5,            // above this the power data is wrong, not the rider
};

/* Normalized power, read and never computed. Returns null when the field is
   absent, which is every ride today. */
export function normalizedWatts(activity) {
  const v = activity && activity[NP_FIELD];
  return typeof v === 'number' && v > 0 ? v : null;
}

/* Whether a ride can carry power-derived load at all. §6: "All formulas
   should require real FTP and valid power data", and §3's rule that an
   estimated FTP may not produce TSS or IF is enforced right here rather than
   at each formula, so there is one gate and not four. */
export function powerLoadAvailable({ activity, profile }) {
  if (!activity || !(activity.movingTimeSec >= POWER_LOAD_RULES.minRideSec)) return false;
  if (bikePowerAnchor(profile || {}).kind !== 'real') return false;
  return normalizedWatts(activity) != null;
}

export function intensityFactor(np, ftpWatts) {
  if (!np || !ftpWatts) return null;
  const iF = np / ftpWatts;
  return iF > 0 && iF <= POWER_LOAD_RULES.maxIf ? Math.round(iF * 100) / 100 : null;
}

/* TSS = (seconds x NP x IF) / (FTP x 3600) x 100. An hour at threshold is
   100 by construction, which is the assertion the test uses. */
export function powerTss(movingTimeSec, np, ftpWatts) {
  const iF = intensityFactor(np, ftpWatts);
  if (!iF || !movingTimeSec) return null;
  return Math.round((movingTimeSec * np * iF) / (ftpWatts * 3600) * 100);
}

/* VI = NP / average. 1.0 is a ride held perfectly steady; a criterium is
   well above it. Needs both numbers to be real measurements of the same
   ride, so it is gated with the rest. */
export function variabilityIndex(np, averageWatts) {
  if (!np || !averageWatts) return null;
  return Math.round(np / averageWatts * 100) / 100;
}

/* The whole set, or null. Callers are meant to treat null as "no power load
   for this ride" and carry on, exactly as they already do for a missing FTP
   or a missing recording: §8's "missing backend fields fail safely" means
   nothing renders and nothing is inferred, not that a zero appears. */
export function bikeLoad({ activity, profile }) {
  if (!powerLoadAvailable({ activity, profile })) return null;
  const ftpWatts = bikePowerAnchor(profile).ftpWatts;
  const np = normalizedWatts(activity);
  const iF = intensityFactor(np, ftpWatts);
  if (iF == null) return null;
  return {
    normalizedPowerWatts: Math.round(np),
    averagePowerWatts: activity.averageWatts != null ? Math.round(activity.averageWatts) : null,
    intensityFactor: iF,
    powerTss: powerTss(activity.movingTimeSec, np, ftpWatts),
    variabilityIndex: variabilityIndex(np, activity.averageWatts),
    ftpWatts,
  };
}
