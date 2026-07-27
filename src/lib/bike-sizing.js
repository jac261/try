/* Try — bike session sizing and progression (phase 3 §2, §3, §4).
 *
 * Two things live here, because they are the same decision seen twice: how
 * long a session is, and what shape fills that time.
 *
 * THE RULE THAT GOVERNS BOTH: a card must sum to the minutes it claims. So
 * progression never adds time. It changes the SHAPE of the main set (how
 * long each effort is, how much recovery sits between them, whether the
 * effort is an over-under, whether a cadence constraint applies) and the rep
 * count then fills whatever main-set time the session has. That is also what
 * makes "one variable at a time" (§3) true in practice rather than on paper:
 * each step moves exactly one knob and the arithmetic absorbs the rest.
 *
 * WHY PROGRESSION IS INDEXED BY THE WEEK, NOT STORED: a retarget regenerates
 * every week of the plan, so anything remembered about where an athlete had
 * got to would have to survive a rebuild or the plan would change under
 * them. Position within the block is already a property of the week, so
 * progression derived from it is deterministic, rebuild-stable, and free.
 */

/* §2. Minutes, per session type.
 *   minimum      below this the session is not worth building; the caller
 *                degrades to Endurance instead
 *   standard     the band a session normally lives in
 *   ceiling      past this the session stops earning; more time goes to the
 *                Long ride instead
 *   warm / cool  fixed shoulders, so the main set is what flexes
 *   degrade      what shrinks first when the budget is tight */
export const BIKE_SIZING = {
  Endurance: {
    minimum: 30, standard: [45, 120], ceiling: 180, warm: 0, cool: 0,
    degrade: 'shorten the steady block; below the minimum it stays a ride rather than becoming structure',
  },
  Tempo: {
    minimum: 45, standard: [50, 90], ceiling: 120, warm: 15, cool: 10,
    degrade: 'drop whole reps, keep the shoulders; a tempo block below 8 minutes is not tempo',
  },
  'Sweet Spot': {
    minimum: 50, standard: [55, 100], ceiling: 120, warm: 15, cool: 10,
    degrade: 'drop whole reps before shortening them, so the effort stays long enough to work',
  },
  Threshold: {
    minimum: 50, standard: [55, 90], ceiling: 110, warm: 15, cool: 10,
    degrade: 'drop whole reps; shortening a threshold rep turns it into tempo',
  },
  'VO2 Intervals': {
    minimum: 45, standard: [50, 80], ceiling: 90, warm: 15, cool: 10,
    degrade: 'drop whole reps, never the recovery: short recovery makes it anaerobic, not aerobic',
  },
  Long: {
    minimum: 60, standard: [90, 240], ceiling: 300, warm: 0, cool: 0,
    degrade: 'shorten the steady lead-in and keep the quality block, so the session keeps its purpose',
  },
};

export function bikeSizing(type) {
  return BIKE_SIZING[type] || null;
}

/* §4. What each level is allowed to be given.
 *
 * Lower levels get simpler structures, shorter efforts, more recovery and
 * less total time in zone. Higher levels unlock the structures that only
 * help once the basics are habitual: over-unders and cadence constraints.
 * The keys are the intensity dial on FITNESS, which runs -1 to 2.
 */
export const LEVEL_GATES = {
  '-1': { onScale: 0.7, offScale: 1.4, maxReps: 3, overUnder: false, cadence: false, label: 'beginner' },
  0: { onScale: 1.0, offScale: 1.0, maxReps: 4, overUnder: false, cadence: false, label: 'intermediate' },
  1: { onScale: 1.15, offScale: 0.85, maxReps: 5, overUnder: true, cadence: true, label: 'advanced' },
  2: { onScale: 1.3, offScale: 0.75, maxReps: 6, overUnder: true, cadence: true, label: 'elite' },
};

export function levelGate(intensity) {
  return LEVEL_GATES[String(intensity == null ? 0 : intensity)] || LEVEL_GATES[0];
}

/* §3. The base shape of each session type's main set, before level and
   progression are applied. on/off are minutes. */
const BASE_SHAPE = {
  Tempo: { on: 12, off: 4 },
  'Sweet Spot': { on: 12, off: 5 },
  Threshold: { on: 10, off: 5 },
  'VO2 Intervals': { on: 4, off: 4 },
};

/* The progression ladder, one variable per step (§3, "avoid increasing
   intensity, duration and density simultaneously"). Steps cycle within a
   phase, so an athlete sees a build rather than a shuffle, and a recovery
   week resets to step 0 rather than continuing to climb. */
export const PROGRESSION_STEPS = [
  { id: 'base', on: 0, off: 0, why: 'the session as written' },
  { id: 'reps', on: 0, off: 0, addReps: 1, why: 'one more repetition, everything else held' },
  { id: 'duration', on: 3, off: 0, why: 'longer efforts, same recovery and count' },
  { id: 'density', on: 0, off: -1, why: 'less recovery, same efforts' },
];

/* The shape of one session's main set: what the athlete is actually asked to
   do, after level gating and progression. mainMin is the time available for
   the main set; reps fills it, so the card still sums.
 *
 * The progression index is the SEED, which is already the week index and is
 * already pinned to 0 in a recovery week. That gives three things for free:
 * the ladder advances week to week, a recovery week resets to the base step
 * rather than climbing inside a week meant to remove load, and every path
 * that builds or rebuilds a session already passes it, so a rebuild cannot
 * return a different session than the one it replaced. */
export function bikeMainSet({ type, intensity, seed, mainMin }) {
  const shape = BASE_SHAPE[type];
  if (!shape || !mainMin || mainMin <= 0) return null;
  const gate = levelGate(intensity);
  const step = PROGRESSION_STEPS[(seed || 0) % PROGRESSION_STEPS.length];

  // level first, then the single progressing variable
  let on = shape.on * gate.onScale + (step.on || 0);
  let off = shape.off * gate.offScale + (step.off || 0);
  on = Math.max(3, Math.round(on));
  // a recovery shorter than a minute is not a recovery
  off = Math.max(1, Math.round(off));

  const per = on + off;
  // Two reps is the floor below which this is not an interval session. If
  // even two will not fit the time available, the caller must build
  // something else rather than a set that overruns its own card: the sizing
  // contract (segments sum to durationMin) outranks the progression.
  if (per * 2 > mainMin) return null;
  let reps = Math.floor(mainMin / per);
  if (step.addReps) reps += step.addReps;
  reps = Math.min(reps, gate.maxReps);
  while (reps > 2 && reps * per > mainMin) reps -= 1;

  return {
    on, off, reps, step: step.id, stepWhy: step.why,
    minutes: reps * per,
    // §4: structures that only unlock with experience
    overUnder: !!gate.overUnder && type === 'Threshold',
    cadence: gate.cadence && type === 'Sweet Spot' ? '85-95 rpm' : null,
    level: gate.label,
  };
}
