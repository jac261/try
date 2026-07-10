/* Try — log-derived training load.
 *
 * Fitness / Fatigue / Form (CTL / ATL / TSB) estimated from the sessions the
 * athlete actually logs in the app, for accounts with no intervals.icu data.
 * Uses the same per-session load estimate (estimateTss) and the same standard
 * impulse-response recurrence the race-form projection already uses:
 *   CTL' = CTL + (TSS − CTL)/42,  ATL' = ATL + (TSS − ATL)/7
 * so the two models can never drift apart in character.
 *
 * The derived series is computed at READ TIME and never stored: the wellness
 * store stays server-shaped (the sync pushes local-only days up, and inventing
 * records there would upload estimates as if they were measurements). Records
 * carry `derived: true` so the UI can say "estimated" where it matters.
 *
 * Starting condition: the plan's own first week. A plan assumes the athlete can
 * absorb week 1, so the seed is week-1 planned load spread over 7 days, with
 * ATL = CTL (balanced, TSB 0). Derived from the plan the athlete accepted —
 * not a new constant.
 */
import { iso, addDays, daysBetween } from './date.js';
import { estimateTss, RAMP_RULES } from './adapt.js';

const round2 = x => Math.round(x * 100) / 100;

// The derived series through `todayISO` (inclusive). Only completed sessions
// count, on their effective (possibly moved) dates, with the adjustment overlay
// applied — the same accounting as projectRaceForm. By default the series runs
// from the plan's start, seeded from week-1 planned load; pass `seed`
// ({date, ctl, atl}, e.g. the last measured record) to instead CONTINUE from a
// known state — the recurrence then walks forward from the day after.
export function deriveLoadRecords({ plan, log, moves, adjust, todayISO, seed }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return [];
  const today = todayISO || iso(new Date());
  const start = seed ? iso(addDays(seed.date, 1))
    : (plan.weeks[0].start || iso(plan.profile && plan.profile.startDate || today));
  if (today < start) return [];

  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && !w.race);
  const wk1 = plan.weeks[0].workouts.filter(w => w.discipline !== 'rest' && !w.race);
  const wk1Daily = wk1.reduce((s, w) => s + estimateTss(w), 0) / 7;

  const byDate = {};
  all.forEach(w => {
    if (!(log || {})[w.id]) return;
    const d = (moves || {})[w.id] || w.date;
    (byDate[d] = byDate[d] || []).push(w);
  });

  const out = [];
  let ctl = seed ? seed.ctl : wk1Daily, atl = seed ? seed.atl : wk1Daily;
  const days = daysBetween(start, today);
  for (let i = 0; i <= days; i++) {
    const d = iso(addDays(start, i));
    const tss = (byDate[d] || []).reduce((s, w) => s + estimateTss(w, (adjust || {})[w.id]), 0);
    ctl += (tss - ctl) / 42;
    atl += (tss - atl) / 7;
    out.push({ date: d, ctl: round2(ctl), atl: round2(atl), tsb: round2(ctl - atl), derived: true });
  }
  return out;
}

// Fill the wellness records with derived load, deferring to measured data:
// - FRESH measured CTL (within the engine's freshness window) owns the series
//   outright — the derived model stays out entirely.
// - STALE measured CTL (sync gap, disconnected account) seeds a CONTINUATION:
//   the recurrence walks forward from the last measured values using logged
//   sessions, so there is no scale seam, brief gaps self-heal, and a user who
//   abandons intervals.icu keeps a live Progress tab instead of a frozen one.
// - No measured CTL at all → the full from-plan-start derivation.
// Existing records keep every non-null field they already have (a manually
// entered TSB is the athlete's assertion — an estimate never overwrites it).
export function withLogLoad(records, inputs) {
  const recs = records || [];
  const today = (inputs && inputs.todayISO) || iso(new Date());
  const real = recs.filter(r => r.ctl != null && !r.derived);
  const last = real.length ? real[real.length - 1] : null;
  if (last && last.date >= iso(addDays(today, -RAMP_RULES.freshDays))) return recs;
  const derived = deriveLoadRecords({
    ...(inputs || {}),
    seed: last ? { date: last.date, ctl: last.ctl, atl: last.atl } : undefined,
  });
  if (!derived.length) return recs;
  const byDate = {};
  derived.forEach(d => { byDate[d.date] = d; });
  const out = recs.map(r => {
    const d = byDate[r.date];
    if (!d) return r;
    return { ...r, ctl: r.ctl ?? d.ctl, atl: r.atl ?? d.atl, tsb: r.tsb ?? d.tsb, derived: true };
  });
  const have = new Set(recs.map(r => r.date));
  derived.forEach(d => { if (!have.has(d.date)) out.push(d); });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
