/* Try — the swim workout schema, formalised.
 *
 * Phase 1 (stabilise) does not invent a new shape: it writes down the one the
 * generator already produces and every consumer already reads, so later phases
 * (pool length, CSS zones, stroke, richer review) extend a documented contract
 * instead of guessing at it.
 *
 * IMPORTANT: this is the shared cross-discipline workout object, not a
 * swim-only structure. `discipline` and `type` are backend closed-set values
 * (PlanCatalog: Disciplines, WorkoutTypes) and MUST stay exactly as the
 * backend spells them — a lowercase 'css' or a renamed 'sport' field would
 * 400 the plan save. The validators below assert the real shape; they never
 * re-derive coaching invariants (session sizing, weekly distinctness), which
 * are owned by their own tests.
 */

// The swim TRAINING types a plan generates (the swim subset of the backend
// WorkoutTypes). A swim day can also legitimately hold a cross-cutting non-swim
// type: 'Test' (the CSS benchmark), 'RACE' (race day), or 'Rest'. Those are not
// swim workouts in this schema's sense; filter them out before validating.
export const SWIM_TYPES = ['Technique', 'Endurance', 'CSS Intervals', 'Open Water', 'Race Pace', 'Long'];
export const SWIM_ROLES = ['easy', 'quality', 'long'];

/**
 * @typedef {Object} SwimSegment  One line of a swim session's card.
 * @property {string}  label      What the athlete does ('1700 m continuous', 'Warm-up 300 m').
 * @property {string} [detail]    Pace / zone text (e.g. '1:45 /100m · Z3').
 * @property {Array}  [blocks]    The minute-bearing structure for swim (and for
 *                                run/bike rep sets): each { min:number, zone?:string }.
 *                                Swim segments carry their time HERE, not in a
 *                                top-level `min`.
 * @property {number} [min]       Top-level minutes, used by run/bike aerobic
 *                                buffers. A swim segment usually omits it.
 * @property {string} [zone]      Intensity zone tag ('Z1'..'Z5'), when top-level.
 * @property {Object} [swim]      Swim display metadata: { distM:number, pct:number }.
 * // A segment's minutes are `segMinutes(seg)` in plan.js: the block total when
 * // `blocks` is present, else the top-level `min`. That is the canonical accessor.
 * // Reserved for later phases (not emitted yet): stroke, drill,
 * // targetPaceSecondsPer100, recoverySeconds, repetitions, purpose, equipment.
 */

/**
 * @typedef {Object} SwimWorkout  A generated swim training session. This is the
 *   shared workout object; only the fields that matter to the swim contract are
 *   documented here.
 * @property {'swim'}  discipline  Backend Disciplines value. NOT 'sport'.
 * @property {'Technique'|'Endurance'|'CSS Intervals'|'Open Water'|'Race Pace'|'Long'} type
 *   Backend WorkoutTypes value, spelled exactly. NOT a lowercase slug.
 * @property {'easy'|'quality'|'long'} role  Drives sizing and weekly distinctness.
 * @property {number}  durationMin        Prescribed minutes (finite, >= 0). NOT 'durationMinutes'.
 * @property {SwimSegment[]} segments     The card. NOT 'intervals'.
 * @property {number|null} [distance]     Estimated distance, or null. Paired with...
 * @property {boolean} [distEst]          ...whether the distance is an estimate, and...
 * @property {string}  [unit]             ...its unit ('m').
 * @property {string}  [title]            Display title ('Technique Swim').
 * @property {boolean} [key]              Whether this is a week's key session.
 * @property {number}  [seed]             Variant seed (rebuild stability).
 * // Reserved for later phases (not emitted yet): poolUnit ('metres'|'yards'),
 * // objective, equipment.
 */

const isFiniteNum = n => typeof n === 'number' && Number.isFinite(n);
const isNonEmptyStr = s => typeof s === 'string' && s.length > 0;

/** True when `s` is a structurally valid swim segment. Minutes may live in a
 *  top-level `min` (run/bike buffers) or in `blocks` (swim, and rep sets); a
 *  real segment carries one or the other. */
export function isSwimSegment(s) {
  if (!s || typeof s !== 'object') return false;
  if (!isNonEmptyStr(s.label)) return false;
  const hasBlocks = s.blocks !== undefined;
  if (s.min !== undefined && (!isFiniteNum(s.min) || s.min < 0)) return false;
  if (hasBlocks) {
    if (!Array.isArray(s.blocks) || !s.blocks.length) return false;
    if (!s.blocks.every(b => b && typeof b === 'object' && isFiniteNum(b.min) && b.min >= 0)) return false;
  }
  if (!hasBlocks && !isFiniteNum(s.min)) return false; // must bear minutes somehow
  if (s.detail !== undefined && typeof s.detail !== 'string') return false;
  if (s.zone !== undefined && typeof s.zone !== 'string') return false;
  return true;
}

/**
 * The list of structural problems with a swim workout, empty when it conforms.
 * Structural only: it never judges coaching content (sizing, distinctness),
 * which the swim suite tests separately.
 */
export function swimWorkoutIssues(w) {
  const out = [];
  if (!w || typeof w !== 'object') return ['not an object'];
  if (w.discipline !== 'swim') out.push('discipline is not "swim": ' + w.discipline);
  if (!SWIM_TYPES.includes(w.type)) out.push('type is not a swim training type: ' + w.type);
  if (!SWIM_ROLES.includes(w.role)) out.push('role is not easy/quality/long: ' + w.role);
  if (!isFiniteNum(w.durationMin) || w.durationMin < 0) out.push('durationMin is not a non-negative number: ' + w.durationMin);
  if (!Array.isArray(w.segments)) out.push('segments is not an array');
  else w.segments.forEach((s, i) => { if (!isSwimSegment(s)) out.push('segment ' + i + ' is malformed'); });
  if (w.distance !== undefined && w.distance !== null && !isFiniteNum(w.distance)) out.push('distance is neither null nor a number');
  return out;
}

/** True when `w` is a structurally valid swim training workout. */
export function isSwimWorkout(w) {
  return swimWorkoutIssues(w).length === 0;
}

/** A swim slot that is a training session, not a test / race / rest placeholder. */
export function isTrainingSwim(w) {
  return !!w && w.discipline === 'swim' && !w.test && !w.race && !w.bRace && w.type !== 'Rest';
}
