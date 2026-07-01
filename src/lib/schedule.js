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
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && !w.race);
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
