/* Try — the run workout shape, formalised.
 *
 * This is the shape the engine ACTUALLY builds, written down and checked,
 * not a new one. The phase spec proposed renaming the fields (sport,
 * durationMinutes, intervals, and lowercase type names like 'vo2'), and that
 * is not implemented, for the same two reasons the swim and bike modules
 * found when they were asked the same thing:
 *
 *   1. discipline / durationMin / segments are the SHARED cross-discipline
 *      workout object, read across the whole app. Renaming them for one
 *      discipline forks the shape rather than unifying it.
 *   2. The type strings are a closed set on the backend (WorkoutTypes).
 *      'VO2 Intervals' is the stored value; 'vo2' would 400 on save.
 *
 * Two further corrections the spec's type union needs, both found by
 * enumerating what generation emits rather than reading the spec:
 *
 *   - 'Test' is a real run type (the 5 km time trial that anchors the whole
 *     module) and the spec omits it. Leaving it out of the closed set would
 *     have made every test session fail validation.
 *   - 'race-pace' and 'shakeout' are NOT types. A race-pace long run is a
 *     Long whose segments carry race-pace targets, and a shakeout is a
 *     demoted Easy. Promoting either to a type would have split one session
 *     into two spellings with nothing reading the second.
 *
 * ONE SHAPE FACT WORTH KNOWING: run segments carry their minutes in a
 * top-level `min`, like bike and unlike swim (whose minutes live only in
 * `blocks`). A run segment may ALSO carry blocks for the structured watch
 * export, but its `min` is the authority. segMinutes() handles both.
 *
 * THE FACT THAT MATTERS MOST: a segment tagged `terrain: 'hill'` is
 * prescribed by EFFORT, not pace. Uphill pace reads slower at the same
 * effort, so grading a hill rep against a flat-pace target calls a
 * well-executed rep 'off target'. Anything judging a run must skip pace
 * grading where terrain is 'hill' (review.js does this today, and
 * runpass1.test.js pins it).
 */

/**
 * @typedef {object} RunSegment
 * @property {string} label      what the athlete reads on the card
 * @property {number} min        the segment's minutes. Authoritative for run.
 * @property {string} [detail]   the pace or RPE target line
 * @property {string} [zone]     'Z1'..'Z5'
 * @property {Array<{min:number, zone:string}>} [blocks]
 *           work and recovery alternation, for the structured watch export.
 *           Present on interval segments, absent on steady ones.
 * @property {string} [terrain]  'hill' where the segment is prescribed by
 *           effort rather than pace. See the note above.
 */

/**
 * @typedef {object} RunWorkout
 * @property {'run'} discipline
 * @property {string} type       one of RUN_TYPES, spelled as the backend stores it
 * @property {'easy'|'quality'|'long'|'custom'} role
 * @property {number} durationMin
 * @property {string} title
 * @property {RunSegment[]} segments
 * @property {number|null} [distance]  estimated km
 * @property {boolean} [distEst]       true when distance is a model estimate
 * @property {string} [unit]           'km'
 */

// The closed set, spelled exactly as the backend stores them. 'Long' is a
// separate type rather than a role-flavoured Easy: it has its own builder
// branch, its own duration table and its own caps.
export const RUN_TYPES = ['Easy', 'Fartlek', 'Tempo', 'Threshold', 'VO2 Intervals', 'Long', 'Test', 'Race Pace'];

// The run's easy session. Named here so a fallthrough lands on Easy rather
// than the first entry of some other table (the bike's recovery-week lesson,
// where a missing easy type resolved into the Threshold branch).
export const RUN_EASY_TYPE = 'Easy';

/* THE LADDER and THE CATEGORY are two different things, and phase 7 forced
 * them apart. The ladder is a PROGRESSION: five rungs, and which one an
 * athlete trains is a function of phase, level and race. 'Race Pace' is not
 * a rung on it — a race-pace session is not "harder than Threshold", it is a
 * different intent, prescribed by a calendar rather than climbed toward.
 *
 * But it IS quality, and everything that reasons about quality must count it:
 * the spacing contract must keep it away from the other hard day, and the
 * density signal must see it. Merging the two lists would put 'Race Pace' on
 * the ladder; keeping only one would hide it from both.
 */
// The generation ladder, easiest to hardest. INTENSITY_LADDER.run in plan.js
// is the generation-side copy of this order; runpass1.test.js asserts the two
// agree, because a ladder that disagrees with the judge is the failure that
// recurred four times across the swim and bike arcs.
export const RUN_LADDER_TYPES = ['Fartlek', 'Tempo', 'Threshold', 'VO2 Intervals'];

// Everything that counts as a hard day, ladder or not.
export const RUN_QUALITY_TYPES = [...RUN_LADDER_TYPES, 'Race Pace'];

// Types whose card carries a PACE target a review can grade against.
// Fartlek is deliberately absent: it is prescribed by feel ('surges by feel'),
// so there is no target to miss and no verdict to give. 'Race Pace' is here
// only conditionally in practice: its band resolves through pc.run.racePace,
// which exists only for a real benchmark, so an estimated athlete gets the
// effort wording and no verdict, which is the same gate (§2).
export const RUN_PACE_TYPES = ['Tempo', 'Threshold', 'VO2 Intervals', 'Race Pace'];

export function isRunWorkout(w) {
  return !!w && w.discipline === 'run' && RUN_TYPES.includes(w.type)
    && typeof w.durationMin === 'number' && Array.isArray(w.segments);
}

export function isRunSegment(s) {
  if (!s || typeof s.label !== 'string' || !s.label.length) return false;
  if (typeof s.min !== 'number' || !(s.min > 0)) return false;
  if (s.blocks !== undefined) {
    if (!Array.isArray(s.blocks) || !s.blocks.length) return false;
    if (!s.blocks.every(b => b && typeof b.min === 'number' && b.min > 0 && typeof b.zone === 'string')) return false;
  }
  return true;
}

// Is this segment prescribed by effort rather than pace? The one question a
// judge must ask before quoting a pace verdict. A helper rather than an
// inline `s.terrain === 'hill'` so that adding a second effort-prescribed
// terrain later updates every caller at once.
export function isEffortPrescribed(s) {
  return !!s && s.terrain === 'hill';
}

/* Structural problems with a built run, as a list of strings. Empty means the
   run is well formed. This is a shape check, not a coaching check: it asks
   whether the card can be rendered, exported and summed, not whether the
   session is a good idea. */
export function runWorkoutIssues(w) {
  const issues = [];
  if (!w || w.discipline !== 'run') return ['not a run workout'];
  if (!RUN_TYPES.includes(w.type)) issues.push('unknown type: ' + w.type);
  if (!w.title) issues.push('no title');
  if (!Array.isArray(w.segments) || !w.segments.length) {
    issues.push('no segments');
    return issues;
  }
  w.segments.forEach((s, i) => {
    if (!isRunSegment(s)) issues.push('segment ' + i + ' malformed: ' + ((s && s.label) || '?'));
  });
  // The card must sum to what it claims. A run whose segments do not add up
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

// A training run: excludes races, tests and the rest-day placeholder, which
// are not built by buildRun and must not be judged as if they were. Note the
// asymmetry with isRunWorkout, which DOES accept a Test: a test is a real run
// workout with a real shape, it is simply not a session to grade for
// adherence.
export function isTrainingRun(w) {
  return isRunWorkout(w) && !w.race && !w.bRace && !w.test && w.type !== 'Test';
}
