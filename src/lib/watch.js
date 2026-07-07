/* Workouts-to-watch: turn the upcoming plan into the desired intervals.icu
   calendar for a rolling window. The backend endpoint (PUT /api/integrations/
   intervals-icu/planned-events) reconciles the athlete's calendar to this list,
   and intervals.icu pushes planned workouts on to a linked watch platform
   (Garmin etc.), so the plan — adaptive-engine adjustments included — reaches
   the wrist. Descriptions deliberately use "•" bullets: intervals.icu parses
   lines starting "- " as structured power steps, the wrong semantics for
   run/swim paces (structured per-discipline steps are a later upgrade). */
import { iso, addDays } from './date.js';
import { effDate } from './schedule.js';

// discipline → intervals.icu sport type; bricks ride as their bike leg.
export const WATCH_TYPES = { run: 'Run', bike: 'Ride', swim: 'Swim', strength: 'WeightTraining', brick: 'Ride' };

// A rolling week is all the wrist needs: the next few sessions, always
// including tomorrow. Anything longer just churns events the engine may
// reshape anyway before they arrive.
export const WATCH_WINDOW_DAYS = 7;

const line = s => '• ' + [s.label, s.min ? s.min + 'm' : null, s.detail].filter(Boolean).join(' · ');

// Human-readable session steps plus a note when the adaptive engine has
// reshaped the session, so the watch copy explains itself.
export function watchDescription(w) {
  const notes = [];
  if (w.eased) notes.push('• Eased by the adaptive engine' + (w.easedFrom ? ' (was ' + w.easedFrom + ')' : ''));
  if (w.trimmed) notes.push('• Trimmed by the adaptive engine');
  if (w.boosted) notes.push('• Boosted by the adaptive engine');
  return (w.segments || []).map(line).concat(notes).join('\n') || null;
}

// The desired calendar for [todayISO .. todayISO+days): one event per upcoming
// session at its effective (possibly moved) date, with adjusted volume via
// easedOf. Race-day entries and rest days are skipped; the backend deletes any
// previously pushed event that drops out of this list.
export function buildWatchEvents({ plan, moves, easedOf, todayISO, days = WATCH_WINDOW_DAYS }) {
  const newest = iso(addDays(todayISO, days - 1));
  const eased = easedOf || (w => w);
  const events = [];
  for (const w of ((plan && plan.weeks) || []).flatMap(week => week.workouts)) {
    const type = WATCH_TYPES[w.discipline];
    if (!type || w.race) continue;
    const d = effDate(w, moves || {});
    if (d < todayISO || d > newest) continue;
    const e = eased(w);
    if (!e.durationMin) continue;
    events.push({
      ref: String(w.id),
      date: d,
      type,
      name: e.title || e.type || 'Session',
      description: watchDescription(e),
      movingTimeSec: Math.round(e.durationMin * 60),
    });
  }
  // Deterministic order so an unchanged plan serialises to an unchanged
  // payload (the app skips the push when the JSON hash matches).
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ref < b.ref ? -1 : 1));
  return { oldest: todayISO, newest, events: events.slice(0, 100) };
}
