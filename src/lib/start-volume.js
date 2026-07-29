/* Try — where the athlete is starting from, and how fast a plan may grow
 * away from it.
 *
 * THE DEFECT THIS EXISTS FOR: a full-distance plan at advanced level opened
 * week one with a 4.3 km long swim, a three-and-a-half-hour ride and a
 * two-hour run. Week volume was sized from the RACE (the long-session
 * tables are race-keyed) times a phase ramp that starts at 0.82, times a
 * level factor that makes advanced BIGGER — so the start of every plan was
 * anchored to where the athlete is going, and nothing anywhere asked where
 * they are. The level factor is a statement about ability, not about
 * current volume: an advanced athlete may sign up for a full while
 * currently swimming 2 km longs, and handing them 4.3 km in week one is
 * how a plan gets abandoned or an athlete gets hurt.
 *
 * THE ANCHORS ARE OPTIONAL, AND ABSENT MEANS TODAY'S BEHAVIOUR EXACTLY.
 * Nothing here runs for a profile that never answered the onboarding
 * questions, so every existing plan regenerates byte-identically — a test
 * holds that across the full config sweep.
 *
 * THE MECHANISM IS START-THERE-AND-GROW. Long sessions start at the
 * athlete's own current longest and grow about ten per cent per training
 * week until the curve meets the race-driven plan, which then takes over
 * unchanged. The anchors only ever LOWER a session, never raise one, so
 * once the grown anchor crosses the engine's number they are a no-op:
 * peak weeks are untouched and high volume stays possible (the standing
 * rule from the volume-double decision) — only the run-in changes.
 * Recovery weeks do not advance the growth clock (they reduce load, so
 * they are not evidence the athlete absorbed more), and their dips
 * survive because taking the minimum of two curves keeps whichever is
 * lower.
 */

const round5 = n => Math.round(n / 5) * 5;

export const START_VOLUME_RULES = {
  growthPerWeek: 1.10,   // the classic guideline; compounds per TRAINING week
  weeklyFloor: 0.4,      // the hours anchor never cuts a week below this share
  sessionFloorMin: 20,   // no anchored session below this
  // sanity clamps: outside these the answer is treated as a typo and ignored
  /* Wide enough that a genuine couch-start answer is honoured: ninety
     minutes a week and a fifteen-minute longest run are real beginners, not
     typos. Only the physically implausible is ignored. */
  hours: [1, 30],
  swimM: [100, 8000],
  rideMin: [20, 480],
  runMin: [15, 300],
};

const inRange = (v, [lo, hi]) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : null);

/* The athlete's answers, sanitised and converted into the engine's own
   units (minutes). Swim metres convert through the athlete's own steady
   pace, which exists even before a CSS is measured because computePaces
   derives one from the level. */
export function startAnchors(profile, pc) {
  const p = profile || {};
  const hours = inRange(Number(p.weeklyHours), START_VOLUME_RULES.hours);
  const swimM = inRange(Number(p.longestSwimM), START_VOLUME_RULES.swimM);
  const rideMin = inRange(Number(p.longestRideMin), START_VOLUME_RULES.rideMin);
  const runMin = inRange(Number(p.longestRunMin), START_VOLUME_RULES.runMin);
  const steady = pc && pc.swim && (pc.swim.steady || pc.swim.css);
  return {
    weeklyMin: hours != null ? Math.round(hours * 60) : null,
    swimLongMin: swimM != null && steady ? Math.round(swimM / 100 * steady / 60) : null,
    rideLongMin: rideMin,
    runLongMin: runMin,
    any: hours != null || (swimM != null && !!steady) || rideMin != null || runMin != null,
  };
}

/* The grown anchor at a point in the plan: the athlete's start, compounded
   once per completed training week. */
export function grownCap(anchorMin, trainingWeeksElapsed) {
  if (anchorMin == null) return null;
  return anchorMin * Math.pow(START_VOLUME_RULES.growthPerWeek, Math.max(0, trainingWeeksElapsed));
}

/* The ceiling for one long session, or null when no anchor applies.
 *
 * A brick rides the BIKE anchor: its duration is dominated by the bike leg,
 * and asking a fourth question to split the difference is not worth the
 * onboarding field. Stated so it reads as a decision, not an oversight. */
export function anchorLongCap({ anchors, disc, isLong, trainingWeeksElapsed }) {
  if (!anchors || !anchors.any || !isLong) return null;
  const a = disc === 'swim' ? anchors.swimLongMin
    : disc === 'run' ? anchors.runLongMin
      : (disc === 'bike' || disc === 'brick') ? anchors.rideLongMin : null;
  const grown = grownCap(a, trainingWeeksElapsed);
  return grown == null ? null : Math.max(START_VOLUME_RULES.sessionFloorMin, round5(grown));
}

/* The weekly-hours anchor, applied to a fully built week.
 *
 * Returns the scale factor the week's flexible sessions should shrink by,
 * or null when the week already fits. A long session is only OUTSIDE the
 * pool when its own discipline anchor already capped it at sizing time —
 * exempting all longs unconditionally left a race-sized long swim untouched
 * for the athlete who answered only the hours question, while their quality
 * sessions were gutted to stubs. Tests, races and strength keep their fixed
 * shapes. recoveryDepth carries the engine's own step-back so a binding cap
 * cannot hand a recovery week a HIGHER ceiling than the training week
 * before it. The floor keeps a mistyped answer from flattening a plan;
 * below it the week is allowed to exceed the anchor, and honesty about
 * that beats a week of sessions too short to mean anything. */
export function weeklyHoursScale({ anchors, plannedMin, flexibleMin, trainingWeeksElapsed, recoveryDepth }) {
  if (!anchors || anchors.weeklyMin == null || !plannedMin || !flexibleMin) return null;
  const allowed = grownCap(anchors.weeklyMin, trainingWeeksElapsed) * (recoveryDepth || 1);
  if (plannedMin <= allowed) return null;
  const cut = plannedMin - allowed;                 // minutes that must go
  const f = (flexibleMin - cut) / flexibleMin;      // borne by flexible sessions
  return Math.max(START_VOLUME_RULES.weeklyFloor, f);
}
