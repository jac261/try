/* Try — date helpers.
   Everything works in LOCAL time. The trap: `new Date("2026-09-20")` parses a
   date-only string as UTC midnight, which then reads back as the *previous* day
   for anyone west of UTC. toDate() normalises date-only strings to local midnight
   so a "YYYY-MM-DD" and a Date object always mean the same calendar day. */

export function toDate(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + 'T00:00:00');
  return new Date(d);
}

export function startOfWeekMonday(d) {
  const x = toDate(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}

export function addDays(d, n) {
  const x = toDate(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function iso(d) {
  const x = toDate(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

export function weeksBetween(a, b) {
  return (toDate(b) - toDate(a)) / (7 * 24 * 3600 * 1000);
}

export function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / (24 * 3600 * 1000));
}

export function fmtDate(isoStr, opts) {
  return toDate(isoStr).toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' });
}
