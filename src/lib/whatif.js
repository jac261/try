/* Try — the what-if simulator: a read-only lens over the load model.
 *
 * "Miss a week, move the race, see the consequence." Composes the SAME
 * machinery the engine already trusts — the impulse-response walk
 * (CTL' = CTL + (TSS − CTL)/42, ATL' = ATL + (TSS − ATL)/7) charged by
 * estimateTss over unlogged planned sessions with the adjustment overlay
 * applied — and never writes to plan, log, moves or adjust. Words outrank
 * curves: every result leads with a verdict sentence in the app's own zone
 * vocabulary, wears the estimate caveat, and REFUSES what the model cannot
 * honestly answer (dates beyond the plan's scheduled data, plans with no
 * race, tracker mode) instead of guessing. Design panel decisions
 * (2026-07-16): honesty-first surface, week-granular miss scenario grounded
 * in proposeWeek's own exclusions, plus the per-session doorway every judge
 * asked to graft ("What if I skip this?" on a workout's detail sheet).
 */
import { iso, addDays, daysBetween, fmtDate } from './date.js';
import { effDate } from './schedule.js';
import { estimateTss, RAMP_RULES } from './adapt.js';
import { wellness as W } from './wellness.js';

// The permanent caveat, non-dismissable by design. The second sentence rides
// along only when the seed itself is log-derived (matching the wording the
// Fitness & Fatigue card already uses for the same condition).
export const WHATIF_CAVEAT = 'A what-if is an estimate built on an estimate: your load numbers, projected forward. Treat the direction as trustworthy, the exact numbers as a sketch.';
export const WHATIF_CAVEAT_DERIVED = 'Also: your current numbers are estimated from your training log, not measured, and this what-if inherits that estimate.';

// Seed for any projection: the last fitness reading on or before today.
// Stale beyond the engine's freshness window → null (a projection from a
// guess is a guess). Future-dated records never seed (timezone skew rule
// projectRecovery already enforces).
export function whatIfSeed(wellness, todayISO) {
  const recs = (wellness || []).filter(r => r && r.ctl != null && r.atl != null && r.date && r.date <= todayISO);
  if (!recs.length) return null;
  const seed = recs[recs.length - 1];
  if (seed.date < iso(addDays(todayISO, -RAMP_RULES.freshDays))) return null;
  return seed;
}

// The daily walk: seed → horizon, charging each day's unlogged planned
// sessions (overlay applied), with two scenario knobs — a set of workout ids
// to skip, and a race weight left in place or removed. The seed-to-today gap
// charges what was actually DONE (projectRecovery's optimistic-bias lesson).
function walk({ plan, log, moves, adjust, seed, todayISO, horizonISO, skipIds }) {
  const all = plan.weeks.flatMap(w => w.workouts);
  const eff = w => effDate(w, moves);
  const skip = skipIds || new Set();
  const byDate = {};
  all.forEach(w => {
    if (w.race || w.discipline === 'rest') return;
    const d = eff(w);
    if (d <= seed.date || d > horizonISO) return;
    const entry = (log || {})[w.id];
    if (d <= todayISO ? entry && entry.done : !entry && !skip.has(w.id)) {
      (byDate[d] = byDate[d] || []).push({ w, actualMin: entry ? entry.actualMin : undefined });
    }
  });
  let ctl = seed.ctl, atl = seed.atl;
  const series = [];
  for (let d = iso(addDays(seed.date, 1)); d <= horizonISO; d = iso(addDays(d, 1))) {
    const tss = (byDate[d] || []).reduce((s, x) => s + estimateTss(x.w, (adjust || {})[x.w.id], x.actualMin), 0);
    ctl += (tss - ctl) / 42;
    atl += (tss - atl) / 7;
    if (d > todayISO) series.push({ date: d, ctl, atl, tsb: ctl - atl });
  }
  return series;
}

const r1 = v => Math.round(v * 10) / 10;
const zoneWord = tsb => { const z = W.formZone(tsb); return z ? z.label : null; };
const signed = v => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v));
const day = d => fmtDate(d, { day: 'numeric', month: 'short' });

