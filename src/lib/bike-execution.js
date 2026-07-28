/* Try — how a bike session is actually executed (phase 4 §5, §6).
 *
 * The same card is a different session on a trainer and on a road. Indoors
 * the watts are handed to you and the difficulty is staying in position with
 * nothing to look at; outdoors the road decides, junctions and descents pull
 * the average down, and holding a number exactly is not possible and not the
 * point. Until now the plan said neither thing, so an athlete on a turbo and
 * an athlete on a lane got identical instructions and the review judged both
 * the same way.
 *
 * WHAT IT DOES NOT DO: it does not change the session. The environment
 * selects wording and a target mode; the segments, zones and durations are
 * untouched, so a rider who switches from road to trainer mid-block is doing
 * the same training, described honestly. That is also §6's rule for ERG
 * ("ERG state should not change the workout objective") applied one level up,
 * and it is why this is a read-time derivation rather than a build input:
 * nothing here can move a stored plan.
 */
import { bikePowerAnchor } from './domain.js';

export const ENVIRONMENTS = ['indoor', 'outdoor'];

/* Which environments a session type suits. 'either' is the common case and
   the honest default: most riding works in both places.
 *
 * The two that are not 'either' are not preferences, they are consequences.
 * A Long ride is where fuelling, position and terrain are rehearsed, none of
 * which a trainer teaches, and nobody is asked to sit on a turbo for three
 * hours to satisfy a table. VO2 work is the opposite: the efforts are short
 * enough that a single junction ruins one, and there is no way to ride them
 * properly on a road that has any. Both remain SUPPORTED in the other
 * environment, with wording that says what is lost. */
export const TYPE_SUITS = {
  Endurance: 'either',
  Long: 'outdoor',
  Tempo: 'either',
  'Sweet Spot': 'either',
  Threshold: 'either',
  'VO2 Intervals': 'indoor',
};

/* §5 target mode.
 *
 * Power only when the athlete has a MEASURED threshold. Phase 2 drew this
 * line already: an estimated FTP is derived from the athlete's level, so
 * prescribing watts from it is presenting a guess about their category as a
 * number about them. RPE is the honest instrument there, and it is also the
 * one that survives a flat battery.
 *
 * LEDGER, in the phase 2 style, so an audit can tell skipped from forgotten:
 *   power        implemented, gated on a real power anchor
 *   rpe          implemented, the fallback whenever power is not anchored
 *   heart-rate   NOT REACHABLE, and deliberately. The type allows it, but
 *                Try stores no measured heart-rate threshold, so choosing it
 *                would mean grading against a number nobody established.
 *                It stays in the union for the day a threshold HR exists;
 *                until then emitting it would be the kind of field that
 *                lies to its first consumer. */
export function bikeTargetMode(profile) {
  return bikePowerAnchor(profile || {}).kind === 'real' ? 'power' : 'rpe';
}

const BY_ENVIRONMENT = {
  indoor: [
    'No coasting and no junctions, so the time in zone is real time in zone. Expect it to feel harder than the same session outside.',
    'Set a fan up before you start. Heat, not legs, is what ends most indoor sessions.',
    'Your recorded distance and speed indoors come from the trainer, not the road, so the plan ignores both and counts your duration and power.',
  ],
  outdoor: [
    'Pick roads you can ride without stopping. Ride the effort rather than chasing the number through junctions and descents.',
    'Coasting and traffic pull a ride average down even when the effort was right, so judge the session on how the efforts felt, not on the average at the end.',
  ],
};

const BY_TYPE = {
  Long: {
    outdoor: 'This is the session that rehearses fuelling and position, so eat and drink to the plan you intend to race, and spend real time in your race position.',
    indoor: 'On a trainer you lose the terrain and the position practice, so if this is the only place you can ride it, break it up and stay on top of drinking.',
  },
  'VO2 Intervals': {
    indoor: 'The efforts are short enough that one interruption ruins one, which is why this session belongs indoors where nothing interrupts it.',
    outdoor: 'Only ride these outside on a road or climb with no junctions for the length of an effort. A stop mid-effort does not make it a shorter effort, it makes it a different session.',
  },
  Threshold: {
    indoor: 'Come up to the effort before it starts rather than at the moment it starts, so the first minute is work rather than a ramp.',
    outdoor: 'A steady climb is the easiest place to hold this. On the flat, hold your position and let the speed be whatever it is.',
  },
  'Sweet Spot': {
    outdoor: 'Rolling terrain suits this: stay on the effort over the top of rises rather than easing every time the road tips up.',
  },
  Endurance: {
    outdoor: 'The point is time, not pace. If you are riding with someone, ride the pace that keeps this easy for you.',
  },
};

/* §5: the execution variants for one workout. Every bike session supports
   both environments, so both are always returned; `suits` says which one the
   session was written for. */
export function bikeExecution(workout, profile) {
  if (!workout || workout.discipline !== 'bike') return null;
  const suits = TYPE_SUITS[workout.type] || 'either';
  const targetMode = bikeTargetMode(profile);
  const variants = ENVIRONMENTS.map(environment => {
    const specific = (BY_TYPE[workout.type] || {})[environment];
    return {
      environment,
      targetMode,
      instructions: specific ? [specific].concat(BY_ENVIRONMENT[environment]) : BY_ENVIRONMENT[environment].slice(),
    };
  });
  return { suits, targetMode, variants };
}

/* The one-line reason a session leans one way, for a card that has room for
   a sentence and not a section. Null when it genuinely does not matter,
   because "either is fine" is not worth the pixels. */
export function bikeEnvironmentNote(workout) {
  const suits = workout && workout.discipline === 'bike' ? (TYPE_SUITS[workout.type] || 'either') : null;
  if (suits === 'outdoor') return 'Best ridden outdoors';
  if (suits === 'indoor') return 'Best ridden indoors';
  return null;
}
