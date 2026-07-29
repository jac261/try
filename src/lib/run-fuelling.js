/* Try — fuelling the long run. (run phase 8 §3)
 *
 * Mirrors bike-fuelling.js, and inherits the two hazards that module was
 * fixed for, because they are properties of the problem rather than of the
 * bicycle:
 *
 *   THE CEILING IS THE TOP OF THE SCALE THE ATHLETE CAN ANSWER ON. The tap
 *   tops out at "race level". Prescribing above the highest answer the UI
 *   offers marks an athlete short no matter what they actually took,
 *   including one who took more than the plan asked for.
 *
 *   THE NOVICE DEFAULT IS NOT THE MAXIMUM. The bike's first version disabled
 *   the cap entirely when there was no history, which inverted the model: a
 *   first-time athlete was handed the largest dose in the system while one
 *   who had proven sixty grams was held to ninety. The header there named
 *   that exact hazard and the code did it anyway, and its test asserted the
 *   inversion as intended. An ordering test below pins the direction.
 *
 * RUNNING IS NOT RIDING, in one way that matters: the gut tolerates less
 * while running, so the same athlete's practical ceiling is lower and the
 * shortfall that matters is smaller. The numbers differ; the shape does not.
 */

export const RUN_FUEL_LEVEL_GRAMS = { none: 0, bit: 20, solid: 45, race: 70 };

export const RUN_FUELLING_RULES = {
  // Under this a run is fuelled by what the athlete already ate.
  noFuelBelowMin: 75,
  startAfterMin: 20,
  fluidLoPerHour: 400,
  fluidHiPerHour: 700,
  gutStepGrams: 15,
  shortfallGrams: 15,
  // The top of the answerable scale, and therefore the top of what may be
  // prescribed. Lower than the bike's 90: running tolerance is lower, and
  // the scale reflects that.
  ceilingGrams: 70,
  // What an athlete with no logged history starts on. NOT the maximum.
  novicePerHour: 40,
  // Sodium is prescribed only when the athlete has configured it; guessing a
  // sweat rate from nothing is worse than saying nothing.
  sodiumLoPerHour: 300,
  sodiumHiPerHour: 800,
};

/* Carbohydrate per hour before any cap, as a curve rather than bands.
   Duration bands with hard edges meant a routine six per cent trim could drop
   a session across a boundary and cut its fuelling by a third. Need does not
   have cliffs in it, so neither does this. */
export function runCarbTarget(durationMin) {
  const m = durationMin || 0;
  if (m < RUN_FUELLING_RULES.noFuelBelowMin) return 0;
  // 75 min -> ~30 g/h, rising toward the ceiling by about three hours
  const t = Math.min(1, (m - 75) / (180 - 75));
  return Math.round((30 + t * (RUN_FUELLING_RULES.ceilingGrams - 30)) / 5) * 5;
}

/* The proven tolerance from logged fuelling, or null with no history. Reads
   the highest level the athlete has actually completed a long run on, which
   is the only evidence available about their gut. */
export function provenTolerance(fuelLog) {
  const grams = (fuelLog || [])
    .filter(f => f && f.level && RUN_FUEL_LEVEL_GRAMS[f.level] != null && !f.gutUpset)
    .map(f => RUN_FUEL_LEVEL_GRAMS[f.level]);
  return grams.length ? Math.max(...grams) : null;
}

/* The fuelling plan for one run. Returns null for anything short enough not
   to need one, so a caller can render nothing rather than "0 g/h". */
export function runFuellingPlan({ workout, profile, fuelLog }) {
  if (!workout || workout.discipline !== 'run' || workout.race) return null;
  const min = workout.durationMin || 0;
  const base = runCarbTarget(min);
  if (!base) return null;

  const proven = provenTolerance(fuelLog);
  /* The cap. With history: one step above what the gut has proven. Without:
     the novice default. Never the ceiling by default — that is the inversion
     the bike shipped and had to undo. */
  const cap = proven != null
    ? Math.min(RUN_FUELLING_RULES.ceilingGrams, proven + RUN_FUELLING_RULES.gutStepGrams)
    : RUN_FUELLING_RULES.novicePerHour;
  const carbPerHour = Math.min(base, cap);
  const hours = min / 60;
  const p = (profile || {});
  return {
    discipline: 'run',
    durationMin: min,
    carbPerHour,
    carbTotal: Math.round(carbPerHour * hours),
    cappedBy: carbPerHour < base ? (proven != null ? 'proven-tolerance' : 'no-history') : null,
    provenGrams: proven,
    startAfterMin: RUN_FUELLING_RULES.startAfterMin,
    fluidMlPerHour: [RUN_FUELLING_RULES.fluidLoPerHour, RUN_FUELLING_RULES.fluidHiPerHour],
    // §3 "sodium where configured": absent unless the athlete has said so.
    sodiumMgPerHour: p.sweatSodium
      ? [RUN_FUELLING_RULES.sodiumLoPerHour, RUN_FUELLING_RULES.sodiumHiPerHour] : null,
    why: carbPerHour < base && proven == null
      ? 'Starting conservatively because we have no record of what your gut handles yet. It rises as you log long runs.'
      : carbPerHour < base
        ? 'A step up from the ' + proven + ' g/h you have already handled, rather than a jump to what the distance asks for.'
        : 'What a run of this length asks for.',
  };
}

/* Planned versus consumed (§3). Returns the comparison and whether the gap
   is real, never a verdict on the athlete. */
export function runFuellingOutcome({ plan, level, gutUpset }) {
  if (!plan) return null;
  const took = RUN_FUEL_LEVEL_GRAMS[level];
  if (took == null) return { status: 'unlogged', plannedPerHour: plan.carbPerHour };
  const gap = plan.carbPerHour - took;
  return {
    plannedPerHour: plan.carbPerHour,
    takenPerHour: took,
    gutUpset: !!gutUpset,
    status: gutUpset ? 'gut-limited'
      : gap >= RUN_FUELLING_RULES.shortfallGrams ? 'short'
        : took > plan.carbPerHour ? 'above-plan' : 'on-plan',
  };
}
