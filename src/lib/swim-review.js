/* Try — phase 4: the swim review engine.
 *
 * Extends the Long-swim principle (judge the reps, never the blurred
 * average) to every structured swim, and turns the result into one
 * deterministic, testable coaching read:
 *
 *   matchSwimIntervals  — pair the planned set with the recorded WORK laps
 *                         and say how much to trust the pairing (§2)
 *   swimReview          — the SwimReview model: completion, adherence,
 *                         consistency, fade, effort, confidence, outcome,
 *                         and an athlete-facing explanation (§1, §3, §4, §6)
 *   swimReviewEvidence  — rolling multi-session evidence; one swim is never
 *                         allowed to argue for a CSS change on its own (§5)
 *
 * Everything here is a pure function of (workout, activity, laps, paces,
 * feel): no clock, no fetches, no state. A low-confidence match caps how
 * strong a conclusion any rule may draw — cautious in, cautious out.
 */
import { swimPaceLabel, poolLengthM } from './swim-units.js';
import { DEFAULT_POOL } from './domain.js';
import { prescribedSwim } from './css-retest.js';

export const REVIEW_RULES = {
  repDistTol: 0.12,      // a lap within 12% of the planned rep distance pairs with it
  minLapSec: 30,         // sub-30 s slivers are lap-button stubs, not reps
  onTargetPct: 0.03,     // a rep within 3% of its target pace is on target
  offTargetPct: 0.05,    // 5% over is a failed rep
  fadeSoftPct: 2.5,      // final reps this much slower than the body = repeat
  fadeHardPct: 5,        // this much = genuine breakdown
  cvSteady: 0.05,        // pace CV under 5% reads as stable steady swimming
  completionFull: 0.9,   // at least this much of the planned work = completed
  completionPoor: 0.7,   // under this (on a credible match) = reduce
  restTol: 0.5,          // recorded recovery within 50% of planned = compliant
};

// Types whose whole point is not the clock, so pace never leads the read.
const PACE_BLIND_TYPES = { 'Technique': 1, 'Open Water': 1 };

// Planned main reps, in order, with their target pace recovered from the
// stored prescription. swim.pct is round(css/pace*100), so the target comes
// back as css*100/pct — within rounding of what the builder wrote, which is
// tighter than any band that consumes it.
export function plannedSwimReps(workout, paces) {
  const css = paces && paces.swim && paces.swim.css;
  if (!css) return [];
  const reps = [];
  for (const s of workout.segments || []) {
    const sw = s.swim;
    if (sw && sw.repM && sw.n) {
      const target = sw.pct ? css * 100 / sw.pct : css;
      for (let i = 0; i < sw.n; i++) reps.push({ repM: sw.repM, targetSec: target, restSec: sw.restSec || 0 });
    }
  }
  return reps;
}

// The continuous target for block-built sessions (Endurance and friends):
// the weighted steady pace the whole prescription averages to.
function blockTarget(workout, paces) {
  const { distM, sec } = prescribedSwim(workout);
  return distM && sec ? sec / (distM / 100) : null;
}

const lapPace = l => l.movingTimeSec / (l.distance / 100);

/* §2: pair planned reps with recorded WORK laps. Distance, count and order
   are what the recording can actually testify to; recovery and pace targets
   are judged downstream. Returns null only on unusable input. */
