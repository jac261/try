/* Try — reviewing a completed run. (run phase 8 §1, §2, §4)
 *
 * The shipped review already judged a run: steady sessions against a band,
 * reps against a pace tolerance, and hills not at all. What it could not do
 * is say HOW SURE it was, or what the session should change, or refuse to act
 * on a single reading. This adds those three things and nothing else — the
 * per-rep judging still belongs to review.js, and this reads its output
 * rather than re-deriving it, so there is one grader.
 *
 * EVERY VERDICT EXPOSES CONFIDENCE (§6). A run on a hill, a run by an athlete
 * whose 5 km is a level-table guess, and a run recorded without laps are all
 * judgeable to different degrees, and flattening that into one verdict is how
 * an athlete gets told to reduce their training on the strength of a GPS
 * glitch. Confidence is a field, not a footnote.
 *
 * ONE RUN CANNOT RETARGET A PLAN (§4, §6). runReview returns an outcome for
 * ONE session. Acting on it needs runReviewEvidence, which requires several
 * comparable sessions agreeing in the same direction, mirroring the swim's
 * rule exactly. That is deliberate duplication of a shape, not of logic: the
 * thresholds are the swim's because they were argued once and should not be
 * re-argued per discipline.
 */

import { isEffortPrescribed, RUN_PACE_TYPES } from './runschema.js';
import { runAnchor } from './domain.js';

export const RUN_REVIEW_RULES = {
  completionFull: 0.9,      // ran essentially all of it
  completionPartial: 0.6,   // did enough to say something about
  fadeConcern: 6,           // per cent slower late vs early reps
  adherenceTight: 3,        // per cent off target that still counts as on
  adherenceLoose: 8,        // beyond this the session was not the session
};

// §2's priorities, per type, in the order they matter. Held as data so the
// copy and any future surface read one table rather than each inventing an
// opinion about what a Tempo run is for.
export const RUN_REVIEW_PRIORITIES = {
  Easy: ['effort-control', 'completion', 'low-intensity'],
  Fartlek: ['change-of-pace', 'completion', 'effort-control'],
  Tempo: ['sustained-pace', 'controlled-effort', 'late-stability'],
  Threshold: ['rep-completion', 'pace-adherence', 'hill-effort'],
  'VO2 Intervals': ['quality-time', 'repeatability', 'recovery', 'terrain-aware'],
  'Race Pace': ['pace-adherence', 'repeatability', 'late-stability'],
  Long: ['duration', 'late-stability', 'fuelling', 'race-pace-execution', 'interruptions'],
};

export const RUN_OUTCOMES = ['progress', 'repeat', 'reduce', 'retest-5k', 'insufficient-data'];

// Outcome words for the sheet, one register with the swim's and bike's.
const OUTCOME_WORDS = {
  progress: 'Move on',
  repeat: 'Repeat this one',
  reduce: 'Ease back',
  'retest-5k': 'Time to retest your 5 km',
};

/* A runReview as the single closing verdict for the sheet, mirroring
   swimReviewVerdict: reviewActivity renders it as the last word so a
   whole-session average never contradicts the per-rep read beside it. */
export function runReviewVerdict(review) {
  if (!review || review.outcome === 'insufficient-data') return null;
  const bits = [];
  if (review.terrainAdjusted) bits.push('Hills, so judged by completion and effort rather than pace.');
  else if (review.paceAdherence != null && review.paceAdherence > 0) bits.push(Math.round(review.paceAdherence) + '% of reps landed off target.');
  if (review.intervalFadePercent != null && review.intervalFadePercent > RUN_REVIEW_RULES.fadeConcern) {
    bits.push('The late reps faded ' + review.intervalFadePercent + '% against the early ones.');
  }
  if (review.completion != null && review.completion < RUN_REVIEW_RULES.completionFull) {
    bits.push('About ' + Math.round(review.completion * 100) + '% of the session happened.');
  }
  return {
    tone: review.outcome === 'progress' ? 'good' : review.outcome === 'reduce' ? 'warn' : 'info',
    text: OUTCOME_WORDS[review.outcome] + ' · ' + review.confidence + ' confidence.' + (bits.length ? ' ' + bits.join(' ') : ''),
  };
}

/* Late-vs-early fade across the graded reps: the number §1 calls
   intervalFadePercent. Positive means the later reps were slower. Needs at
   least four reps to split, because "first half vs second half" of a
   two-rep session is one rep against one rep. */
export function repFade(rows) {
  const paced = (rows || []).filter(r => r && r.paceSec > 0);
  if (paced.length < 4) return null;
  const half = Math.floor(paced.length / 2);
  const mean = xs => xs.reduce((t, r) => t + r.paceSec, 0) / xs.length;
  const early = mean(paced.slice(0, half));
  const late = mean(paced.slice(-half));
  return Math.round((late - early) / early * 1000) / 10;
}

/* Review one completed run.
 *
 * `rows` is intervalRows(...) output — the SAME grading the card's own
 * splits table shows. Deriving a second opinion here is how a review ends up
 * disagreeing with the table printed directly above it.
 */
