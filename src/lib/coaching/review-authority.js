/* Try — shared coaching layer: one voice per session (phase 2 §6).
 *
 * For each completed session, exactly one review source is authoritative:
 *
 *   structured     a per-rep discipline review that could actually judge
 *                  (outcome !== 'insufficient-data')
 *   whole-session  the average-based summary, when no structured read exists
 *   none           nothing can speak (no matched recording)
 *
 * This encodes the suppression rule reviewActivity has applied inline since
 * the swim's phase 4 — two verdicts on one screen can flatly contradict each
 * other, and the specific one is the better one — so the rule is now
 * quotable and testable rather than implied by a chain of guards.
 *
 * The spec's fourth tier, a distinct 'discipline-summary', is deliberately
 * collapsed into 'whole-session': a workout has exactly one discipline, so
 * at most one per-rep engine can ever speak for it, and the whole-session
 * summary IS the discipline's own unstructured read. A second summary tier
 * would be a slot with nothing to fill it.
 *
 * NO SECOND JUDGE: this module never inspects metrics. It looks only at
 * whether the discipline engines produced a verdict, exactly as the inline
 * guards always have.
 */

export function reviewAuthority({ workout, activity, swimReview, bikeReview, runReview }) {
  const workoutId = workout ? workout.id : null;
  if (!workout || !activity || !activity.movingTimeSec) {
    return { workoutId, authority: 'none', reason: 'No matched recording, so nothing can speak about this session.' };
  }
  const perRep = [swimReview, bikeReview, runReview]
    .find(r => r && r.outcome !== 'insufficient-data') || null;
  if (perRep) {
    return {
      workoutId,
      authority: 'structured',
      reason: 'The per-rep review read this session, so it is the single voice; the whole-session average stays available as raw numbers but issues no competing verdict.',
      review: perRep,
    };
  }
  return {
    workoutId,
    authority: 'whole-session',
    reason: 'No per-rep review could judge this session, so the whole-session summary speaks.',
  };
}