export function matchSwimIntervals({ workout, intervals, paces }) {
  if (!workout || !Array.isArray(intervals)) return null;
  const laps = intervals
    .filter(l => l && l.type === 'WORK' && l.movingTimeSec >= REVIEW_RULES.minLapSec && l.distance > 0)
    .sort((a, b) => (a.startTimeSec ?? 0) - (b.startTimeSec ?? 0));
  const planned = plannedSwimReps(workout, paces);
  if (!laps.length) return { laps, planned, pairs: [], confidence: 'low', why: 'no structured laps in the recording' };
  if (!planned.length) {
    // No planned reps means one of three very different things, and only
    // the first may be judged as a continuous swim (review catch
    // 2026-07-27). Session TYPE cannot tell them apart: Race Pace and Long
    // each ship both rep-built and continuous variants. The stored
    // prescription can.
    const segs = workout.segments || [];
    const hasRepMeta = segs.some(s => s.swim && s.swim.repM && s.swim.n);
    const hasSwimMeta = segs.some(s => s.swim);
    const why = hasRepMeta ? 'the target paces for this session are not available'
      : !hasSwimMeta ? 'the planned set for this session could not be read'
        : 'continuous session read as splits';
    // genuinely continuous (metadata present, no reps in it) is the only
    // case a splits read is honest about
    const continuous = hasSwimMeta && !hasRepMeta;
    return {
      laps, planned, pairs: [], splits: true,
      confidence: continuous && laps.length >= 3 ? 'medium' : 'low',
      why,
    };
  }
  // walk both lists in order, pairing each planned rep with the next lap
  // within distance tolerance — order is evidence, so no global rematch
  const pairs = [];
  let li = 0;
  for (const p of planned) {
    while (li < laps.length && Math.abs(laps[li].distance - p.repM) / p.repM > REVIEW_RULES.repDistTol) li++;
    if (li >= laps.length) break;
    pairs.push({ planned: p, lap: laps[li] });
    li++;
  }
  const countExact = laps.length === planned.length;
  const cover = pairs.length / planned.length;
  // Distance agreement is the only currency here: a recording with the
  // right lap COUNT but the wrong distances is a different set (or a wrong
  // pool setting), and count proximity must not buy it a pace judgment.
  const confidence =
    countExact && cover >= 0.8 ? 'high'
      : cover >= 0.6 ? 'medium'
        : 'low';
  const why = countExact ? 'lap count matches the planned set'
    : laps.length + ' laps against ' + planned.length + ' planned reps';
  return { laps, planned, pairs, confidence, why };
}

const mean = xs => xs.reduce((t, x) => t + x, 0) / xs.length;
const pct1 = x => Math.round(x * 10) / 10;

/* §1/§3/§4: the review itself. feel is the athlete's own word for the
   session ('easy' | 'right' | 'hard'); evidence, when provided, is
   swimReviewEvidence over PRIOR sessions — without it this function never
   answers retest-css, because one swim is not a pattern (§5). */
