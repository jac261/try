/* Try — interval-level bike review (phase 5 §2, §3, §4, §5, §7).
 *
 * The bike's review has until now been a whole-ride average and a rep table
 * with coloured dots. An average cannot judge an interval session: the
 * recoveries are inside it, so a session ridden exactly right reads soft, and
 * the harder the session the more it lies. This is the bike's version of what
 * the swim gained in its own phase 4, and it is deliberately the same shape,
 * because the arguments are the same ones.
 *
 * WHAT THE SPEC GOT WRONG, AND IT MATTERS. §1 states the client lacks
 * per-ride average power. It does not: averageWatts arrives per ride AND per
 * interval, and review.js, eftp.js and durability.js all already read it.
 * What is genuinely missing is NORMALIZED power and any power stream. So the
 * interval analysis in this file needs no new backend field and ships now;
 * only the load maths in bike-load.js is gated, and that gate is real.
 *
 * PURE. Inputs in, review out (workout, activity, intervals, paces, feel): no
 * clock, no fetches, no state, so the same ride always reviews the same way.
 * A low-confidence match caps what may be concluded, exactly as the swim's
 * does, and a review can always decline to judge.
 */
import { BIKE_ZONES, judgeBandForType } from './bike-zones.js';
import { OUTDOOR_REP_TOLERANCE, REP_TOLERANCE } from './review.js';
import { isIndoor } from './autolog.js';

export const BIKE_REVIEW_RULES = {
  repDurTol: 0.2,        // a lap within 20% of the planned rep length pairs with it
  minLapSec: 60,         // sub-minute slivers are lap-button stubs, not efforts
  fadeSoftPct: 3,        // final effort this much below the body = repeat
  fadeHardPct: 7,        // this much = the session broke down
  cvRepeatable: 8,       // effort-to-effort spread under this % reads as repeatable
  completionFull: 0.9,   // at least this much of the planned work = completed
  completionPoor: 0.7,   // under this (on a credible match) = reduce
  restTol: 0.5,          // recorded recovery within 50% of planned = compliant
  easyCeiling: 0.78,     // an easy ride above this much of threshold was not easy
};

/* The band a single planned effort is judged against.
 *
 * Phase 2's rule, applied one level down: the judge must be at least as
 * permissive as the most permissive card, because a rider who does exactly
 * what their card said must never be told they missed. So a rep whose zone is
 * the one its session type trains is judged on that type's UNION band, and
 * any other rep (a Long ride's tempo surges, say) on the union of every
 * canonical band sharing its zone. Z3 holds both tempo and sweet spot, and
 * unioning them is the lenient direction on purpose. */
const TYPE_ZONE = { Tempo: 'Z3', 'Sweet Spot': 'Z3', Threshold: 'Z4', 'VO2 Intervals': 'Z5', Endurance: 'Z2', Long: 'Z2' };

export function bandForRep(type, zone) {
  const canonical = BIKE_ZONES.filter(z => z.zone === zone);
  // the type's own union band applies only to the zone that type trains: a
  // Long ride's tempo surges are tempo, not "Long", and judging them on a
  // band built for steady endurance would mark every surge hot
  const typed = TYPE_ZONE[type] === zone ? judgeBandForType(type) : null;
  if (!canonical.length) return typed || null;
  let lo = Math.min(...canonical.map(z => z.min));
  let hi = Math.max(...canonical.map(z => z.max));
  if (typed) { lo = Math.min(lo, typed[0]); hi = Math.max(hi, typed[1]); }
  return [lo, hi];
}

/* The planned efforts, in order, recovered from the stored prescription.
 *
 * A bike segment's blocks alternate work and recovery, and the WORK blocks
 * are the ones whose zone is the segment's own: that is how the builder
 * writes them, and reading the structure back beats inferring it from the
 * label, which is prose. The recovery that follows an effort rides along,
 * because §4 asks that recovery be compared too and a rider who cut their
 * recoveries did a different session from the one on the card. */
export function plannedBikeEfforts(workout) {
  if (!workout || workout.discipline !== 'bike') return [];
  const out = [];
  (workout.segments || []).forEach(seg => {
    const blocks = seg.blocks || [];
    if (!blocks.length) return;
    blocks.forEach((b, i) => {
      if (b.zone !== seg.zone) return;              // a recovery block, not an effort
      const next = blocks[i + 1];
      out.push({
        min: b.min,
        zone: b.zone,
        band: bandForRep(workout.type, b.zone),
        restMin: next && next.zone !== seg.zone ? next.min : null,
        label: seg.label || null,
      });
    });
  });
  return out;
}

