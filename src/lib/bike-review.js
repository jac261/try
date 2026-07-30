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
import { bikeLoad } from './bike-load.js';

/* §4's pauses-and-coasting read, live since elapsedTimeSec arrived
 * (2026-07-30). EXPLANATION ONLY this phase: the verdict thresholds and the
 * outdoor rep tolerance are unchanged — the handoff promised activation
 * would not move judgments, so the stopped time is measured, stored on the
 * review, and spoken where it explains a lenient read, and that is all.
 * Distinguishing per-rep coasting still needs a power stream.
 *
 * Null means UNKNOWN (a backend that predates the field), never zero:
 * missing elapsed time is not an uninterrupted ride. */
export const INTERRUPTION_RULES = {
  // below this the stopped time is junctions, and every outdoor ride has
  // junctions — saying it aloud would be noise on every review
  minSpokenSec: 120,
};
export function rideInterruption(activity) {
  if (!activity || activity.movingTimeSec == null || activity.elapsedTimeSec == null) return null;
  const stoppedSec = Math.round(activity.elapsedTimeSec - activity.movingTimeSec);
  if (!(stoppedSec >= 0)) return null;      // a provider glitch is not a measurement
  return {
    stoppedSec,
    stoppedFrac: activity.elapsedTimeSec > 0
      ? Math.round(stoppedSec / activity.elapsedTimeSec * 1000) / 1000 : null,
  };
}