export function swimReview({ workout, activity, intervals, paces, feel, evidence }) {
  if (!workout || workout.discipline !== 'swim' || !activity) return null;
  // A fitness test is a measurement, not a session to be graded: its
  // segments carry no prescription to match against, so a review could only
  // ever say "could not be matched" about the one swim that was never meant
  // to be judged. The auto-CSS flow speaks for it instead (review catch
  // 2026-07-27; perfSignal excludes tests for the same reason).
  if (workout.test) return null;
  const pool = (paces && paces.pool) || DEFAULT_POOL;
  const type = workout.type;
  const m = matchSwimIntervals({ workout, intervals, paces });

  // completion is the recording against the whole prescription, laps or not
  const presc = prescribedSwim(workout);
  const completion = presc.distM && activity.distance
    ? Math.min(1, Math.round(activity.distance / presc.distM * 100) / 100) : null;

  // a recording from a different pool than the setting makes every derived
  // pace suspect (2b's defensive field, honoured here too)
  const poolMismatch = activity.poolLengthM && Math.abs(activity.poolLengthM - poolLengthM(pool)) > 0.5;

  // pace facts, only from what genuinely matched
  let paceAdherence = null, consistency = null, fadePercent = null, failedReps = 0, repsDone = null;
  const judged = m && (m.pairs.length >= 2 || (m.splits && m.laps.length >= 3));
  if (judged && !poolMismatch) {
    const rows = m.splits
      ? m.laps.map(l => ({ actual: lapPace(l), target: blockTarget(workout, paces) }))
      : m.pairs.map(p => ({ actual: lapPace(p.lap), target: p.planned.targetSec }));
    const withTarget = rows.filter(r => r.target);
    if (withTarget.length >= 2) {
      // signed: positive = slower than target
      paceAdherence = pct1(mean(withTarget.map(r => (r.actual - r.target) / r.target)) * 100);
      failedReps = withTarget.filter(r => (r.actual - r.target) / r.target > REVIEW_RULES.offTargetPct).length;
    }
    const paces_ = rows.map(r => r.actual);
    if (paces_.length >= 3) {
      const mu = mean(paces_);
      consistency = pct1(Math.sqrt(mean(paces_.map(p => (p - mu) * (p - mu)))) / mu * 100);
      const tail = Math.max(1, Math.round(paces_.length * 0.25));
      const body = paces_.slice(0, paces_.length - tail), last = paces_.slice(-tail);
      if (body.length) fadePercent = pct1((mean(last) - mean(body)) / mean(body) * 100);
    }
    if (!m.splits) repsDone = m.pairs.length;
  }

  // confidence: the matcher's word, capped down by anything that muddies it
  let confidence = m ? m.confidence : 'low';
  if (poolMismatch) confidence = 'low';
  if (type === 'Open Water') confidence = confidence === 'low' ? 'low' : 'medium';
  if (completion == null) confidence = 'low';

  // §3/§4: the outcome, per session intent, most cautious rule first.
  // Technique and Open Water are never judged primarily by pace.
  const paceBlind = !!PACE_BLIND_TYPES[type];
  const done = completion != null && completion >= REVIEW_RULES.completionFull;
  const softFade = fadePercent != null && fadePercent > REVIEW_RULES.fadeSoftPct;
  const hardFade = fadePercent != null && fadePercent > REVIEW_RULES.fadeHardPct;
  let outcome;
  if (confidence === 'low') outcome = 'insufficient-data';
  else if (completion != null && completion < REVIEW_RULES.completionPoor) outcome = 'reduce';
  else if (!paceBlind && (failedReps >= 2 || hardFade)) outcome = 'reduce';
  // Pace-blind does not mean evidence-blind. Open-water sessions carry
  // time-based skill blocks that prescribedSwim cannot count in metres, so
  // completion alone reads high even when reps were skipped; when a credible
  // pairing exists, the reps are the honest signal (review catch
  // 2026-07-27).
  else if (paceBlind) {
    const shortReps = repsDone != null && m && m.planned.length && repsDone < m.planned.length;
    outcome = done && !shortReps && feel !== 'hard' ? 'progress' : 'repeat';
  }
  else if (evidence && evidence.direction && done && !softFade) outcome = 'retest-css';
  else if (done && !softFade && feel !== 'hard') outcome = 'progress';
  else outcome = 'repeat';

  const review = {
    completion, paceAdherence, consistency, fadePercent,
    perceivedEffort: feel || undefined,
    repsDone, repsPlanned: m && m.planned.length ? m.planned.length : null,
    failedReps: judged ? failedReps : null,
    confidence, outcome, type,
  };
  review.text = reviewText(review, { workout, pool, m });
  return review;
}