/* §4: pair planned efforts with recorded ones.
 *
 * Bike efforts are prescribed in MINUTES, so duration is the currency here
 * where the swim uses distance. Both lists are walked in order and never
 * globally rematched: the order an athlete rode their efforts in is
 * evidence, and a matcher free to reorder can always find a flattering
 * pairing. */
export function matchBikeIntervals({ workout, intervals }) {
  if (!workout || workout.discipline !== 'bike' || !Array.isArray(intervals)) return null;
  const laps = intervals
    .filter(l => l && l.type === 'WORK' && l.movingTimeSec >= BIKE_REVIEW_RULES.minLapSec)
    .sort((a, b) => (a.startTimeSec ?? 0) - (b.startTimeSec ?? 0));
  const planned = plannedBikeEfforts(workout);
  // ORDER MATTERS HERE. A steady ride has no efforts to match, so the absence
  // of recorded intervals is not a missing recording, it is the session. The
  // no-laps check used to run first and refused every Endurance and Long ride
  // outright, which killed the one read §5 says those types are FOR: whether
  // the intensity was controlled. Ask what was planned before complaining
  // about what was recorded.
  if (!planned.length) {
    const steady = (workout.segments || []).some(s => s.zone && !s.blocks);
    return {
      laps, planned, pairs: [], splits: true,
      confidence: steady ? 'medium' : 'low',
      why: steady ? 'steady ride, judged on control rather than adherence'
        : 'the planned efforts for this session could not be read',
    };
  }
  if (!laps.length) return { laps, planned, pairs: [], confidence: 'low', why: 'no structured intervals in the recording' };
  const pairs = [];
  let li = 0;
  for (const p of planned) {
    const want = p.min * 60;
    while (li < laps.length && Math.abs(laps[li].movingTimeSec - want) / want > BIKE_REVIEW_RULES.repDurTol) li++;
    if (li >= laps.length) break;
    pairs.push({ planned: p, lap: laps[li] });
    li++;
  }
  const countExact = laps.length === planned.length;
  const cover = pairs.length / planned.length;
  const confidence = countExact && cover >= 0.8 ? 'high' : cover >= 0.6 ? 'medium' : 'low';
  const why = countExact ? 'interval count matches the planned session'
    : laps.length + ' recorded efforts against ' + planned.length + ' planned';
  return { laps, planned, pairs, confidence, why };
}

const mean = xs => xs.reduce((t, x) => t + x, 0) / xs.length;
const pct1 = x => Math.round(x * 10) / 10;

/* §5: what each session type is actually judged on. The list is the order the
   signals are consulted in, so the leading sentence of a review is the thing
   that type exists to train rather than whatever happened to be worst. */
export const TYPE_PRIORITIES = {
  Endurance: ['control', 'variability', 'duration'],
  Tempo: ['timeInTarget', 'consistency', 'completion'],
  'Sweet Spot': ['timeInTarget', 'consistency', 'completion'],
  Threshold: ['completion', 'fade', 'recovery', 'adherence'],
  'VO2 Intervals': ['completion', 'repeatability', 'fade', 'recovery'],
  Long: ['duration', 'durability', 'pacing'],
};

/* §2/§3/§4: the review.
 *
 * §3 is the load-bearing rule and is enforced in one place, at the top: an
 * ESTIMATED FTP may display targets but may never judge execution. Every
 * power-derived field below is behind that gate, so a rider whose threshold
 * was inferred from their level cannot be told they missed a number that was
 * itself a guess about their category. */
