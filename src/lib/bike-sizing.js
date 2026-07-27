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
  'VO2 Intervals': { on: 3, off: 4 },
};

/* What one effort of each type is allowed to be, in minutes.
 *
 * The ceiling is the load-bearing one. An earlier version progressed by
 * adding a flat three minutes to the effort, which on a four-minute VO2
 * repetition produced eight-minute repetitions still stamped at VO2 power.
 * Forty minutes above threshold off three-minute recoveries is not a harder
 * session, it is one nobody can complete, and the review engine would then
 * have marked every repetition off target for the rest of the block. A
 * repetition's length is a property of the type, so its limits are too. */
const ON_LIMITS = {
  Tempo: { min: 8, max: 20, offMin: 2, step: 4 },
  'Sweet Spot': { min: 8, max: 20, offMin: 2, step: 4 },
  Threshold: { min: 5, max: 18, offMin: 2, step: 3 },
  // BIKE_SIZING's own degrade rule for this type: "drop whole reps, never
  // the recovery: short recovery makes it anaerobic, not aerobic". The rungs
  // that shorten recovery were ignoring it, and because a shorter recovery
  // lets more efforts fit, they were quietly adding a quarter to the plan's
  // total time above threshold. The floor is the rule, in code.
  'VO2 Intervals': { min: 3, max: 6, offMin: 3, step: 1 },
};

/* The progression ladder, one variable per step (§3, "avoid increasing
   intensity, duration and density simultaneously").
 *
 * REPETITION COUNT IS THE VARIABLE, and the length of one effort is then
 * sized to fill the time the session has. That is the opposite of the
 * obvious arrangement, and it is deliberate, because the obvious one does
 * not work: with the effort length as the variable, the repetition count has
 * to be whatever still fits, which is already the largest count that fits,
 * so a step that asked for one more repetition had it taken straight back
 * off by the fitting arithmetic. Both rep-adding rungs were provably
 * identical to the base rung at every legal input, and the unit test did not
 * notice because it asserted the table rather than the behaviour. Driving
 * from the count and fitting the length makes every rung observable, and the
 * test below asserts that against bikeMainSet rather than against this
 * table.
 *
 * The second reason is that it keeps the card's CHARACTER fixed. Whether a
 * rep set can be built at all now depends only on the type, the level and
 * the time available, never on which rung the week landed on, so progressing
 * can no longer turn an interval session into a continuous block, and a trim
 * can no longer flip a session's format on its way down.
 *
 * THE LENGTH IS FIVE ON PURPOSE. The index is the week, and recovery weeks
 * are pinned to 0, so the only indices a training week can take are the ones
 * the recovery cadence leaves behind. With a four-step ladder and the
 * four-week cadence intermediate, advanced and elite all use, training weeks
 * only ever landed on 0, 1 and 2: a quarter of the ladder was unreachable
 * for three of the four levels. Five is coprime with both cadences in use. */
export const PROGRESSION_STEPS = [
  { id: 'base', reps: 0, off: 0, why: 'the session as written' },
  { id: 'reps', reps: 1, off: 0, why: 'one more repetition, each a little shorter' },
  { id: 'duration', reps: -1, on: 1, off: 0, why: 'longer efforts, fewer of them' },
  { id: 'density', reps: 0, off: -1, why: 'the same efforts, less recovery between them' },
  { id: 'sharpen', reps: 0, off: -2, why: 'the same efforts again, off shorter recoveries still' },
];
/* Two rungs move the recovery and only one moves the count, because the
   count is capped by the level gate and a second count rung landed on that
   cap: asking a beginner for two more repetitions than a shape that already
   holds three got clamped straight back to three. The recovery has no such
   cap, so the two recovery rungs stay distinct at every level. */

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* The shape of one session's main set, after level gating and progression.
   mainMin is the time available for the main set; the set fills it, so the
   card still sums and the remainder cannot pile up in the cool-down.
 *
 * The progression index is the SEED, which is already the week index and is
 * already pinned to 0 in a recovery week. That gives three things for free:
 * the ladder advances week to week, a recovery week resets to the base step
 * rather than climbing inside a week meant to remove load, and every path
 * that builds or rebuilds a session already passes it, so a rebuild cannot
 * return a different session than the one it replaced. */
/* The time a session of this type has for its main set, once the type's own
   shoulders are taken out. Read from the table rather than hardcoded at the
   call sites, so BIKE_SIZING is load-bearing rather than a constant that
   documentation tests assert against itself. */
export function mainSetMinutes(type, durationMin) {
  const sz = BIKE_SIZING[type];
  if (!sz || !durationMin) return 0;
  return Math.max(0, durationMin - sz.warm - sz.cool);
}

export function bikeMainSet({ type, intensity, seed, mainMin }) {
  const shape = BASE_SHAPE[type];
  const limits = ON_LIMITS[type];
  if (!shape || !limits || !mainMin || mainMin <= 0) return null;
  const gate = levelGate(intensity);
  const step = PROGRESSION_STEPS[(seed || 0) % PROGRESSION_STEPS.length];

  const baseOff = Math.max(1, Math.round(shape.off * gate.offScale));
  // Whether a rep set is possible at all is judged on the BASE recovery, so
  // the answer is the same on every rung: two efforts at the shortest this
  // type allows. Below that the caller builds something else, and it does so
  // for the whole ladder or none of it.
  if (2 * (limits.min + baseOff) > mainMin) return null;

  const off = Math.max(limits.offMin, baseOff + (step.off || 0));
  const baseOn = clamp(Math.round(shape.on * gate.onScale), limits.min, limits.max);

  // the count this shape naturally holds, then the rung's move on it
  const natural = clamp(Math.floor(mainMin / (baseOn + off)), 2, gate.maxReps);
  let reps = clamp(natural + step.reps, 2, gate.maxReps);
  /* The effort then fills the time that count leaves, but only up to what
     this rung actually asks for. Letting it fill all the way to the type's
     ceiling looks like it just uses the card better, and for tempo it nearly
     does; for VO2 it turned the shipped 6 x (3 min hard) into 6 x (6 min
     hard) and put a quarter more of the whole plan above threshold, because
     spare minutes on a long card are not VO2 work. Surplus beyond the target
     belongs outside the main set. */
  const target = clamp(baseOn + (step.on || 0) * limits.step, limits.min, limits.max);
  const fit = () => { on = clamp(Math.min(target, Math.floor(mainMin / reps) - off), limits.min, limits.max); };
  let on; fit();
  // a shorter effort has a floor, so a high count may not fit after all
  while (reps > 2 && reps * (on + off) > mainMin) { reps -= 1; fit(); }
  // and when the effort is already at target, spend the remainder on more of them
  while (reps < gate.maxReps && (reps + 1) * (target + off) <= mainMin) { reps += 1; fit(); }

  return {
    on, off, reps, step: step.id, stepWhy: step.why,
    minutes: reps * (on + off),
    // §4: the one structure that unlocks with experience and is actually
    // rendered here. Over-unders are a variant-level decision in plan.js and
    // are deliberately NOT claimed on this object, because variant 0 renders
    // a plain rep set and a field saying otherwise would be a lie waiting
    // for its first consumer.
    cadence: gate.cadence && type === 'Sweet Spot' ? 'a controlled cadence (85–95 rpm)' : null,
  };
}
