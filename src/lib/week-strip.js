import { effDate, weekRange } from './schedule.js';
import { classifyCompletion } from './coach.js';
import { estimateTss } from './adapt.js';
import { DISCIPLINES } from './disciplines.js';
import { fmtDate, toDate } from './date.js';

/* Try — one week, seen as seven days.
 *
 * Three surfaces already rebuild this by hand (Today's strip, the calendar's
 * week view, the reschedule picker), each with its own idea of what "done"
 * and "missed" mean. This is the one selector, so the card that shows a week
 * is a renderer rather than a calculator.
 *
 * The week is the CALENDAR week around todayISO, not a plan week. Those
 * usually coincide — plans snap to Monday — but a rescheduled session belongs
 * to the week it now sits in, and every total here is built from the days'
 * own sessions rather than from `week.totalMin` for exactly that reason.
 *
 * Completion is not judged here. `classifyCompletion` in coach.js is the
 * canonical per-session state machine (it knows about partials, eased
 * sessions, tune-up races that auto-close, and the athlete's own one-tap
 * missed reasons). A strip that rolled its own `date < today && !log[id]`
 * would drift from the coach's view of the same week within one release.
 */

// The day's roll-up, from its sessions' statuses. Order matters: a day with
// anything missed reads missed even if its other session was ticked, because
// that is the fact the athlete needs to see from across the room.
function dayStatus({ sessions, isToday, isPast }) {
  if (!sessions.length) return 'rest';
  if (sessions.some(s => s.status && s.status.startsWith('missed'))) return 'missed';
  if (sessions.every(s => s.done)) return 'done';
  if (isToday) return 'now';
  return isPast ? 'missed' : 'ahead';
}

// "3 down, 3 to go" — the design's headline. Falls back to plain counts at
// the edges, since "0 down, 0 to go" is a sentence about nothing.
function headlineFor({ done, planned }) {
  if (!planned) return 'Nothing planned';
  const left = planned - done;
  if (!left) return done === 1 ? '1 done, week complete' : done + ' done, week complete';
  if (!done) return planned === 1 ? '1 session this week' : planned + ' sessions this week';
  return done + ' down, ' + left + ' to go';
}

/* The design ends its card with two note chips ("Sat is the long ride",
   "Friday off"). They are facts here or they are absent: an app that invents
   an encouraging line has started lying about small things. */
function notesFor({ days, plan }) {
  const out = [];
  const dow = d => fmtDate(d, { weekday: 'short' });
  const race = days.find(d => d.sessions.some(s => s.race));
  if (race) out.push(dow(race.date) + ' is race day');
  // the week's long session, named by its own discipline
  const longs = days.flatMap(d => d.sessions.filter(s => s.role === 'long').map(s => ({ d, s })));
  const longest = longs.length
    ? longs.reduce((a, b) => (b.s.min > a.s.min ? b : a))
    : null;
  if (longest && !race) {
    const noun = longest.s.discipline === 'bike' ? 'ride'
      : longest.s.discipline === 'swim' ? 'swim' : 'run';
    out.push(dow(longest.d.date) + ' is the long ' + noun);
  }
  const rest = days.filter(d => d.rest);
  if (rest.length === 1) out.push(dow(rest[0].date) + ' off');
  else if (rest.length === 2) out.push(dow(rest[0].date) + ' and ' + dow(rest[1].date) + ' off');
  else if (rest.length > 2) out.push(rest.length + ' rest days');
  return plan ? out : [];
}

export function weekStrip({ plan, log, moves, adjust, missedReasons, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const lg = log || {};
  const adj = adjust || {};
  const missed = missedReasons || {};
  const dates = weekRange(todayISO);
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest');

  const days = dates.map(date => {
    const isToday = date === todayISO;
    const isPast = date < todayISO;
    const sessions = all.filter(w => effDate(w, moves) === date).map(w => {
      const entry = lg[w.id];
      const done = !!(entry && entry.done);
      const min = entry && entry.actualMin != null ? entry.actualMin : (w.durationMin || 0);
      return {
        id: w.id, discipline: w.discipline, role: w.role || null,
        title: w.title, race: !!(w.race || w.bRace), done, min,
        tss: Math.round(estimateTss(w, adj[w.id], entry && entry.actualMin)),
        colour: w.race || w.bRace ? '#facc15' : (DISCIPLINES[w.discipline] || {}).color,
        status: classifyCompletion({
          workout: w, entry, adjustEntry: adj[w.id], missedReason: missed[w.id],
          day: date, todayISO,
        }),
      };
    });
    return {
      date, isToday, isPast,
      dow: fmtDate(date, { weekday: 'short' }),
      rest: sessions.length === 0,
      sessions,
      totalMin: sessions.reduce((t, s) => t + s.min, 0),
      status: dayStatus({ sessions, isToday, isPast }),
    };
  });

  const flat = days.flatMap(d => d.sessions);
  const doneOnes = flat.filter(s => s.done);
  const counts = { done: doneOnes.length, planned: flat.length, remaining: flat.length - doneOnes.length };

  /* Strictly AFTER today, so this never repeats the session the Today screen
     is already leading with in full detail above this card. */
  const next = days.filter(d => d.date > todayISO)
    .flatMap(d => d.sessions.filter(s => !s.done && !s.race).map(s => ({ d, s })))[0] || null;
  const whenFor = date => {
    const i = dates.indexOf(date);
    const t = dates.indexOf(todayISO);
    return i === t + 1 ? 'TOMORROW' : fmtDate(date, { weekday: 'long' }).toUpperCase();
  };

  /* The design writes "4–10 Aug", which is one locale's order. formatRange
     does the same collapsing (it drops the repeated month itself) in whatever
     order the athlete's locale wants, so this reads right in en-GB and en-US
     alike. The fallback is the digest's own range formatting. */
  const fmtD = d => fmtDate(d, { month: 'short', day: 'numeric' });
  const label = (() => {
    try {
      const f = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
      if (typeof f.formatRange === 'function') return f.formatRange(toDate(dates[0]), toDate(dates[6]));
    } catch (e) { /* older runtime: fall through */ }
    return fmtD(dates[0]) + '–' + fmtD(dates[6]);
  })();

  return {
    range: { start: dates[0], end: dates[6] },
    label,
    counts,
    headline: headlineFor(counts),
    minutes: {
      done: doneOnes.reduce((t, s) => t + s.min, 0),
      planned: flat.reduce((t, s) => t + s.min, 0),
    },
    tss: {
      done: doneOnes.reduce((t, s) => t + s.tss, 0),
      planned: flat.reduce((t, s) => t + s.tss, 0),
    },
    days,
    upNext: next ? { ...next.s, date: next.d.date, when: whenFor(next.d.date) } : null,
    notes: notesFor({ days, plan }),
  };
}
