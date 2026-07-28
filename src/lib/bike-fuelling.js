/* Try — session-specific fuelling (phase 6 §3).
 *
 * The plan has always told athletes to "practise your fuelling" and never
 * once told them what to practise. This turns that into a number for the
 * session in front of them, and then compares it to what they actually did.
 *
 * IT REUSES THE ANSWER THEY ALREADY GIVE. A four-level fuel tap
 * (nothing / a bit / solid / race level) is already captured against long
 * recordings and already read by the coach, and its caption already anchors
 * those words to 30, 60 and 90 grams an hour. So the consumed side needs no
 * new prompt, no new field and no backend column: what was missing was the
 * PLANNED side to compare it against. Coarse is also the right resolution
 * here — nobody recalls their intake to the gram, and a number that pretends
 * otherwise invites a precision the answer cannot carry.
 *
 * GUT TRAINING IS A CONSTRAINT, NOT AN ASPIRATION. Absorbing carbohydrate at
 * race rates is trained, and prescribing 90 g/h to someone who has never held
 * 60 is how a long ride becomes a gastrointestinal event. The target is
 * therefore capped one step above what the athlete has actually managed, and
 * the copy says why rather than silently serving a lower number.
 */
import { FUEL_LEVELS } from './bodymass.js';
import { RACES } from './domain.js';

/* The grams an hour each tap word means. These are the numbers the existing
   caption already shows the athlete, so the two can never drift apart. */
export const FUEL_LEVEL_GRAMS = { none: 0, bit: 30, solid: 60, race: 90 };

export const FUELLING_RULES = {
  noFuelBelowMin: 75,     // under this a ride runs on what you already had
  startAfterMin: 20,      // begin before you need it, not when you do
  fluidLoPerHour: 500,    // millilitres, temperate, no wind
  fluidHiPerHour: 750,
  gutStepGrams: 30,       // how far above proven tolerance a target may reach
  shortfallGrams: 25,     // consumed this far under target = a real shortfall
};

/* Carbohydrate per hour, before any cap.
 *
 * Duration leads because it is what empties the tank; intensity raises it
 * because the harder the riding the more of the work is carbohydrate; and a
 * brick raises it again because the run is where under-fuelling actually
 * shows up, not the bike. */
function baseCarbs({ durationMin, hasQualityBlock, brickFollows, raceType }) {
  let g = durationMin < FUELLING_RULES.noFuelBelowMin ? 0
    : durationMin < 150 ? 45
      : durationMin < 240 ? 75
        : 90;
  if (!g) return 0;
  if (hasQualityBlock) g += 15;
  if (brickFollows) g += 15;
  // long-course racing is won and lost on the stomach, so its rehearsals aim
  // at race rates rather than merely adequate ones
  const race = RACES[raceType];
  if (race && (race.bike >= 90)) g += 15;
  return Math.min(120, g);
}

/* What the athlete has actually proven they can take, from their own logged
   answers. Null when they have never answered, which is not the same as zero
   and must not be treated as it: an athlete with no history gets the
   unconstrained target and a note, not a beginner's ration.
 *
 * Internal on purpose: it is reported through bikeFuellingPlan's own
   provenGrams field, and an export nobody outside calls is exactly what this
   phase got wrong four times over. */
function provenIntake(fuelLog) {
  const levels = Object.values(fuelLog || {})
    .map(v => (typeof v === 'string' ? v : v && v.level))
    .filter(l => l && FUEL_LEVEL_GRAMS[l] != null);
  if (!levels.length) return null;
  // the best they have managed, not the average: tolerance is a ceiling they
  // have reached, and one bad day does not un-train a gut
  return Math.max(...levels.map(l => FUEL_LEVEL_GRAMS[l]));
}

/* §3: the plan for one session. Null for anything that is not a ride long
   enough to need one, so a caller cannot render a fuelling card on a
   forty-minute spin. */
export function bikeFuellingPlan({ workout, profile, fuelLog, brickFollows }) {
  if (!workout || workout.discipline !== 'bike') return null;
  const durationMin = workout.durationMin || 0;
  if (durationMin < FUELLING_RULES.noFuelBelowMin) return null;

  const hasQualityBlock = (workout.segments || []).some(s => s.zone && s.zone !== 'Z1' && s.zone !== 'Z2');
  const uncapped = baseCarbs({
    durationMin, hasQualityBlock, brickFollows: !!brickFollows,
    raceType: (profile || {}).raceType,
  });
  const proven = provenIntake(fuelLog);
  // one step above proven tolerance, never more
  const ceiling = proven == null ? uncapped : proven + FUELLING_RULES.gutStepGrams;
  const carbsPerHour = Math.min(uncapped, ceiling);
  const capped = carbsPerHour < uncapped;

  const hours = durationMin / 60;
  return {
    carbsPerHour,
    carbsTotal: Math.round(carbsPerHour * hours),
    fluidLoPerHour: FUELLING_RULES.fluidLoPerHour,
    fluidHiPerHour: FUELLING_RULES.fluidHiPerHour,
    fluidTotalLo: Math.round(FUELLING_RULES.fluidLoPerHour * hours),
    fluidTotalHi: Math.round(FUELLING_RULES.fluidHiPerHour * hours),
    // §3 asks for sodium "where configured". Nothing configures it: Try
    // stores no sweat rate and no sodium concentration, and a number invented
    // from bodyweight would be a guess dressed as a prescription for the one
    // variable that differs most between people. Named, not silently absent.
    sodiumMgPerHour: null,
    sodiumNote: 'Sodium is not personalised because your sweat rate is not something the app can know. If you already have a number that works, keep using it.',
    startAfterMin: FUELLING_RULES.startAfterMin,
    hours: Math.round(hours * 10) / 10,
    provenGrams: proven,
    capped,
    why: capped
      ? 'Held at one step above the most you have logged taking in, because absorbing carbohydrate is trained and this is the step that trains it.'
      : proven == null
        ? 'A starting point. Once you have logged what you actually took in on a few long rides, this will follow what your stomach has proven it can handle.'
        : 'Sized for the length and the intensity of this session.',
  };
}

/* §3: planned versus consumed, using the tap the athlete already gives.
 *
 * Returns null when they have not answered, because "no answer" is not
 * "nothing eaten" and scoring it as a shortfall would accuse people of a
 * failure they may not have had. */
export function fuellingOutcome({ plan, level }) {
  if (!plan || !level || FUEL_LEVEL_GRAMS[level] == null) return null;
  const consumed = FUEL_LEVEL_GRAMS[level];
  const gap = consumed - plan.carbsPerHour;
  const short = gap <= -FUELLING_RULES.shortfallGrams;
  return {
    plannedPerHour: plan.carbsPerHour,
    consumedPerHour: consumed,
    gapPerHour: gap,
    level, levelWord: FUEL_LEVELS[level],
    met: !short,
    text: short
      ? 'You took in about ' + consumed + ' g an hour against the ' + plan.carbsPerHour + ' g this session asked for. On a ride this long that gap is usually what the last hour felt like.'
      : consumed >= plan.carbsPerHour
        ? 'You hit the fuelling this session asked for, which is the part of a long ride most people skip.'
        : 'Close to the ' + plan.carbsPerHour + ' g an hour this session asked for.',
  };
}