export function bikeReview({ workout, activity, intervals, paces, feel }) {
  if (!workout || workout.discipline !== 'bike' || !activity || !activity.movingTimeSec) return null;
  const pc = paces || {};
  const type = workout.type;
  const realFtp = !!(pc.ftp && !pc.ftpEstimated);
  const indoor = isIndoor(activity);
  const m = matchBikeIntervals({ workout, intervals });

  const plannedMin = workout.durationMin || 0;
  const actualMin = activity.movingTimeSec / 60;
  const completion = plannedMin ? Math.min(2, actualMin / plannedMin) : null;

  // §4: outdoors an effort's average carries the road inside it, so the
  // allowance widens on the low side only. Same reasoning, same numbers and
  // the same one-sidedness as the rep table (phase 4 §7).
  const lowTol = indoor ? REP_TOLERANCE : OUTDOOR_REP_TOLERANCE;

  let timeInTarget = null, powerAdherence = null, intervalFadePercent = null, variability = null, recoveryCompliance = null;
  const efforts = [];
  if (realFtp && m && m.pairs.length) {
    let inBandMin = 0, totalMin = 0;
    const devs = [];
    m.pairs.forEach(({ planned, lap }) => {
      if (lap.averageWatts == null || !planned.band) return;
      const frac = lap.averageWatts / pc.ftp;
      const [lo, hi] = planned.band;
      const min = lap.movingTimeSec / 60;
      totalMin += min;
      if (frac >= lo - lowTol && frac <= hi + REP_TOLERANCE) inBandMin += min;
      // signed, as a percentage of the band midpoint: POSITIVE IS HARDER
      // THAN ASKED. Stated here because the swim's equivalent runs the other
      // way (a lower pace is a faster swim) and one convention silently
      // inverting the other is how a nudge ends up arguing the wrong case.
      const mid = (lo + hi) / 2;
      devs.push((frac - mid) / mid * 100);
      efforts.push({ watts: Math.round(lap.averageWatts), frac, min });
    });
    if (totalMin > 0) timeInTarget = pct1(inBandMin / totalMin * 100);
    // §4 asks that RECOVERY be compared too, and a rider who cut their
    // recoveries rode a harder session than the one on the card even if every
    // effort landed in band. The recorded recovery is the gap between one
    // effort ending and the next beginning, so it needs start times; without
    // them this stays null rather than guessing, like every other read here.
    const rests = [];
    m.pairs.forEach(({ planned, lap }, i) => {
      const next = m.pairs[i + 1];
      if (!next || planned.restMin == null || lap.startTimeSec == null || next.lap.startTimeSec == null) return;
      const gapMin = (next.lap.startTimeSec - (lap.startTimeSec + lap.movingTimeSec)) / 60;
      if (gapMin < 0) return;
      rests.push(gapMin >= planned.restMin * BIKE_REVIEW_RULES.restTol ? 1 : 0);
    });
    if (rests.length) recoveryCompliance = pct1(mean(rests) * 100);
    if (devs.length) powerAdherence = pct1(mean(devs));
    if (efforts.length >= 3) {
      // fade: the last effort against the body of the session
      const body = mean(efforts.slice(0, -1).map(e => e.watts));
      const last = efforts[efforts.length - 1].watts;
      intervalFadePercent = pct1((body - last) / body * 100);
      const ws = efforts.map(e => e.watts);
      const mu = mean(ws);
      variability = mu ? pct1(Math.sqrt(mean(ws.map(w => (w - mu) ** 2))) / mu * 100) : null;
    }
  }

  // A steady ride is judged on control, not adherence: was it ridden at the
  // easy intensity it was prescribed at? This is the one power read that
  // works without any interval structure at all.
  let control = null;
  if (realFtp && activity.averageWatts && (type === 'Endurance' || type === 'Long')) {
    control = pct1(activity.averageWatts / pc.ftp * 100);
  }

  // confidence: the matcher's word, capped by anything that muddies it
  let confidence = m ? m.confidence : 'low';
  if (!realFtp) confidence = 'low';                 // §3: nothing to judge against
  if (completion == null) confidence = 'low';
  if (m && m.pairs.length && !efforts.length) confidence = 'low';   // matched, but no power on them
  // and a steady ride can only be judged if its control read actually exists
  if (m && m.splits && control == null) confidence = 'low';

  const outcome = decideOutcome({
    type, confidence, completion, timeInTarget, powerAdherence,
    intervalFadePercent, control, feel, realFtp, variability, recoveryCompliance,
  });

  const review = {
    completion: completion == null ? null : pct1(completion * 100),
    timeInTarget, powerAdherence,
    averagePowerWatts: activity.averageWatts != null ? Math.round(activity.averageWatts) : null,
    // §6 lives in bike-load.js and is gated on a field the backend does not
    // send yet, so these are absent rather than approximated. A normalized
    // power guessed from interval averages would be a different number with
    // the same name, and every downstream figure would inherit the fiction.
    normalizedPowerWatts: null, intensityFactor: null, powerTss: null, variabilityIndex: null,
    intervalFadePercent,
    variability, control, indoor, recoveryCompliance,
    efforts: efforts.length, plannedEfforts: m ? m.planned.length : 0,
    confidence, outcome, type,
    date: activity.date || null,
  };
  review.text = reviewText(review, { workout, m, realFtp });
  return review;
}