export const BIKE_REVIEW_RULES = {
  repDurTol: 0.2,        // a lap within 20% of the planned rep length pairs with it
  minLapSec: 60,         // the stub floor for a session with no short efforts
  minLapAbsSec: 12,      // below this it is a lap-button slip whatever was planned
  fadeSoftPct: 3,        // final effort this much below the body = repeat
  fadeHardPct: 7,        // this much = the session broke down
  cvRepeatable: 8,       // effort-to-effort spread under this % reads as repeatable
  completionFull: 0.9,   // at least this much of the planned work = completed
  completionPoor: 0.7,   // under this (on a credible match) = reduce
  restTol: 0.5,          // recorded recovery within 50% of planned = compliant
  /* The most permissive endurance card prescribes a low-cadence block up to
     0.80 of threshold, so a ceiling of 0.78 marked riders down for executing
     that card exactly — the judge must be at least as permissive as the most
     permissive card, which is the phase 2 rule. 0.80 plus the standard rep
     tolerance. */
  easyCeiling: 0.83,
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
  const planned = plannedBikeEfforts(workout);
  /* The floor for "this is a lap-button stub rather than an effort" has to
     come from the session, not from a constant. A flat sixty seconds threw
     away every lap of a 30/30 VO2 card — the shape the builder actually
     prescribes — so a flawless recording of 36 efforts matched zero of them
     and the athlete was told there were "no structured intervals in the
     recording". The planned side had no minimum and the recorded side had
     one: that mismatch was the bug. */
  const shortest = planned.length ? Math.min(...planned.map(p => p.min * 60)) : BIKE_REVIEW_RULES.minLapSec;
  const floor = Math.max(BIKE_REVIEW_RULES.minLapAbsSec, Math.min(BIKE_REVIEW_RULES.minLapSec, shortest * 0.5));
  const laps = intervals
    .filter(l => l && l.type === 'WORK' && l.movingTimeSec >= floor)
    .sort((a, b) => (a.startTimeSec ?? 0) - (b.startTimeSec ?? 0));
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
  // timeInTarget belongs here: §5 names power adherence as a Threshold
  // priority, and what shipped under that name judged over-riding ONLY. A
  // session ridden entirely BELOW its band was invisible to the outcome, so
  // the athlete read "Session complete" directly above "0% of your effort
  // time was in the target range".
  Threshold: ['workCompletion', 'completion', 'timeInTarget', 'fade', 'recovery', 'adherence'],
  'VO2 Intervals': ['workCompletion', 'completion', 'timeInTarget', 'repeatability', 'fade', 'recovery'],
  // timeInTarget belongs to Long too: a Long ride's tempo surges are a
  // prescription like any other, and without this the surges could be ridden
  // far too hard while the copy said "intensity was well controlled" — true
  // of the whole ride's average and false of the only structured part of it.
  Long: ['duration', 'timeInTarget', 'durability', 'pacing'],
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
  /* indoor / outdoor / unknown, and unknown is a real third answer. isIndoor
     returns false for an activity with no recognised type, which silently
     became "outdoors" — so a ride with no environment evidence was given the
     outdoor allowance AND told it had been, which is an assertion about
     something the module cannot see. The allowance still applies (it errs
     towards not accusing), but nothing claims to know where it happened. */
  const environment = isIndoor(activity) ? 'indoor' : (activity.type ? 'outdoor' : 'unknown');
  const interruption = rideInterruption(activity);
  const indoor = environment === 'indoor';
  const m = matchBikeIntervals({ workout, intervals });

  const plannedMin = workout.durationMin || 0;
  const actualMin = activity.movingTimeSec / 60;
  const completion = plannedMin ? Math.min(2, actualMin / plannedMin) : null;

  // §4: outdoors an effort's average carries the road inside it, so the
  // allowance widens on the low side only. Same reasoning, same numbers and
  // the same one-sidedness as the rep table (phase 4 §7).
  const lowTol = indoor ? REP_TOLERANCE : OUTDOOR_REP_TOLERANCE;

  let timeInTarget = null, powerAdherence = null, intervalFadePercent = null, variability = null,
    recoveryCompliance = null, workCompletion = null;
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
      /* HOW FAR OUTSIDE THE PRESCRIPTION, and zero anywhere inside it.
       *
       * This used to be deviation from the band's MIDPOINT, which was wrong
       * in a way that only showed up end to end. The band here is
       * deliberately a UNION, wider than any single card, so that a rider who
       * does exactly what their card says is never marked off target. Its
       * midpoint therefore is not the card's midpoint, and measuring against
       * it made riding the printed card score as harder than asked: a Sweet
       * Spot session ridden at the exact middle of its card came out at
       * +5.1%, three of them tripped the rolling FTP evidence, and riding the
       * top watt printed on a Threshold card returned "your threshold may
       * have moved" next to "100% of your effort time was in the target
       * range".
       *
       * Adherence means distance from what was ASKED, and everywhere inside
       * the prescription is asked. So: zero in band, and outside it the gap
       * to the nearer edge. POSITIVE IS HARDER THAN ASKED (the swim's
       * equivalent runs the other way, a lower pace being a faster swim, and
       * one convention silently inverting the other is how a nudge ends up
       * arguing the wrong case). */
      devs.push(frac > hi ? (frac - hi) / hi * 100 : frac < lo ? (frac - lo) / lo * 100 : 0);
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
    // §4 asks that planned DURATION be compared. repDurTol was only ever a
    // pairing filter, so efforts cut short by anything inside that window
    // reviewed identically to full ones: a Threshold session whose 8 minute
    // efforts were all ridden as 6:34 read exactly like the complete session,
    // because whole-ride completion cannot see work traded for recovery.
    const plannedWork = m.pairs.reduce((t, x) => t + x.planned.min, 0);
    const ridden = m.pairs.reduce((t, x) => t + x.lap.movingTimeSec / 60, 0);
    if (plannedWork > 0) workCompletion = pct1(ridden / plannedWork * 100);
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
  if (realFtp && activity.averageWatts) control = pct1(activity.averageWatts / pc.ftp * 100);

  // confidence: the matcher's word, capped by anything that muddies it
  let confidence = m ? m.confidence : 'low';
  if (!realFtp) confidence = 'low';                 // §3: nothing to judge against
  if (completion == null) confidence = 'low';
  let decline = null;
  if (m && m.pairs.length && !efforts.length) { confidence = 'low'; decline = 'the recorded efforts carry no power data'; }
  if (m && m.splits && control == null) { confidence = 'low'; decline = 'this ride has no power recorded to read intensity from'; }
  // A steady ride matched nothing because there was nothing to match, which
  // is a successful read and not a partial one. It used to be capped at
  // medium forever and then told "some of the planned session could not be
  // matched" — for a session ridden exactly as prescribed.
  /* ...but only for the types whose WHOLE ride is the one zone. A continuous
     quality card has a warm-up and a cool-down inside that average, so the
     whole-ride number cannot say whether the block itself was ridden right,
     and calling that high confidence would be claiming a read we do not
     have. Those keep medium and say what they could not check. */
  if (m && m.splits && control != null && completion != null
    && completion >= BIKE_REVIEW_RULES.completionFull
    && (type === 'Endurance' || type === 'Long')) confidence = 'high';

  /* §6: IF/TSS/VI, now live — normalizedWatts arrives since 2026-07-30.
     Gated on realFtp, NOT on a reconstructed profile: paces carries no
     ftpMeta and pc.ftp may be a level-table estimate, and bikePowerAnchor
     treats any truthy ftp as real — so passing pc.ftp through unconditionally
     computed intensity factors from a guess (live defect, phase 1 audit).
     An estimated threshold makes every derived number an estimate wearing a
     measured name; realFtp is the same distinction the rest of this
     function already judges with. */
  const load = bikeLoad({ activity, profile: realFtp ? { ftp: pc.ftp } : {} });
  const outcome = decideOutcome({
    type, confidence, completion, timeInTarget, powerAdherence,
    intervalFadePercent, control, feel, realFtp, variability, recoveryCompliance, workCompletion,
  });

  const review = {
    completion: completion == null ? null : pct1(completion * 100),
    timeInTarget, powerAdherence,
    averagePowerWatts: activity.averageWatts != null ? Math.round(activity.averageWatts) : null,
    /* §6, DELEGATED rather than hardcoded to null. These were four literal
       nulls with a comment explaining the gate, which meant bike-load.js had
       no caller at all and the day the backend field landed nothing in the
       app would have changed. Now the gate is bikeLoad's to close, and it
       closes itself. */
    normalizedPowerWatts: load ? load.normalizedPowerWatts : null,
    intensityFactor: load ? load.intensityFactor : null,
    powerTss: load ? load.powerTss : null,
    variabilityIndex: load ? load.variabilityIndex : null,
    intervalFadePercent,
    stoppedSec: interruption ? interruption.stoppedSec : null,
    variability, control, indoor, environment, recoveryCompliance, workCompletion,
    efforts: efforts.length, plannedEfforts: m ? m.planned.length : 0,
    confidence, outcome, type, decline,
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
  // Now that adherence is zero anywhere inside the prescription, a positive
  // reading means genuinely above the most permissive card the athlete could
  // have been given, which is the only reading that argues the THRESHOLD is
  // wrong rather than the rider.
  adherence: s => (s.confidence === 'high' && s.powerAdherence != null && s.powerAdherence >= 6
    && (s.completion == null || s.completion >= BIKE_REVIEW_RULES.completionFull) ? 'retest-ftp' : null),
  // efforts cut short: the work was not done even though the ride was
  workCompletion: s => (s.workCompletion != null && s.workCompletion < 90 ? 'repeat' : null),
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
  /* NO FALLBACK ADHERENCE CHECK. There used to be one here, consulted for
     every type regardless of whether that type declared it, and it made a
     Long ride claim a threshold retest on the strength of two tempo surges
     inside a hundred minutes of endurance riding — while the text beside the
     headline praised the ride, because the Long copy branch never mentions
     adherence. A signal that only some types declare must only be consulted
     for those types, or the table is not the decision after all. */
  if (s.completion != null && s.completion >= R.completionFull) return 'progress';
  return 'repeat';
}
export { OUTCOME_SIGNALS };

const OUTCOME_WORDS = {
  progress: 'Session complete', repeat: 'Worth repeating', reduce: 'Back off a little',
  'retest-ftp': 'Your threshold may have moved', 'insufficient-data': 'Not enough to judge',
};

/* One sentence per priority the type declares, in the order it declares
   them, and only when that priority has something to say.
 *
 * The previous version read priorities[0] and compared it against two
 * values, so the copy had exactly two shapes: Endurance/Long, and everything
 * else. Threshold and Sweet Spot emitted identical sentences for identical
 * data despite prioritising different things, and nine of the twelve
 * declared priority names were never read anywhere. The outcome was made
 * table-driven and the copy was not, which is half a fix. */
const PRIORITY_SENTENCE = {
  completion: r => (r.completion == null ? null
    : 'You completed ' + Math.round(r.completion) + '% of the planned time.'),
  duration: r => (r.completion == null ? null
    : 'You completed ' + Math.round(r.completion) + '% of the planned time.'),
  workCompletion: r => (r.workCompletion == null || r.workCompletion >= 98 ? null
    : 'Your efforts came to ' + Math.round(r.workCompletion) + '% of the work the session asked for, so some of it was traded for recovery.'),
  timeInTarget: r => (r.timeInTarget == null ? null
    : r.timeInTarget + '% of your effort time was in the target range.'),
  control: r => {
    if (r.control == null) return null;
    if (r.control > BIKE_REVIEW_RULES.easyCeiling * 100) {
      return 'You rode this one harder than it asked for, which is the usual reason a quality day later in the week feels flat.';
    }
    // Praise for the whole-ride average is TRUE and misleading when the
    // structured part of the ride missed: a Long ride whose surges went 27%
    // over read "0% of your effort time was in the target range. Intensity
    // was well controlled." Both facts, one sentence apart, arguing.
    if (r.timeInTarget != null && r.timeInTarget < 100) return null;
    return 'Intensity was well controlled for the length of the ride.';
  },
  pacing: r => PRIORITY_SENTENCE.control(r),
  fade: r => (r.intervalFadePercent == null || r.intervalFadePercent < BIKE_REVIEW_RULES.fadeSoftPct ? null
    : 'Your last effort came in ' + r.intervalFadePercent + '% below the rest, so the session was at the edge of what you could repeat.'),
  durability: r => PRIORITY_SENTENCE.fade(r),
  repeatability: r => (r.variability == null ? null
    : r.variability > BIKE_REVIEW_RULES.cvRepeatable
      ? 'Your efforts varied by ' + r.variability + '% between the strongest and the rest, so they were not yet repeatable at this level.'
      : 'Your efforts were consistent from first to last.'),
  consistency: r => PRIORITY_SENTENCE.repeatability(r),
  variability: r => PRIORITY_SENTENCE.repeatability(r),
  recovery: r => (r.recoveryCompliance == null || r.recoveryCompliance >= 100 ? null
    : 'You took the full recovery on ' + Math.round(r.recoveryCompliance) + '% of the gaps, and cutting them makes a harder session than the one on the card.'),
  adherence: r => (r.powerAdherence == null || r.powerAdherence === 0 ? null
    : r.powerAdherence > 0
      ? 'Across the session your efforts sat about ' + r.powerAdherence + '% above the top of what was asked.'
      : 'Across the session your efforts sat about ' + Math.abs(r.powerAdherence) + '% below what was asked.'),
};

function reviewText(r, { m, realFtp }) {
  if (!realFtp) {
    return 'Your FTP is estimated from your level rather than measured, so this ride is recorded but not judged on power. A twenty-minute test would change that.';
  }
  const bits = [];
  if (r.outcome === 'insufficient-data') {
    // The reason the REVIEW declined, which is not the same thing as the
    // matcher's verdict. Printing m.why here produced sentences that argued
    // with themselves: "could not be matched ... (interval count matches the
    // planned session)".
    const why = r.decline || (m && m.pairs.length === 0 && m.planned.length ? m.why : null);
    bits.push('This ride was recorded but could not be judged' + (why ? ', because ' + why : '') + '.');
    return bits.join(' ');
  }
  (TYPE_PRIORITIES[r.type] || ['completion']).forEach(name => {
    const say = PRIORITY_SENTENCE[name];
    const line = say && say(r);
    if (line && !bits.includes(line)) bits.push(line);
  });
  if (r.efforts) bits.push('Judged across ' + r.efforts + ' of ' + r.plannedEfforts + ' planned efforts.');
  // §7 phrasing: only claim the outdoor allowance where we KNOW it was
  // outdoors. An unknown environment gets the allowance and no claim.
  if (r.environment === 'outdoor' && r.timeInTarget != null && r.timeInTarget < 100) {
    bits.push(r.stoppedSec != null && r.stoppedSec >= INTERRUPTION_RULES.minSpokenSec
      ? 'You were stopped for about ' + Math.round(r.stoppedSec / 60)
        + ' minutes of this ride; those pauses sit inside the recorded averages, so shortfalls are read leniently.'
      : 'Judged with the outdoor allowance, since junctions and descents sit inside a recorded average.');
  }
  if (r.confidence === 'medium') {
    bits.push(m && m.splits
      ? 'Medium confidence: this ride has no interval structure to check the intensity against.'
      : 'Medium confidence: some of the planned session could not be matched to the recording.');
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
