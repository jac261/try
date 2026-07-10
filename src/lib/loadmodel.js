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
import { estimateTss } from './adapt.js';

const round2 = x => Math.round(x * 100) / 100;

// The full derived series from the plan's start through `todayISO` (inclusive).
// Only completed sessions count, on their effective (possibly moved) dates,
// with the adjustment overlay applied — the same accounting as projectRaceForm.
export function deriveLoadRecords({ plan, log, moves, adjust, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return [];
  const today = todayISO || iso(new Date());
  const start = plan.weeks[0].start || iso(plan.profile && plan.profile.startDate || today);
  if (today < start) return [];

  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && !w.race);
  const seedWeek = plan.weeks[0].workouts.filter(w => w.discipline !== 'rest' && !w.race);
  const seed = seedWeek.reduce((s, w) => s + estimateTss(w), 0) / 7;

  const byDate = {};
  all.forEach(w => {
    if (!(log || {})[w.id]) return;
    const d = (moves || {})[w.id] || w.date;
    (byDate[d] = byDate[d] || []).push(w);
  });

  const out = [];
  let ctl = seed, atl = seed;
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

// Fill the wellness records with derived load — but ONLY when there is no real
// fitness data at all. One measured CTL anywhere means intervals.icu (or a
// manual feed) owns the series; mixing measured and estimated scales would
// produce a chart that lies at the seam. Existing records (manual HRV/sleep,
// check-in answers) keep their fields and gain the derived load for their day.
export function withLogLoad(records, inputs) {
  const recs = records || [];
  if (recs.some(r => r.ctl != null)) return recs;
  const derived = deriveLoadRecords(inputs || {});
  if (!derived.length) return recs;
  const byDate = {};
  derived.forEach(d => { byDate[d.date] = d; });
  const out = recs.map(r => (byDate[r.date] ? { ...r, ...pick(byDate[r.date]) } : r));
  const have = new Set(recs.map(r => r.date));
  derived.forEach(d => { if (!have.has(d.date)) out.push(d); });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// The load fields a derived day contributes to an existing record.
const pick = d => ({ ctl: d.ctl, atl: d.atl, tsb: d.tsb, derived: true });
