/* Try — body mass: the trend, and nothing but the trend unless asked.
 * (Coach brain pass 3; docs/PROGRESSION_SPEC.md section 11.)
 *
 * SAFETY RULES, which outrank every feature here:
 * - Without a declared goal the app tracks and NEVER judges: no status, no
 *   loss/gain language, no advice. The card shows the number and the trend.
 * - Pass 3 ships exactly one goal: gaining on purpose (the spec's case).
 *   Losing and holding each need their own honest band design and safety
 *   review before they exist at all.
 * - The app never prescribes intake.
 *
 * SIGNAL RULES (design panel 2026-07-21, argued from the numbers):
 * - Scale noise is around half a kilogram per weigh-in; the spec's target
 *   band is 60 grams a week wide. Differences of window means cannot
 *   resolve that, so the weekly rate is a least-squares slope over a 28-day
 *   window using every weigh-in, which averages noise across all points.
 * - Weekly evaluations are Monday-anchored calendar buckets (the cadence
 *   the whole coach brain already uses), never a daily rolling recompute
 *   that flickers across thresholds.
 * - A week that cannot be scored resets the persistence count: two
 *   off-band evaluations must be genuinely consecutive.
 * - The daily inputs themselves are uncontrolled (one record per date,
 *   whichever reading synced last wins; morning vs evening weights differ
 *   by a kilogram or more). The rolling window absorbs some of that; the
 *   copy must not pretend the inputs are clean.
 *
 * The target band scales with the athlete: the spec's 0.10 to 0.16 kg per
 * week is its 64 kg author's number, shipped here as a fraction of body
 * weight that reproduces those figures at 64 kg. Documented as a product
 * decision, not physiology.
 */

import { iso, addDays, startOfWeekMonday } from './date.js';
import { saneWeightKg } from './domain.js';

export const BODYMASS_RULE_VERSION = 2; // v2: the hold goal and the settling gate

// Regression window and its honesty gates.
export const MASS_WINDOW_DAYS = 28;
export const MASS_MIN_POINTS = 8;     // weigh-ins inside the window
export const MASS_MIN_SPAN_DAYS = 14; // first-to-last spread inside it

// The gain band, as a fraction of current body weight per week. At 64 kg
// these reproduce the spec's 0.10-0.16 on-target, 0.05 floor and 0.25
// ceiling. Documented simplification: linear in body weight.
export const GAIN_BAND = {
  onLo: 0.0016, onHi: 0.0025,
  floor: 0.0008,   // persistently under this: barely moving
  ceiling: 0.0039, // persistently over this: faster than the plan intends
};

// The hold band, as a fraction of current body weight per week.
// on reuses GAIN_BAND.onLo (0.0016, ~0.10 kg/wk at 64 kg): tight enough that
// a gain-band-paced drift never reads as holding, wide enough that the 28-day
// OLS can actually resolve it (slope SE ~0.08 kg/wk for a daily weigher, up
// to ~0.35 kg/wk at the minimum gates). Documented blind spot: drift slower
// than ~0.10 kg/wk at 64 kg is invisible to the pill; the chart still shows
// it. fast reuses the magnitude of GAIN_BAND.ceiling: two consecutive
// evaluations at or beyond it downward escalate to the fuelling warning.
// Product decision, not physiology, same as GAIN_BAND.
//
// Standing rules from the mass-goals safety panel (2026-07-22), written down
// so they survive future passes:
// - There is NO lose goal. Reopening it requires an external ED-informed
//   review of the full copy set; the panel considers never-reopening an
//   acceptable end state.
// - Mass status never enters coach.js, digest.js, or any notification.
// - No goal chooser in onboarding; direction only, never a target weight.
// - The goalless card is silent and byte-stable: no pill, no signed rate,
//   no conditional commentary whatever the trend does. That silence is the
//   contract protecting the athlete who chose No goal to escape commentary.
// - No praise for any downward rate; no progress styling on any hold state;
//   banned vocabulary: cut, deficit, calorie, fat, race weight, burn,
//   streaks, and unprompted illness or diagnosis words.
// - The fuelling sentences under a DECLARED goal are the one sanctioned
//   advice exception, directed at the training, never the body.
export const HOLD_BAND = {
  on: 0.0016,
  fast: 0.0039,
};

