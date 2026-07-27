/* Try — the bike workout shape, formalised.
 *
 * This is the shape the engine ACTUALLY builds, written down and checked,
 * not a new one. The phase spec proposed renaming the fields (sport,
 * durationMinutes, intervals, and lowercase type names like 'sweet-spot'),
 * and that is not implemented for the same two reasons the swim module found
 * when it was asked the same thing:
 *
 *   1. discipline / durationMin / segments are the SHARED cross-discipline
 *      workout object, read across the whole app. Renaming them for one
 *      discipline forks the shape rather than unifying it.
 *   2. The type strings are a closed set on the backend (WorkoutTypes).
 *      'Sweet Spot' is the stored value; 'sweet-spot' would 400 on save.
 *
 * So the useful half is this: say precisely what the shape is, and give the
 * tests something to check it against.
 *
 * ONE SHAPE FACT WORTH KNOWING, because it differs from swim: bike segments
 * carry their minutes in a top-level `min`. Swim segments carry theirs in
 * `blocks: [{min, zone}]` and have no top-level min. A bike segment may ALSO
 * carry blocks (the interval breakdown for the watch push), but its `min` is
 * the authority. segMinutes() handles both, and anything walking segments
 * across disciplines must go through it.
 */

/**
 * @typedef {object} BikeSegment
 * @property {string} label      what the athlete reads on the card
 * @property {number} min        the segment's minutes. Authoritative for bike.
 * @property {string} [detail]   the watt or RPE target line
 * @property {string} [zone]     'Z1'..'Z5'
 * @property {Array<{min:number, zone:string}>} [blocks]
 *           work and recovery alternation, for the structured watch export.
 *           Present on interval segments, absent on steady ones.
 * @property {string} [terrain]  'hill' where the segment is terrain-specific
 */

/**
 * @typedef {object} BikeWorkout
 * @property {'bike'} discipline
 * @property {string} type       one of BIKE_TYPES, spelled as the backend stores it
 * @property {'easy'|'quality'|'long'|'custom'} role
 * @property {number} durationMin
 * @property {string} title
 * @property {BikeSegment[]} segments
 * @property {number|null} [distance]  estimated km
 * @property {boolean} [distEst]       true when distance is a model estimate
 * @property {string} [unit]           'km'
 */

// The closed set, spelled exactly as the backend stores them. 'Long' is a
// separate type rather than a role-flavoured Endurance: it has its own
// builder branch and its own duration table.
export const BIKE_TYPES = ['Endurance', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals', 'Long'];

// Endurance IS the bike's easy session. There is no 'Easy' bike type: the
// run has one, and a bike falling through to it would land in the Threshold
// branch instead (the recovery-week lesson).
export const BIKE_EASY_TYPE = 'Endurance';

// Types whose card carries a watt target rather than pure RPE. Used by the
// review and the tests to know when a power verdict is even possible.
export const BIKE_POWER_TYPES = ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'];

export function isBikeWorkout(w) {
  return !!w && w.discipline === 'bike' && BIKE_TYPES.includes(w.type)
    && typeof w.durationMin === 'number' && Array.isArray(w.segments);
}

export function isBikeSegment(s) {
  if (!s || typeof s.label !== 'string' || !s.label.length) return false;
  if (typeof s.min !== 'number' || !(s.min > 0)) return false;
  if (s.blocks !== undefined) {
    if (!Array.isArray(s.blocks) || !s.blocks.length) return false;
    if (!s.blocks.every(b => b && typeof b.min === 'number' && b.min > 0 && typeof b.zone === 'string')) return false;
  }
  return true;
}

/* Structural problems with a built ride, as a list of strings. Empty means
   the ride is well formed. This is a shape check, not a coaching check: it
   asks whether the card can be rendered, exported and summed, not whether
   the session is a good idea. */
export function bikeWorkoutIssues(w) {
  const issues = [];
  if (!w || w.discipline !== 'bike') return ['not a bike workout'];
  if (!BIKE_TYPES.includes(w.type)) issues.push('unknown type: ' + w.type);
  if (!w.title) issues.push('no title');
  if (!Array.isArray(w.segments) || !w.segments.length) {
    issues.push('no segments');
    return issues;
  }
  w.segments.forEach((s, i) => {
    if (!isBikeSegment(s)) issues.push('segment ' + i + ' malformed: ' + ((s && s.label) || '?'));
  });
  // The card must sum to what it claims. A ride whose segments do not add up
  // to its duration lies to the athlete and to the load model.
  const total = w.segments.reduce((t, s) => t + (s.min || 0), 0);
  if (w.durationMin && Math.abs(total - w.durationMin) > 1.01) {
    issues.push('segments sum to ' + Math.round(total) + ' min against a stated ' + w.durationMin);
  }
  // Blocks, where present, must not claim more time than their segment.
  w.segments.forEach((s, i) => {
    if (!Array.isArray(s.blocks)) return;
    const b = s.blocks.reduce((t, x) => t + (x.min || 0), 0);
    if (b > (s.min || 0) + 1.01) issues.push('segment ' + i + ' blocks exceed its minutes');
  });
  return issues;
}

// A training ride: excludes races, tests and the rest-day placeholder, which
// are not built by buildBike and must not be judged as if they were.
export function isTrainingRide(w) {
  return isBikeWorkout(w) && !w.race && !w.bRace && !w.test;
}