export function runReview({ workout, activity, rows, profile, feel }) {
  // bRace too: runschema's isTrainingRun already rules that races are not
  // built by buildRun and must not be judged as if they were — a tune-up
  // was getting "Repeat this one · 73% of the session happened" for a
  // finished 5k race (gauntlet catch 2026-07-30).
  if (!workout || workout.discipline !== 'run' || workout.race || workout.bRace) return null;
  const planned = workout.durationMin || 0;
  const actualMin = activity && activity.movingTimeSec ? activity.movingTimeSec / 60 : null;
  const completion = planned && actualMin != null
    ? Math.round(Math.min(actualMin / planned, 2) * 100) / 100 : null;

  const segs = workout.segments || [];
  const terrainAdjusted = segs.some(isEffortPrescribed);
  const gradable = RUN_PACE_TYPES.includes(workout.type) && !terrainAdjusted;
  const judged = rows && rows.judged ? rows.judged : 0;
  const onTarget = rows && rows.rows ? rows.rows.filter(r => r.tone === 'good').length : 0;
  const paceAdherence = gradable && judged
    ? Math.round((1 - onTarget / judged) * 1000) / 10 : null;
  const fade = gradable ? repFade(rows && rows.rows) : null;

  /* CONFIDENCE. Each downgrade names a real reason the reading is weaker,
     and they compose: an estimated anchor on a hill session recorded without
     laps is not 'medium' because only one rule fired. */
  let confidence = 'high';
  if (completion == null) confidence = 'low';
  else if (terrainAdjusted) confidence = 'low';        // no flat-pace truth to compare
  else if (!gradable) confidence = 'medium';           // steady or by-feel session
  else if (!judged) confidence = 'low';                // nothing to judge against
  else if (runAnchor(profile).kind !== 'real') confidence = 'medium';
  if (confidence !== 'low' && completion != null && completion < RUN_REVIEW_RULES.completionPartial) {
    confidence = 'low';                                 // too little of it happened
  }

  return {
    // Named so a run review can never be mistaken for a swim or bike one.
    // The bike arc shipped a swim CSS retest card under a bike heading
    // because two modules returned structurally identical objects.
    discipline: 'run',
    type: workout.type,
    date: (activity && activity.date) || workout.date || null,
    priorities: RUN_REVIEW_PRIORITIES[workout.type] || [],
    completion,
    paceAdherence,
    intervalFadePercent: fade,
    perceivedEffort: feel && feel.rpe != null ? feel.rpe : null,
    terrainAdjusted,
    confidence,
    outcome: runOutcome({ completion, paceAdherence, fade, confidence }),
  };
}

/* The outcome for ONE session. Never applied on its own — see
   runReviewEvidence. 'retest-5k' is deliberately NOT reachable from a single
   review: a benchmark change is the most consequential thing a review can
   propose, and it needs a pattern. */
export function runOutcome({ completion, paceAdherence, fade, confidence }) {
  if (confidence === 'low' || completion == null) return 'insufficient-data';
  if (completion < RUN_REVIEW_RULES.completionPartial) return 'reduce';
  if (completion < RUN_REVIEW_RULES.completionFull) return 'repeat';
  if (paceAdherence != null && paceAdherence > RUN_REVIEW_RULES.adherenceLoose) return 'repeat';
  if (fade != null && fade > RUN_REVIEW_RULES.fadeConcern) return 'repeat';
  return 'progress';
}

/* §4: several comparable sessions, agreeing, before anything changes.
   Thresholds mirror the swim's EVIDENCE_RULES because the question is the
   same one and it was settled there. */
export const RUN_EVIDENCE_RULES = { window: 3, minHighConfidence: 2, directionPct: 3 };

export function runReviewEvidence(reviews) {
  const usable = (reviews || [])
    .filter(r => r && r.discipline === 'run' && RUN_PACE_TYPES.includes(r.type)
      && r.paceAdherence != null
      && r.confidence !== 'low'
      && !r.terrainAdjusted                    // hills carry no flat-pace truth
      && r.completion != null && r.completion >= RUN_REVIEW_RULES.completionFull)
    .slice(0, RUN_EVIDENCE_RULES.window);
  if (usable.length < RUN_EVIDENCE_RULES.window) return null;
  if (usable.filter(r => r.confidence === 'high').length < RUN_EVIDENCE_RULES.minHighConfidence) return null;
  /* paceAdherence is the share of reps that landed OFF target, so low is
     good. The threshold for "struggling" comes from RUN_REVIEW_RULES, not
     from RUN_EVIDENCE_RULES — an earlier line here read
     RUN_EVIDENCE_RULES.adherenceLoose, which does not exist, so the
     comparison was against undefined and the struggling arm could never
     fire. A guard that cannot fire is a comment with a number in it. */
  const easy = usable.every(r => r.paceAdherence <= RUN_EVIDENCE_RULES.directionPct);
  const hard = usable.every(r => r.paceAdherence >= RUN_REVIEW_RULES.adherenceLoose);
  const latest = usable.map(r => r.date).filter(Boolean).sort().pop() || null;
  if (easy) return { direction: 'comfortable', sessions: usable.length, latest, outcome: 'retest-5k' };
  if (hard) return { direction: 'struggling', sessions: usable.length, latest, outcome: 'reduce' };
  return null;
}