// Least-squares slope in kg/day over the records' (dayIndex, weightKg)
// points; null when the gates fail.
function slopeKgPerDay(points) {
  if (points.length < MASS_MIN_POINTS) return null;
  const span = points[points.length - 1].x - points[0].x;
  if (span < MASS_MIN_SPAN_DAYS) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) * (p.x - mx); }
  return den > 0 ? num / den : null;
}

const dayIndex = (dateISO, epochISO) =>
  Math.round((new Date(dateISO + 'T00:00:00Z') - new Date(epochISO + 'T00:00:00Z')) / 864e5);

// One weekly evaluation: the regression window ends on the given Sunday.
function rateAt(records, sundayISO) {
  const from = iso(addDays(sundayISO, -(MASS_WINDOW_DAYS - 1)));
  const pts = records
    .filter(r => r.date >= from && r.date <= sundayISO)
    .map(r => ({ x: dayIndex(r.date, from), y: r.weightKg }));
  const slope = slopeKgPerDay(pts);
  return slope == null ? null : slope * 7;
}

// massTrend(wellness records) → {
//   latestKg, latestDate           the newest single weigh-in (labelled so)
//   avgKg                          mean of the last 7 days' weigh-ins (>=2)
//   weeklyRateKg                   the current regression rate, or null
//   weeklyRates                    last 3 Monday-week evaluations, oldest
//                                  first, null where a week was unscoreable
//   series                         one point per calendar week (last 12),
//                                  the week's mean weigh-in or null: a gap
//                                  in the data is a gap on the chart
// } or null when no weigh-ins exist at all.
export function massTrend(records, todayISO) {
  // saneWeightKg (30-250) rejects the impossible: negatives, zeros, an
  // extra digit. It does NOT catch a plausible-but-wrong value like 150
  // typed for 150 lb; the entry sheet's confirm covers the manual path,
  // and a synced typo rides the averages until corrected. Honest limits,
  // stated as such (re-verify catch 2026-07-21). Dedupe by date, last
  // record wins, so the function defends its own contract.
  const byDate = {};
  (records || []).forEach(r => {
    if (r && r.date && saneWeightKg(r.weightKg)) byDate[r.date] = r;
  });
  const rs = Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!rs.length) return null;
  const today = todayISO || iso(new Date());
  const latest = rs[rs.length - 1];

  const week7 = iso(addDays(today, -6));
  const recent = rs.filter(r => r.date >= week7 && r.date <= today);
  const avgKg = recent.length >= 2
    ? Math.round(recent.reduce((a, r) => a + r.weightKg, 0) / recent.length * 10) / 10 : null;

  const thisMonday = iso(startOfWeekMonday(today));
  const weeklyRates = [-2, -1, 0].map(k => rateAt(rs, iso(addDays(thisMonday, k * 7 - 1))));
  const weeklyRateKg = rateAt(rs, today);

  const series = Array.from({ length: 12 }, (_, i) => {
    const start = iso(addDays(thisMonday, (i - 11) * 7));
    const end = iso(addDays(start, 6));
    const wk = rs.filter(r => r.date >= start && r.date <= end);
    return wk.length ? Math.round(wk.reduce((a, r) => a + r.weightKg, 0) / wk.length * 10) / 10 : null;
  });

  return {
    ruleVersion: BODYMASS_RULE_VERSION,
    latestKg: Math.round(latest.weightKg * 10) / 10, latestDate: latest.date,
    avgKg, weeklyRateKg, weeklyRates, series,
  };
}