/* One signal per priority name in TYPE_PRIORITIES, each returning an outcome
   or null. This is what makes that table load-bearing rather than decorative:
   the type's declared order IS the order the signals are consulted in, so
   changing the table changes the verdict. A priorities list that no code read
   would be a comment wearing a const, and this module has shipped one of
   those before. A test asserts every declared priority has a signal here. */
const OUTCOME_SIGNALS = {
  completion: s => (s.completion != null && s.completion < BIKE_REVIEW_RULES.completionFull ? 'repeat' : null),
  duration: s => (s.completion != null && s.completion < BIKE_REVIEW_RULES.completionFull ? 'repeat' : null),
  // riding an easy session hard: the most common way an athlete arrives at a
  // quality day already tired
  control: s => (s.control != null && s.control > BIKE_REVIEW_RULES.easyCeiling * 100 ? 'repeat' : null),
  pacing: s => (s.control != null && s.control > BIKE_REVIEW_RULES.easyCeiling * 100 ? 'repeat' : null),
  fade: s => (s.intervalFadePercent != null && s.intervalFadePercent >= BIKE_REVIEW_RULES.fadeSoftPct ? 'repeat' : null),
  durability: s => (s.intervalFadePercent != null && s.intervalFadePercent >= BIKE_REVIEW_RULES.fadeSoftPct ? 'repeat' : null),
  timeInTarget: s => (s.timeInTarget != null && s.timeInTarget < 60 ? 'repeat' : null),
  repeatability: s => (s.variability != null && s.variability > BIKE_REVIEW_RULES.cvRepeatable ? 'repeat' : null),
  consistency: s => (s.variability != null && s.variability > BIKE_REVIEW_RULES.cvRepeatable ? 'repeat' : null),
  variability: s => (s.variability != null && s.variability > BIKE_REVIEW_RULES.cvRepeatable ? 'repeat' : null),
  // cutting the recoveries makes a different, harder session out of the same
  // card, so it is worth repeating as written rather than progressing from
  recovery: s => (s.recoveryCompliance != null && s.recoveryCompliance < 50 ? 'repeat' : null),
  adherence: s => (s.confidence === 'high' && s.powerAdherence != null && s.powerAdherence >= 6
    && (s.completion == null || s.completion >= BIKE_REVIEW_RULES.completionFull) ? 'retest-ftp' : null),
};

function decideOutcome(s) {
  if (s.confidence === 'low') return 'insufficient-data';
  const R = BIKE_REVIEW_RULES;
  // Floors that outrank whatever the type prioritises: a session mostly not
  // done, or one that broke down, is the same answer for every type.
  if (s.completion != null && s.completion < R.completionPoor) return 'reduce';
  if (s.intervalFadePercent != null && s.intervalFadePercent >= R.fadeHardPct) return 'reduce';
  for (const name of (TYPE_PRIORITIES[s.type] || ['completion'])) {
    const signal = OUTCOME_SIGNALS[name];
    const out = signal && signal(s);
    if (out) return out;
  }
  // Comfortably above the band across a whole session, on a credible match,
  // is the one pattern that argues the THRESHOLD is wrong rather than the
  // rider. It never acts on its own: §7's rolling evidence decides that, and
  // this only ever names the possibility.
  const adh = OUTCOME_SIGNALS.adherence(s);
  if (adh) return adh;
  if (s.completion != null && s.completion >= R.completionFull) return 'progress';
  return 'repeat';
}
export { OUTCOME_SIGNALS };

const OUTCOME_WORDS = {
  progress: 'Session complete', repeat: 'Worth repeating', reduce: 'Back off a little',
  'retest-ftp': 'Your threshold may have moved', 'insufficient-data': 'Not enough to judge',
};

