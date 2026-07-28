/* Try — phase 8 §7: race readiness, kept in pieces.
 *
 * §7 lists eight components and then says the thing that governs the module:
 * "Avoid a single opaque readiness score." That is the same instruction §3 of
 * phase 7 gave about rider phenotypes, and it is enforced the same way — by
 * the SHAPE of what comes back, not by a promise about the copy.
 *
 * WHY A SCORE WOULD BE WORSE THAN NOTHING. Eight components measured with
 * eight different confidences do not average. A rider with excellent fitness,
 * no fuelling data and an untested position would get a number, and the
 * number would be dominated by whichever components happen to be measurable
 * rather than by whichever matter. It would also be the only thing anybody
 * read: a percentage is a magnet, and the eight sentences that actually tell
 * you what to do would go unread beside it. Worst of all it would move for
 * reasons the athlete cannot see, because the missing components would be
 * silently treated as something.
 *
 * So there is no total, no percentage, no letter and no ordering by strength.
 * A test asserts that no field of the returned object could be used as one.
 * Components that cannot be assessed say so — 'unknown' is a state, and it is
 * the honest answer far more often than 'ready' is.
 */
import { BIKE_DASH_RULES } from './bike-dashboard.js';

export const READINESS_STATES = ['ready', 'building', 'at-risk', 'unknown'];

/* §7's eight, in the order they appear on a race day rather than in order of
   importance — there is no order of importance, which is the point. */
export const READINESS_COMPONENTS = [
  { id: 'fitness', label: 'Fitness', why: 'whether the threshold your targets are built from is real and current' },
  { id: 'durability', label: 'Durability', why: 'whether the numbers hold up in the closing third of a long ride' },
  { id: 'pacing', label: 'Pacing', why: 'whether your efforts land where they were asked to' },
  { id: 'fuelling', label: 'Fuelling', why: 'whether you can take in what a race-length ride needs' },
  { id: 'position', label: 'Position', why: 'whether you can hold your race position for race duration' },
  { id: 'terrain', label: 'Terrain', why: 'whether your long rides look like the course you have entered' },
  { id: 'brick', label: 'Bike to run', why: 'whether the way you ride leaves a run in your legs' },
  { id: 'dataConfidence', label: 'Data confidence', why: 'how much of this is measured rather than inferred' },
];

const st = (state, evidence) => ({
  state: READINESS_STATES.includes(state) ? state : 'unknown',
  evidence: evidence || null,
});

/* §7: the components. Never a score. */
export function bikeReadiness(d) {
  if (!d) return null;
  const out = {};

  const ftp = d.status.ftpWatts.value;
  const adherence = d.quality.adherence.value;
  /* A measured FTP alone is not fitness. The else arm used to claim "your
     efforts are landing on it" whenever an FTP existed — a second fact the
     code had never checked — so a brand-new athlete who typed a number into
     onboarding, and one returning from injury having ridden nothing, both
     read 'ready'. And since no reviews are stored yet, that was EVERY
     athlete. Unknown adherence is unknown fitness. */
  out.fitness = ftp == null
    ? st('unknown', 'No measured FTP, so there is nothing to judge fitness against.')
    : adherence == null
      ? st('unknown', 'Your FTP is measured, but no judged efforts yet to say whether it still fits you.')
      : adherence <= -BIKE_DASH_RULES.fadeConcern
        ? st('at-risk', 'Your efforts are landing below their targets, which usually means the threshold is set high.')
        : st('ready', 'Your threshold is measured and your efforts are landing on it.');

  const fade = d.durability.lateFadePct.value;
  out.durability = fade == null
    ? st('unknown', 'No long rides with enough lap detail to read a late fade yet.')
    : fade > BIKE_DASH_RULES.fadeConcern
      ? st('at-risk', 'Output falls about ' + fade + '% in the closing third of your long rides.')
      : st('ready', 'Your output holds to the end of your long rides.');

  const adh = d.quality.adherence.value;
  /* Three arms, not two: there was no at-risk case at all, so the one
     component §7 names for pacing was structurally capped at 'building' — an
     athlete 40% off every target read the same as one 4% off. */
  out.pacing = adh == null
    ? st('unknown', 'Not enough judged efforts yet to say how your pacing lands.')
    : Math.abs(adh) <= BIKE_DASH_RULES.fadeConcern
      ? st('ready', 'Your efforts land close to what they ask for.')
      : Math.abs(adh) >= BIKE_DASH_RULES.fadeConcern * 3
        ? st('at-risk', 'Your efforts sit about ' + Math.abs(adh) + '% ' + (adh > 0 ? 'above' : 'below') + ' target, which is far enough that the targets and the riding do not describe the same athlete.')
        : st('building', 'Your efforts sit about ' + Math.abs(adh) + '% ' + (adh > 0 ? 'above' : 'below') + ' target.');

  const fuel = d.durability.fuellingMet.value;
  out.fuelling = fuel == null
    ? st('unknown', 'No fuelling answers logged on long rides yet.')
    : fuel >= 70 ? st('ready', 'You hit the fuelling plan on ' + fuel + '% of your long rides.')
      : fuel >= 40 ? st('building', 'You hit the fuelling plan on ' + fuel + '% of your long rides.')
        : st('at-risk', 'You hit the fuelling plan on only ' + fuel + '% of your long rides.');

  const pos = d.durability.positionTolerance.value;
  out.position = pos == null ? st('unknown', d.durability.positionTolerance.note || 'No position answers yet.')
    : pos === 'build' ? st('ready', d.durability.positionTolerance.note)
      : pos === 'hold' ? st('building', d.durability.positionTolerance.note)
        : st('at-risk', d.durability.positionTolerance.note);

  /* §7 lists terrain and nothing in the app can measure it: there is no
     course profile, no elevation on the activity, and no way to know what the
     rider's roads look like. It is a component with an honest 'unknown'
     rather than a component quietly dropped, because a missing row is
     indistinguishable from a passing one. */
  out.terrain = st('unknown',
    'The plan cannot see your course or your roads, so this is yours to judge. Your long rides carry a terrain focus to rehearse it.');

  out.brick = d.brick && d.brick.pattern
    ? st('at-risk', d.brick.pattern.text)
    : d.brick && d.brick.executions.length
      ? st('ready', 'Your recent brick runs held close to the pace you run fresh.')
      : st('unknown', 'No completed bricks recorded yet.');

  // how much of the above is measured rather than absent
  const known = Object.values(out).filter(c => c.state !== 'unknown').length;
  out.dataConfidence = known >= 5 ? st('ready', known + ' of the components above are measured.')
    : known >= 3 ? st('building', 'Only ' + known + ' of the components above are measured; the rest are still unknown.')
      : st('at-risk', 'Almost none of this is measured yet, so treat every reading on this page as provisional.');

  /* NO TOTAL. No `score`, no `percent`, no `overall`, no `grade`, no `rank`.
     The absence is the feature and there is a test that fails if any of them
     appears — the same guard phase 7 put on rider phenotypes, for the same
     reason: whatever single number exists is the only thing anybody reads. */
  return {
    components: READINESS_COMPONENTS.map(c => ({ ...c, ...out[c.id] })),
    byId: out,
    // counts, which are descriptions of the list rather than a verdict on it
    ready: Object.values(out).filter(c => c.state === 'ready').length,
    unknown: Object.values(out).filter(c => c.state === 'unknown').length,
    atRisk: Object.values(out).filter(c => c.state === 'at-risk').length,
  };
}
