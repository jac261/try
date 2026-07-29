/* Try — expressing a run in distance as well as minutes. (run phase 7 §3-§5)
 *
 * MINUTES STAY CANONICAL. Every duration in this app is authored, sized,
 * capped, trimmed and load-modelled in minutes, and §3 is explicit that this
 * does not change. Distance is a PRESENTATION of a session, derived from the
 * athlete's own pace anchor, never a second source of truth. Nothing here
 * writes back into a workout.
 *
 * That matters for a reason §4 states directly: the conversion is only ever
 * as good as the anchor behind it. An athlete on a level-table estimate is
 * being shown a distance derived from a guess, so it is marked approximate,
 * and it moves the moment their anchor moves. A GPS watch will not agree with
 * it exactly and is not meant to.
 *
 * MILES. The app had no miles anywhere. km was assumed throughout, which is
 * fine for the model and wrong for a large share of runners, so §5's unit
 * preference needs a real conversion rather than a display hack.
 */

import { runAnchor } from './domain.js';

export const KM_PER_MILE = 1.609344;
export const RUN_UNITS = ['minutes', 'km', 'miles', 'auto'];
export const DEFAULT_RUN_UNIT = 'auto';

export const kmToMiles = km => km / KM_PER_MILE;
export const milesToKm = mi => mi * KM_PER_MILE;

/* Round a distance to something a person would actually say. Interval reps
   land on neat fractions (400 m, 1 km, 1 mile); session totals get one
   decimal. Rounding to three decimals would be more accurate and less
   honest: the underlying estimate is nowhere near that good. */
export function roundDistance(value, unit) {
  if (value == null) return null;
  if (unit === 'miles') return Math.round(value * 10) / 10;
  return value >= 10 ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100;
}

/* Distance for a given number of minutes at a given pace (seconds per km).
   Returns null without a pace, because an unanchored distance is not a
   conservative estimate, it is a fabrication. */
export function distanceForMinutes(minutes, secPerKm, unit) {
  if (!minutes || !secPerKm) return null;
  const km = minutes * 60 / secPerKm;
  return roundDistance(unit === 'miles' ? kmToMiles(km) : km, unit);
}

export function unitLabel(unit) {
  return unit === 'miles' ? 'mi' : 'km';
}

/* A display string for a distance, tilde-marked when the anchor behind it is
   an estimate (§4, §6 "approximate conversions are labelled"). The tilde is
   the same convention the pace copy already uses, so an athlete reads one
   signal for "this is modelled" across the whole app. */
export function fmtDistance(value, unit, approximate) {
  if (value == null) return null;
  return (approximate ? '~' : '') + roundDistance(value, unit) + ' ' + unitLabel(unit);
}

/* §5's default table, as a function. Which unit a session is best expressed
   in, when the athlete has not forced one:

     - easy and recovery running by TIME, because the point is the duration
       on the feet and a distance target invites racing an easy day
     - intervals by distance, which is how reps are actually spoken about
     - long runs by distance on a standalone run plan, because that is the
       number the athlete is training toward
     - every triathlon run by time, where the session has to fit a week that
       also holds a swim and a ride

   An explicit preference always wins; 'auto' consults this. */
export function preferredUnit({ workout, preference, soloRun, athleteUnit }) {
  const pref = RUN_UNITS.includes(preference) ? preference : DEFAULT_RUN_UNIT;
  if (pref !== 'auto') return pref;
  const distanceUnit = athleteUnit === 'miles' ? 'miles' : 'km';
  const type = workout && workout.type;
  if (!soloRun) return 'minutes';
  if (type === 'Long') return distanceUnit;
  if (type === 'Easy' || !type) return 'minutes';
  if (type === 'Test') return distanceUnit;   // the 5 km test is a distance by definition
  return distanceUnit;                        // the quality formats: reps read as distance
}

/* A run workout expressed in the athlete's unit, without touching it.
 *
 * Returns null for 'minutes', so a caller can fall through to the existing
 * duration copy rather than having to compare strings. The workout's own
 * distEst decides the tilde, because that flag already tracks whether the
 * pace behind it was real (it is set from runEstimated at build time), and a
 * second opinion here could disagree with the card.
 */
export function runWorkoutDistance({ workout, unit, profile }) {
  if (!workout || workout.discipline !== 'run') return null;
  if (unit === 'minutes' || !unit) return null;
  const km = workout.distance;
  if (km == null) return null;
  const value = unit === 'miles' ? kmToMiles(km) : km;
  // An estimated anchor means an estimated distance. Prefer the workout's own
  // flag; fall back to the anchor for a workout built before it was stamped.
  const approximate = workout.distEst != null
    ? !!workout.distEst
    : runAnchor(profile).kind !== 'real';
  return { value: roundDistance(value, unit), unit, approximate, label: fmtDistance(value, unit, approximate) };
}

/* A rep label in distance: "6 × 1 km" or "3 × 2 miles" (§3).
 *
 * Takes the rep's MINUTES and the pace it is prescribed at, so the printed
 * distance is the one that session actually covers rather than a nominal
 * round number. Where that lands close to a neat distance it snaps, because
 * "6 × 1 km" is what a coach says and "6 × 0.98 km" is what a spreadsheet
 * says; the snap is only ever cosmetic, and never moves the minutes.
 */
const NEAT_KM = [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.6, 2, 3, 4, 5];
const NEAT_MI = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
export function repDistanceLabel({ reps, perMin, secPerKm, unit, approximate }) {
  if (!reps || !perMin || !secPerKm || unit === 'minutes' || !unit) return null;
  const km = perMin * 60 / secPerKm;
  const raw = unit === 'miles' ? kmToMiles(km) : km;
  const neat = (unit === 'miles' ? NEAT_MI : NEAT_KM)
    .find(n => Math.abs(raw - n) / n <= 0.08);
  const shown = neat != null ? neat : roundDistance(raw, unit);
  return (approximate ? '~' : '') + reps + ' × ' + shown + ' ' + unitLabel(unit);
}