/* §6: what went well, where it changed, how sure we are, what happens next. */
const NEXT_WORDS = {
  progress: 'This progression has done its job; the plan moves on.',
  repeat: 'Worth one more pass at this session before it gets bigger.',
  reduce: 'The next version of this session comes down a notch. That is the plan working, not a setback.',
  'retest-css': 'A pattern is building across your recent swims; a CSS retest would settle whether the paces should move.',
  'insufficient-data': 'No coaching call from this one; the plan carries on unchanged.',
};
function reviewText(r, { workout, pool, m }) {
  const bits = [];
  if (r.repsDone != null && r.repsPlanned) {
    bits.push(r.repsDone >= r.repsPlanned
      ? 'You completed all ' + r.repsPlanned + ' planned efforts.'
      : 'You completed ' + r.repsDone + ' of the ' + r.repsPlanned + ' planned efforts.');
  } else if (r.completion != null) {
    bits.push('You covered ' + Math.round(r.completion * 100) + '% of the planned distance.');
  }
  if (PACE_BLIND_TYPES[r.type]) {
    // the outcome rules already ignore pace for these; the copy must too, or
    // it judges an open-water swim by a pool target in the same breath as
    // saying it cannot (review catch 2026-07-27)
    bits.push(r.type === 'Technique'
      ? 'On a technique day the win is showing up and swimming it with intent, not the clock.'
      : 'Open water is judged on getting it done, not on pace against pool targets.');
  } else if (r.paceAdherence != null) {
    if (Math.abs(r.paceAdherence) <= REVIEW_RULES.onTargetPct * 100) bits.push('Pace sat right on target.');
    else if (r.paceAdherence < 0) bits.push('Pace averaged ' + Math.abs(r.paceAdherence) + '% quicker than target.');
    else bits.push('Pace averaged ' + r.paceAdherence + '% slower than target.');
    if (r.fadePercent != null && r.fadePercent > REVIEW_RULES.fadeSoftPct) {
      bits.push('The final efforts slowed by ' + r.fadePercent + '%.');
    }
  }
  if (r.confidence !== 'high') {
    bits.push(r.confidence === 'medium'
      ? 'Read with some care: the recording only partly matches the planned set' + (m && m.why ? ' (' + m.why + ')' : '') + '.'
      : 'Low confidence: this recording could not be matched to the planned set well enough to judge it.');
  }
  bits.push(NEXT_WORDS[r.outcome]);
  return bits.join(' ');
}

/* The review as one verdict line, in the same shape reviewActivity's own
   verdicts use, so every surface (the workout sheet, the recap deck) speaks
   with a single voice instead of pairing a whole-session average verdict
   with a contradicting per-rep read (review catch 2026-07-27). Silent on a
   read too weak to say anything. */
const OUTCOME_WORDS = {
  progress: 'Progress', repeat: 'Repeat this one', reduce: 'Ease the next one',
  'retest-css': 'Retest your CSS', 'insufficient-data': 'No call',
};
export function swimReviewVerdict(review) {
  if (!review || review.outcome === 'insufficient-data') return null;
  return {
    tone: review.outcome === 'progress' ? 'good' : review.outcome === 'reduce' ? 'warn' : 'info',
    text: OUTCOME_WORDS[review.outcome] + ' · ' + review.confidence + ' confidence. ' + review.text,
  };
}

/* §5: rolling evidence. Takes the last few reviews of comparable quality
   sessions (newest first) and answers whether they argue, together, for a
   CSS retest. One swim never does; neither do low-confidence matches,
   interrupted sessions, or mixed directions. */
export const EVIDENCE_RULES = { window: 3, minHighConfidence: 2, directionPct: 3 };
export function swimReviewEvidence(reviews) {
  const QUALITY = { 'CSS Intervals': 1, 'Race Pace': 1, 'Endurance': 1, 'Long': 1 };
  const usable = (reviews || [])
    .filter(r => r && QUALITY[r.type] && r.paceAdherence != null
      && r.confidence !== 'low'
      && r.completion != null && r.completion >= REVIEW_RULES.completionFull)
    .slice(0, EVIDENCE_RULES.window);
  if (usable.length < EVIDENCE_RULES.window) return null;
  if (usable.filter(r => r.confidence === 'high').length < EVIDENCE_RULES.minHighConfidence) return null;
  const over = usable.every(r => r.paceAdherence <= -EVIDENCE_RULES.directionPct);
  const under = usable.every(r => r.paceAdherence >= EVIDENCE_RULES.directionPct);
  // the newest contributing session's date, when the caller supplied dates:
  // it is what makes a dismissed nudge speak again once genuinely new swims
  // argue the same case, instead of staying silent until CSS itself moves
  // (review catch 2026-07-27)
  const latest = usable.map(r => r.date).filter(Boolean).sort().pop() || null;
  if (over) return { direction: 'over', sessions: usable.length, latest };
  if (under) return { direction: 'under', sessions: usable.length, latest };
  return null;
}