// Upcoming weeks it is honest to simulate missing: they must exist, hold
// unlogged future sessions, and not be recovery/taper/race weeks — the same
// exclusions proposeWeek applies before it will touch a week (you cannot
// meaningfully "miss" a week that is already scheduled relief). At most
// three, so the picker stays a decision and not a calendar.
export function missWeekCandidates({ plan, log, moves, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks)) return [];
  const eff = w => effDate(w, moves);
  return plan.weeks.filter(wk =>
    !wk.isRecovery && wk.phase !== 'Taper' && !wk.workouts.some(w => w.race || w.bRace)
    && wk.workouts.some(w => w.discipline !== 'rest' && !(log || {})[w.id] && eff(w) >= todayISO))
    .slice(0, 3)
    .map(wk => ({
      index: wk.index, phase: wk.phase,
      label: 'Week ' + (wk.index + 1) + ' · ' + wk.phase,
      ids: wk.workouts.filter(w => w.discipline !== 'rest' && !(log || {})[w.id] && eff(w) >= todayISO).map(w => w.id),
    }));
}

// Scenario 1 — miss sessions (a whole eligible week, or one session from its
// detail sheet). Returns { ok, verdict, assumption?, numbers, series } or a
// refusal { ok: false, reason }.
export function simulateMiss({ plan, log, moves, adjust, wellness, todayISO, skipIds, skipLabel }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length || plan.race === 'tracker') {
    return { ok: false, reason: 'There is no plan right now to project against.' };
  }
  const seed = whatIfSeed(wellness, todayISO);
  if (!seed) return { ok: false, reason: 'Your training data is too old to project from. Log a recent session, then come back.' };
  const all = plan.weeks.flatMap(w => w.workouts);
  const eff = w => effDate(w, moves);
  // Only sessions still ahead can be skipped: the walk charges the past with
  // what actually happened, so a past id would silently no-op and produce a
  // confident zero-cost verdict (gauntlet finding). Logged ones are history.
  const ids = new Set(all.filter(w => (skipIds || []).includes(w.id)
    && eff(w) >= todayISO && !(log || {})[w.id]).map(w => w.id));
  if (!ids.size) return { ok: false, reason: 'That session is already behind you. The what-if only looks forward.' };
  const skipped = all.filter(w => ids.has(w.id));
  const windowEnd = skipped.map(eff).sort().pop();
  const race = all.find(w => w.race);
  const raceDate = race ? ((moves || {})[race.id] || race.date) : null;
  // The horizon must cover the skipped window even when it ends after race
  // day (a post-race recovery session from the per-session doorway), or the
  // walk would silently drop the very session being skipped.
  const afterWindow = iso(addDays(windowEnd, 14));
  const raceMorning = raceDate && raceDate > todayISO ? iso(addDays(raceDate, -1)) : null;
  const horizon = raceMorning && raceMorning > afterWindow ? raceMorning : afterWindow;

  const base = { plan, log, moves, adjust, seed, todayISO, horizonISO: horizon };
  const planned = walk({ ...base, skipIds: new Set() });
  const missed = walk({ ...base, skipIds: ids });
  if (!planned.length || !missed.length) return { ok: false, reason: 'That window is already behind you.' };

  const at = d => missed.find(x => x.date === d) || missed[missed.length - 1];
  const pAt = d => planned.find(x => x.date === d) || planned[planned.length - 1];
  // race morning reads from the series (the horizon may extend past it)
  const pEnd = raceMorning ? pAt(raceMorning) : planned[planned.length - 1];
  const mEnd = raceMorning ? at(raceMorning) : missed[missed.length - 1];
  const endOfWindow = at(windowEnd), pEndOfWindow = pAt(windowEnd);
  const ctlCost = r1(pEnd.ctl - mEnd.ctl);

  const costN = Math.abs(Math.round(ctlCost));
  let verdict = 'Skipping ' + (skipLabel || 'those sessions')
    + (costN === 0 ? ' would barely dent your fitness' : ' would cost you about ' + costN + ' point' + (costN === 1 ? '' : 's') + ' of fitness')
    + ' and leave your form around '
    + signed(endOfWindow.tsb) + ' (' + zoneWord(endOfWindow.tsb) + ') instead of '
    + signed(pEndOfWindow.tsb) + ' (' + zoneWord(pEndOfWindow.tsb) + ') by ' + day(windowEnd) + '.';
  if (raceDate && raceDate > todayISO) {
    const dr = Math.round(pEnd.tsb) === Math.round(mEnd.tsb)
      ? ' Projected race-morning form: ' + signed(mEnd.tsb) + ' either way. This far out, the miss does not move race day.'
      : ' Projected race-morning form: ' + signed(mEnd.tsb) + ' (' + zoneWord(mEnd.tsb) + ') instead of '
        + signed(pEnd.tsb) + ' (' + zoneWord(pEnd.tsb) + ').';
    verdict += dr;
  }

  return {
    ok: true, verdict,
    caveatDerived: !!seed.derived,
    numbers: {
      // horizon = race morning (race plans) or window + a fortnight; the
      // window figures carry the immediate freshness story the verdict tells
      planned: { endTsb: r1(pEnd.tsb), endCtl: r1(pEnd.ctl), windowTsb: r1(pEndOfWindow.tsb) },
      scenario: { endTsb: r1(mEnd.tsb), endCtl: r1(mEnd.ctl), windowTsb: r1(endOfWindow.tsb) },
      ctlCost,
    },
    series: { planned: planned.map(x => r1(x.tsb)), scenario: missed.map(x => r1(x.tsb)) },
  };
}

