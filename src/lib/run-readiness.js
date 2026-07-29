/* Try — race readiness for the run, as components. (run phase 8 §5)
 *
 * NO SCORE, and that is the whole design. §5 says "avoid one opaque score"
 * and §6 says readiness must be component based, for the reason the bike
 * readiness module already recorded: a single number invites an athlete to
 * read a probability of success into arithmetic that carries nothing of the
 * sort, and it hides which part is actually weak. Eight components, each
 * answerable, each with its own evidence.
 *
 * UNKNOWN IS A STATE, not a zero. The bike's version shipped a bug where a
 * missing FTP read as "ready" because the else arm claimed a fact the code
 * had never checked — so a brand-new athlete and one returning from injury
 * both read ready, and since no reviews were stored yet, that was every
 * athlete. Every component below returns 'unknown' when it has nothing to
 * go on, and 'unknown' is never quietly treated as fine.
 */

import { runAnchor } from './domain.js';
import { longRunMix } from './run-durability.js';
import { RUN_QUALITY_TYPES } from './runschema.js';

export const RUN_READINESS_STATES = ['ready', 'building', 'at-risk', 'unknown'];

// §5's list, in the order a runner would ask about them.
export const RUN_READINESS_COMPONENTS = [
  'speed', 'threshold', 'endurance', 'longRunDurability',
  'racePaceExecution', 'fuelling', 'consistency', 'loadStability',
];

const state = (s, why) => ({ state: s, why });
const UNKNOWN = why => state('unknown', why);

/* Readiness from what has actually been recorded. Every argument is
   optional, and an absent one produces 'unknown' rather than an assumption.
 *
 * `reviews` are runReview results, `longs` are built long-run workouts,
 * `volume` is runVolumeModel output, `signals` are runDurabilitySignals.
 */
export function runReadiness({ profile, reviews, longs, volume, signals, fuelLogs, raceKey }) {
  const rv = (reviews || []).filter(r => r && r.discipline === 'run');
  const done = t => rv.filter(r => r.type === t && r.completion != null && r.completion >= 0.9);
  const out = {};

  // SPEED and THRESHOLD: has the athlete completed the work, and did it land?
  const fromType = (types, label) => {
    const hits = types.flatMap(done);
    if (!hits.length) return UNKNOWN('No completed ' + label + ' sessions recorded yet.');
    const off = hits.filter(r => r.paceAdherence != null && r.paceAdherence > 8).length;
    if (off > hits.length / 2) return state('at-risk', 'Most recorded ' + label + ' sessions landed off target.');
    if (hits.length < 3) return state('building', hits.length + ' ' + label + ' session' + (hits.length === 1 ? '' : 's') + ' recorded so far.');
    return state('ready', hits.length + ' ' + label + ' sessions completed on target.');
  };
  out.speed = fromType(['VO2 Intervals'], 'VO2');
  out.threshold = fromType(['Threshold', 'Tempo'], 'threshold');

  // ENDURANCE: weekly volume holding up, from the volume model.
  const weeks = (volume || []).filter(w => w && w.minutes > 0);
  out.endurance = !weeks.length
    ? UNKNOWN('No recorded running yet.')
    : weeks.length < 4
      ? state('building', weeks.length + ' weeks of recorded running.')
      : state('ready', Math.round(weeks.reduce((t, w) => t + w.minutes, 0) / weeks.length) + ' min a week on average.');

  // LONG RUN DURABILITY: how long, and how varied the objectives were.
  const mix = longRunMix(longs || []);
  out.longRunDurability = !mix.total
    ? UNKNOWN('No long runs recorded yet.')
    : mix.distinct < 2
      ? state('building', 'Long runs so far have all had the same objective.')
      : state('ready', mix.total + ' long runs across ' + mix.distinct + ' different objectives.');

  // RACE-PACE EXECUTION: only meaningful where the race has a race pace.
  const rp = done('Race Pace');
  out.racePaceExecution = (raceKey !== 'runhalf' && raceKey !== 'runmarathon')
    ? UNKNOWN('This race distance does not prescribe separate race-pace work.')
    : !rp.length
      ? UNKNOWN('No race-pace sessions completed yet.')
      : rp.some(r => r.paceAdherence != null && r.paceAdherence <= 3)
        ? state('ready', 'Race-pace sessions are landing on target.')
        : state('building', rp.length + ' race-pace session' + (rp.length === 1 ? '' : 's') + ' recorded.');

  // FUELLING: rehearsed, or not.
  const fuelled = (fuelLogs || []).filter(f => f && f.level && f.level !== 'none');
  out.fuelling = (raceKey !== 'runhalf' && raceKey !== 'runmarathon')
    ? UNKNOWN('Fuelling is not a limiter at this distance.')
    : !fuelled.length
      ? UNKNOWN('No long-run fuelling recorded yet.')
      : fuelled.length < 3
        ? state('building', fuelled.length + ' fuelled long run' + (fuelled.length === 1 ? '' : 's') + ' so far.')
        : state('ready', fuelled.length + ' long runs fuelled in training.');

  // CONSISTENCY: are the prescribed sessions actually being done?
  const withCompletion = rv.filter(r => r.completion != null);
  out.consistency = !withCompletion.length
    ? UNKNOWN('No completed sessions recorded yet.')
    : (() => {
      const full = withCompletion.filter(r => r.completion >= 0.9).length / withCompletion.length;
      if (full >= 0.8) return state('ready', Math.round(full * 100) + '% of recorded sessions completed in full.');
      if (full >= 0.5) return state('building', Math.round(full * 100) + '% of recorded sessions completed in full.');
      return state('at-risk', 'Under half of recorded sessions are being completed.');
    })();

  // LOAD STABILITY: the durability cautions, restated as a component.
  out.loadStability = !weeks.length
    ? UNKNOWN('Not enough recorded running to judge load.')
    : (signals || []).length
      ? state('at-risk', (signals || []).map(s => s.caution).join(' '))
      : state('ready', 'Load has been progressing without a flagged jump.');

  // The anchor is not a component, but it decides how much any pace-based
  // component above is worth, so it is reported alongside rather than folded
  // into a number that would hide it.
  out.anchor = runAnchor(profile).kind;
  return out;
}

/* The one summary permitted: which components are weakest, named. Not a
   score — a list. A caller wanting "how ready am I" gets the parts that are
   not ready, which is the actionable form of the same question. */
export function runReadinessGaps(readiness) {
  if (!readiness) return [];
  return RUN_READINESS_COMPONENTS
    .filter(k => readiness[k] && (readiness[k].state === 'at-risk' || readiness[k].state === 'building'))
    .map(k => ({ component: k, state: readiness[k].state, why: readiness[k].why }));
}

// Quality types this module treats as evidence, exported so a surface cannot
// invent its own idea of which sessions count.
export const RUN_READINESS_QUALITY = RUN_QUALITY_TYPES;