function reviewText(r, { workout, m, realFtp }) {
  const bits = [];
  if (!realFtp) {
    bits.push('Your FTP is estimated from your level rather than measured, so this ride is recorded but not judged on power. A ramp test would change that.');
    return bits.join(' ');
  }
  if (r.outcome === 'insufficient-data') {
    bits.push('This recording could not be matched to the planned session well enough to judge it' + (m && m.why ? ' (' + m.why + ')' : '') + '.');
    return bits.join(' ');
  }
  const priorities = TYPE_PRIORITIES[r.type] || ['completion'];
  if (priorities[0] === 'control' || priorities[0] === 'duration') {
    if (r.control != null) {
      bits.push(r.control > BIKE_REVIEW_RULES.easyCeiling * 100
        ? 'You rode this one harder than it asked for, which is the usual reason a quality day later in the week feels flat.'
        : 'Intensity was well controlled for the length of the ride.');
    }
    if (r.completion != null) bits.push('You completed ' + Math.round(r.completion) + '% of the planned time.');
  } else {
    if (r.timeInTarget != null) bits.push(r.timeInTarget + '% of your effort time was in the target range.');
    if (r.efforts) bits.push('Judged across ' + r.efforts + ' of ' + r.plannedEfforts + ' planned efforts.');
    if (r.recoveryCompliance != null && r.recoveryCompliance < 100) {
      bits.push('You took the full recovery on ' + Math.round(r.recoveryCompliance) + '% of the gaps, and cutting them makes a harder session than the one on the card.');
    }
    if (r.intervalFadePercent != null && r.intervalFadePercent >= BIKE_REVIEW_RULES.fadeSoftPct) {
      bits.push('Your last effort came in ' + r.intervalFadePercent + '% below the rest, so the session was at the edge of what you could repeat.');
    }
  }
  if (r.indoor === false && r.timeInTarget != null && r.timeInTarget < 100) {
    bits.push('Judged with the outdoor allowance, since junctions and descents sit inside a recorded average.');
  }
  if (r.confidence !== 'high') {
    bits.push(r.confidence === 'medium'
      ? 'Medium confidence: some of the planned session could not be matched to the recording.'
      : 'Low confidence.');
  }
  return bits.join(' ');
}

export function bikeReviewVerdict(review) {
  if (!review || review.outcome === 'insufficient-data') return null;
  return {
    tone: review.outcome === 'progress' ? 'good' : review.outcome === 'reduce' ? 'warn' : 'info',
    text: OUTCOME_WORDS[review.outcome] + ' · ' + review.confidence + ' confidence. ' + review.text,
  };
}

/* §7: rolling adaptation. ONE RIDE NEVER MOVES ANYTHING.
 *
 * This returns a direction only when several comparable, well-matched,
 * completed sessions all argue the same way. It is the same rule the swim
 * uses and the same rule phase 2's FTP retest uses, written once more here
 * because §7 asks for it explicitly and because the failure it prevents is
 * the expensive one: an athlete having their threshold moved by a single
 * good day on fresh legs, and then failing every session for a block. */
export const BIKE_EVIDENCE_RULES = { window: 3, minHighConfidence: 2, directionPct: 4 };
export function bikeReviewEvidence(reviews) {
  const JUDGED = { Threshold: 1, 'Sweet Spot': 1, 'VO2 Intervals': 1, Tempo: 1 };
  const usable = (reviews || [])
    .filter(r => r && JUDGED[r.type] && r.powerAdherence != null
      && r.confidence !== 'low'
      && r.completion != null && r.completion >= BIKE_REVIEW_RULES.completionFull * 100)
    .slice(0, BIKE_EVIDENCE_RULES.window);
  if (usable.length < BIKE_EVIDENCE_RULES.window) return null;
  if (usable.filter(r => r.confidence === 'high').length < BIKE_EVIDENCE_RULES.minHighConfidence) return null;
  const over = usable.every(r => r.powerAdherence >= BIKE_EVIDENCE_RULES.directionPct);
  const under = usable.every(r => r.powerAdherence <= -BIKE_EVIDENCE_RULES.directionPct);
  const latest = usable.map(r => r.date).filter(Boolean).sort().pop() || null;
  if (over) return { direction: 'over', sessions: usable.length, latest };
  if (under) return { direction: 'under', sessions: usable.length, latest };
  return null;
}
