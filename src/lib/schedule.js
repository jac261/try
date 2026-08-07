import * as T from '@/lib';

/* ---------------- scheduling helpers ----------------
   Reschedules are stored as an overlay map { workoutId: newDateISO } so the
   generated plan stays immutable. effDate() resolves a workout's shown date. */
export function effDate(w, moves) { return (moves && moves[w.id]) || w.date; }
export function weekRange(dateISO) {
  const mon = T.startOfWeekMonday(dateISO);
  return Array.from({ length: 7 }, (_, i) => T.iso(T.addDays(mon, i)));
}

/* "3 – 9 August", "31 July – 6 August", "29 December 2026 – 4 January 2027".
   The month is dropped from the first date when both ends share one, because
   repeating it reads as two separate dates rather than a range.

   The year appears only when the week straddles New Year, and then on BOTH
   ends: it is the one week of the year where the label is genuinely ambiguous
   (calendar audit, 2026-08-06), and neither end is the obvious one to leave
   bare. Every other week is unmistakably in the year the athlete is looking
   at, and stamping it would be noise fifty-one weeks out of fifty-two.

   Lifted out of CalendarView so the New Year case can be exercised without
   clicking the week arrows back through five months. */
export function weekLabel(week) {
  const sameMonth = week[0].slice(0, 7) === week[6].slice(0, 7);
  const sameYear = week[0].slice(0, 4) === week[6].slice(0, 4);
  const full = sameYear ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' };
  return T.fmtDate(week[0], sameMonth ? { day: 'numeric' } : full) + ' – ' + T.fmtDate(week[6], full);
}

// NOTE: the "adaptive catch-up" (auto-spreading missed sessions onto the
// emptiest upcoming days) was removed 2026-07-11 by field decision: a missed
// session stays missed unless the athlete moves it themselves — the auto
// redistribution stacked sessions onto days that already had training.

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
