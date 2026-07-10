import * as T from '@/lib';

/* ---------------- scheduling helpers ----------------
   Reschedules are stored as an overlay map { workoutId: newDateISO } so the
   generated plan stays immutable. effDate() resolves a workout's shown date. */
export function effDate(w, moves) { return (moves && moves[w.id]) || w.date; }
export function weekRange(dateISO) {
  const mon = T.startOfWeekMonday(dateISO);
  return Array.from({ length: 7 }, (_, i) => T.iso(T.addDays(mon, i)));
}

// Auto-spread this week's missed (past, incomplete) sessions onto the emptiest
// upcoming days in the same week — the "adaptive catch-up" action.
export function catchUpMoves(plan, log, moves) {
  const todayISO = T.iso(new Date());
  const week = weekRange(todayISO);
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && !w.race && !w.bRace);
  const missed = all.filter(w => { const d = effDate(w, moves); return d < todayISO && d >= week[0] && !log[w.id]; });
  const next = Object.assign({}, moves);
  const occ = mv => { const m = {}; all.forEach(w => { const d = effDate(w, mv); m[d] = (m[d] || 0) + 1; }); return m; };
  missed.forEach(w => {
    const o = occ(next);
    const cands = week.filter(d => d >= todayISO).sort((a, b) => (o[a] || 0) - (o[b] || 0));
    next[w.id] = cands[0] || week[6];
  });
  return { next: next, count: missed.length };
}

/* ---------------- month grid (Calendar tab) ---------------- */

// Monday-first cells for the month containing anchorISO; nulls pad the edges
// so dates align to weekday columns. label is e.g. "July 2026".
export function monthGrid(anchorISO) {
  const y = Number(anchorISO.slice(0, 4));
  const m = Number(anchorISO.slice(5, 7)) - 1;
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(T.iso(new Date(y, m, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return { label: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), cells };
}

export function addMonths(anchorISO, n) {
  const y = Number(anchorISO.slice(0, 4));
  const m = Number(anchorISO.slice(5, 7)) - 1;
  return T.iso(new Date(y, m + n, 1));
}