// goalStatus: declared goals only (gain or hold), and only with persistence. A single off-band
// evaluation is scale noise until it repeats; an unscoreable week resets
// the count. Register is matter-of-fact: no praise, no alarm.
// Every judgment reads COMPLETED Monday-anchored evaluations, never the
// daily-sliding current rate: the module's anti-flicker rule applies to the
// on-target check too, and the pill always agrees with the number shown
// beside it because they share one source (gauntlet catches 2026-07-21).
// judgedRateKg is that shared source; display it, never weeklyRateKg, next
// to the pill.
export function goalStatus(trend, goal, opts) {
  if ((goal !== 'gain' && goal !== 'hold') || !trend || !trend.avgKg) return null;
  const latest = trend.weeklyRates[2];
  if (latest == null) return null; // no completed evaluation: nothing to judge
  const w = trend.avgKg;
  let prior = trend.weeklyRates[1];

  // The settling gate: an evaluation is judged only when its full 28-day
  // window starts on or after the day the goal was set, so a goal change
  // can never be judged against a trend the old goal shaped (day-one
  // whiplash). A null setISO means a legacy goal with no stamp: judged
  // exactly as before, no backdating, no judgment blackout.
  const setISO = opts && opts.setISO;
  const today = opts && opts.todayISO;
  if (setISO && today) {
    const monday = iso(startOfWeekMonday(today));
    const winStart = sunday => iso(addDays(sunday, -(MASS_WINDOW_DAYS - 1)));
    if (winStart(iso(addDays(monday, -1))) < setISO) {
      return { key: 'settling', label: 'settling in', detail: 'The monthly trend still includes time before this goal. A fair read needs about four weeks.' };
    }
    if (winStart(iso(addDays(monday, -8))) < setISO) prior = null; // persistence resets
  }

  if (goal === 'hold') {
    // No signed figures in any detail string: the rate line beside the pill
    // already carries the number the athlete opted into. Down states carry
    // the fuelling pointer, up states only goal-ownership wording: a
    // declared holder has said they do not want to lose, so the downward
    // pointer is invited; pressure cues upward are not.
    const on = HOLD_BAND.on * w, fast = HOLD_BAND.fast * w;
    if (prior != null && latest <= -fast && prior <= -fast) return { key: 'downFast', judgedRateKg: latest, label: 'coming down quickly', detail: 'Two weeks coming down quicker than drift. If this is not deliberate, fuelling around training is the first place to look; either way, someone qualified sees more than a chart does.' };
    if (prior != null && latest < -on && prior < -on) return { key: 'driftDown', judgedRateKg: latest, label: 'drifting down', detail: 'Two weeks trending down. If losing is not the intent, fuelling around training is worth a look.' };
    if (prior != null && latest > on && prior > on) return { key: 'driftUp', judgedRateKg: latest, label: 'drifting up', detail: 'Two weeks trending up. Only worth attention if holding is still the goal.' };
    if (latest >= -on && latest <= on) return { key: 'on', judgedRateKg: latest, label: 'little change', detail: 'No clear drift either way across the month.' };
    return { key: 'between', judgedRateKg: latest, label: 'roughly holding', detail: 'One week outside the range is usually scale noise. Two in a row is a pattern.' };
  }

  const band = { onLo: GAIN_BAND.onLo * w, onHi: GAIN_BAND.onHi * w, floor: GAIN_BAND.floor * w, ceiling: GAIN_BAND.ceiling * w };
  const bothBelow = prior != null && latest < band.floor && prior < band.floor;
  const bothAbove = prior != null && latest > band.ceiling && prior > band.ceiling;
  if (bothBelow) {
    // Losing during a declared build is the spec's under-fuelling flag: the
    // floor magnitude reused as the loss threshold (documented product
    // decision), persistence inherited from the below state itself.
    const detail = latest <= -band.floor
      ? 'Two weeks running under it, and the trend points down, not flat. Losing during a build usually means fuelling is not keeping up with the training.'
      : 'Two weeks running under it.';
    return { key: 'below', judgedRateKg: latest, label: 'under the target range', detail };
  }
  if (bothAbove) return { key: 'above', judgedRateKg: latest, label: 'over the target range', detail: 'Two weeks running over it. Quicker than a gradual build intends.' };
  if (latest >= band.onLo && latest <= band.onHi) return { key: 'on', judgedRateKg: latest, label: 'in the target range', detail: 'A gradual build, on plan.' };
  return { key: 'between', judgedRateKg: latest, label: 'near the target range', detail: 'One week outside the range is usually scale noise. Two in a row is a pattern.' };
}

// grams per week, signed, tilde: 0.13 kg reads as ~+130 g each week, which
// survives display where one-decimal kilograms round the whole band to the
// same figure (design panel catch).
export function fmtRateGrams(weeklyRateKg) {
  if (weeklyRateKg == null) return null;
  const g = Math.round(weeklyRateKg * 1000 / 10) * 10;
  return '~' + (g > 0 ? '+' : g < 0 ? '−' : '') + Math.abs(g) + ' g a week';
}

// The one-tap fuel vocabulary for long sessions: athlete-facing nutrition
// anchors, captured against the RECORDING (activity id), never a workout id.
export const FUEL_LEVELS = {
  none: 'Nothing',
  bit: 'A bit',
  solid: 'Solid',
  race: 'Race level',
};
export const FUEL_CAPTION = 'Roughly: a bit is 30 g of carbs an hour, solid is 60, race level is 90 or more.';
