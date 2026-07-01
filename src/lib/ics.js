import * as T from '@/lib';
import { effDate } from './schedule.js';

// ---- calendar (.ics) export ----
function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function buildICS(plan, moves) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Try//Triathlon//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  plan.weeks.forEach(week => week.workouts.forEach(w => {
    if (w.discipline === 'rest') return;
    const d = effDate(w, moves);
    const start = d.replace(/-/g, '');
    const end = T.iso(T.addDays(d, 1)).replace(/-/g, '');
    const sum = w.title + (w.durationMin ? ' (' + T.fmtDuration(w.durationMin) + ')' : '');
    const desc = w.segments.map(s => s.label + (s.detail ? ' — ' + s.detail : '') + (s.min ? ' [' + s.min + ' min]' : '')).join('\n');
    L.push('BEGIN:VEVENT', 'UID:try-' + w.id + '@try.app', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + start, 'DTEND;VALUE=DATE:' + end,
      'SUMMARY:' + icsEsc(sum), 'DESCRIPTION:' + icsEsc(desc), 'END:VEVENT');
  }));
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
export function downloadICS(plan, moves) {
  const blob = new Blob([buildICS(plan, moves)], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'try-' + plan.race + '-plan.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
