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
  /* THE CEILING IS THE TOP OF THE SCALE THE ATHLETE CAN ANSWER ON, and that
     is not a coincidence to be tidied away later. The tap tops out at "race
     level", which the caption defines as ninety grams or more. A target above
     that is unreachable by every answer the UI offers, so the athlete is
     marked short no matter what they did — including the rider who genuinely
     took more than the plan asked for. Prescribing beyond the scale you read
     back is incoherent, so the prescription stops where the scale does. */
  ceilingGrams: 90,
  /* What someone with no logged history is started on. NOT the maximum.
     The first version disabled the cap entirely when there was no history,
     which inverted the whole model: a first-time user was handed the largest
     dose in the system while a rider who had proven sixty got ninety. The
     module header named that exact hazard and the code did it anyway, and the
     test asserted the inversion as intended behaviour. */
  novicePerHour: 60,
};

/* Carbohydrate per hour, before any cap.
 *
 * A CURVE, NOT STEPS. This was three duration bands with hard edges, and the
 * adaptive engine trims by a factor and rounds to five minutes, so a routine
 * six per cent trim could drop a rider across a boundary and cut their
 * prescribed fuelling by thirty grams an hour — a twenty-nine per cent cut in
 * fuel for a six per cent cut in volume. Fuelling need does not have cliffs
 * in it, so neither does this. */
const CARB_CURVE = [
  { min: 75, g: 40 },
  { min: 150, g: 60 },
  { min: 240, g: 75 },
  { min: 360, g: 85 },
];
function curveCarbs(durationMin) {
  if (durationMin < FUELLING_RULES.noFuelBelowMin) return 0;
  const pts = CARB_CURVE;
  if (durationMin <= pts[0].min) return pts[0].g;
  if (durationMin >= pts[pts.length - 1].min) return pts[pts.length - 1].g;
  for (let i = 1; i < pts.length; i++) {
    if (durationMin <= pts[i].min) {
      const a = pts[i - 1], b = pts[i];
      return a.g + (b.g - a.g) * (durationMin - a.min) / (b.min - a.min);
    }
  }
  return pts[pts.length - 1].g;
}

function baseCarbs({ durationMin, hasQualityBlock, brickFollows, raceType }) {
  let g = curveCarbs(durationMin);
  if (!g) return 0;
  // harder riding burns a larger share of carbohydrate; a run to follow is
  // where under-fuelling actually presents itself; long-course racing is won
  // and lost on the stomach
  if (hasQualityBlock) g += 8;
  if (brickFollows) g += 8;
  const race = RACES[raceType];
  if (race && race.bike >= 90) g += 8;
  return Math.min(FUELLING_RULES.ceilingGrams, Math.round(g / 5) * 5);
}

/* What the athlete has actually proven they can take, from their own logged
   answers.
 *
 * TWO FILTERS, BOTH LEARNED THE HARD WAY.
 *
 * Only RIDES count. The tap is shared with long swims and long runs, where
 * taking nothing in is normal and correct, and reading those as a gut ceiling
 * capped every future bike ride at thirty grams an hour off one honest answer
 * about a forty-five minute swim.
 *
 * And "nothing" is never evidence of a ceiling. It says the athlete did not
 * eat, not that they cannot: a rider who takes nothing on one ride has proven
 * nothing about their tolerance, and treating it as a proven limit ratchets
 * them down for every session afterwards.
 *
 * Null means no evidence either way, which is NOT zero — the caller starts
 * such an athlete on a sensible default rather than either extreme. */
function provenIntake(fuelLog) {
  const grams = Object.values(fuelLog || {})
    .filter(v => v && typeof v === 'object' && v.discipline === 'bike')
    .map(v => v.level)
    .filter(l => l && l !== 'none' && FUEL_LEVEL_GRAMS[l] != null)
    .map(l => FUEL_LEVEL_GRAMS[l]);
  // the best they have managed: tolerance is a ceiling they have reached, and
  // one bad day does not un-train a gut
  return grams.length ? Math.max(...grams) : null;
}

/* §3: the plan for one session. Null for anything that is not a ride long
   enough to need one, so a caller cannot render a fuelling card on a
   forty-minute spin. */
export function bikeFuellingPlan({ workout, profile, fuelLog, brickFollows }) {
  // A brick is a ride with a run on the end, so it is the session that most
  // needs a fuelling plan and it was the one excluded on discipline.
  const isBrick = workout && workout.discipline === 'brick' && !workout.race;
  if (!workout || (workout.discipline !== 'bike' && !isBrick)) return null;
  const durationMin = workout.durationMin || 0;
  if (durationMin < FUELLING_RULES.noFuelBelowMin) return null;

  const hasQualityBlock = (workout.segments || []).some(s => s.zone && s.zone !== 'Z1' && s.zone !== 'Z2');
  const uncapped = baseCarbs({
    durationMin, hasQualityBlock, brickFollows: !!brickFollows || isBrick,
    raceType: (profile || {}).raceType,
  });
  const proven = provenIntake(fuelLog);
  // One step above proven tolerance, never more — and a sensible starting
  // point rather than a free pass when there is no history at all.
  const ceiling = proven == null
    ? Math.max(FUELLING_RULES.novicePerHour, 0)
    : proven + FUELLING_RULES.gutStepGrams;
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
    /* §3 lists conditions as an input and nothing here reads one: Try has no
       weather, and heat is the single biggest multiplier on fluid need. The
       fluid figure is therefore a temperate-day range and says so, rather
       than being an absolute number that happens to be wrong on a hot day.
       Named for the same reason sodium is: an omission nobody mentions reads
       as a decision somebody made. */
    conditionsNote: 'These are temperate-day figures. Heat, humidity and a hard headwind all push fluid needs up, and the app cannot see any of them, so drink to thirst above this rather than below it.',
    startAfterMin: FUELLING_RULES.startAfterMin,
    hours: Math.round(hours * 10) / 10,
    provenGrams: proven,
    capped,
    why: capped && proven != null
      ? 'Held at one step above the most you have logged taking in on the bike, because absorbing carbohydrate is trained and this is the step that trains it.'
      : proven == null
        ? 'A conservative starting point, because you have not logged what you take in on a ride yet. Once you have, this follows what your stomach has actually proven it can handle.'
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
  /* The top answer reads "race level", and its caption says ninety grams OR
     MORE. So it is an open-ended top of scale, not a point value, and a rider
     who chose it has met any target the scale can express. Treating it as
     exactly ninety told riders who out-fuelled the plan that they came up
     short. */
  const short = level !== 'race' && gap <= -FUELLING_RULES.shortfallGrams;
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