// Scenario 2 — move race day. Keeps every scheduled session where it is (the
// simulator re-tapers nothing: that assumption is stated in the result) and
// refuses dates beyond the plan's own scheduled data.
export function raceMoveBounds({ plan, moves, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks)) return null;
  const all = plan.weeks.flatMap(w => w.workouts);
  const race = all.find(w => w.race);
  if (!race) return null;
  const eff = w => effDate(w, moves);
  const lastScheduled = all.filter(w => !w.race && w.discipline !== 'rest').map(eff).sort().pop();
  return { raceDate: (moves || {})[race.id] || race.date, min: iso(addDays(todayISO, 1)), max: lastScheduled };
}

export function simulateRaceMove({ plan, log, moves, adjust, wellness, todayISO, newRaceDate }) {
  const bounds = raceMoveBounds({ plan, moves, todayISO });
  if (!bounds) return { ok: false, reason: 'This plan does not have a race day to move. Start a race plan to try this one.' };
  const seed = whatIfSeed(wellness, todayISO);
  if (!seed) return { ok: false, reason: 'Your training data is too old to project from. Log a recent session, then come back.' };
  if (newRaceDate <= bounds.min) return { ok: false, reason: 'Race day has to be in the future.' };
  if (newRaceDate > bounds.max) {
    return { ok: false, reason: 'Your plan only has scheduled sessions through ' + day(bounds.max) + '. Projecting past that would mean inventing training that is not planned yet. Try a closer date, or reshape the plan first.' };
  }

  const base = { plan, log, moves, adjust, seed, todayISO, skipIds: new Set() };
  const current = walk({ ...base, horizonISO: iso(addDays(bounds.raceDate, -1)) });
  const moved = walk({ ...base, horizonISO: iso(addDays(newRaceDate, -1)) });
  // Defensive only: the bounds.min guard above makes an empty walk
  // unreachable today (verified in the gauntlet); kept as a safety net.
  if (!moved.length) return { ok: false, reason: 'That date is too close to project.' };
  const mEnd = moved[moved.length - 1];
  const cEnd = current.length ? current[current.length - 1] : mEnd;
  const delta = daysBetween(bounds.raceDate, newRaceDate);
  const dir = delta < 0 ? Math.abs(delta) + ' days earlier' : delta + ' days later';

  return {
    ok: true,
    verdict: 'Moving race day to ' + day(newRaceDate) + ' (' + dir + ') would land you at '
      + signed(mEnd.tsb) + ' (' + zoneWord(mEnd.tsb) + ') on race morning, versus '
      + signed(cEnd.tsb) + ' (' + zoneWord(cEnd.tsb) + ') on the current date.',
    assumption: 'This keeps every scheduled session where it is. It does not re-taper the plan for you; reshape the plan if you settle on the new date.',
    caveatDerived: !!seed.derived,
    numbers: {
      current: { raceDate: bounds.raceDate, tsb: r1(cEnd.tsb) },
      moved: { raceDate: newRaceDate, tsb: r1(mEnd.tsb) },
    },
    series: { planned: current.map(x => r1(x.tsb)), scenario: moved.map(x => r1(x.tsb)) },
  };
}
