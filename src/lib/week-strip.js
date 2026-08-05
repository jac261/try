import { effDate, weekRange } from './schedule.js';
import { classifyCompletion } from './coach.js';
import { estimateTss } from './adapt.js';
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

/* The day's roll-up, from its sessions' statuses ONLY. There used to be an
   `isPast ? 'missed'` fallback here, and it was this module re-rolling the
   exact judgement its own header comment forbids: classifyCompletion returns
   null for a goal race (unloggable by design) and 'unlogged-race' for a
   silent tune-up, both DELIBERATE refusals to call something missed — and
   the fallback overrode them, so the strip marked race day with the missed
   dash while the digest in the same card said "No result marked" (audit,
   2026-08-05). A miss now comes only from a 'missed-*' status the classifier
   actually issued.

   Order still matters: one missed session marks the day even when its
   sibling was ticked, because that is the fact the athlete needs to see
   from across the room. */
function dayStatus({ sessions, isToday }) {
  if (!sessions.length) return 'rest';
  if (sessions.some(s => s.status && s.status.startsWith('missed'))) return 'missed';
  // judgeable = the classifier issued a verdict; its refusals never count
  // toward "done" and never count against it
  const judged = sessions.filter(s => s.status && s.status !== 'unlogged-race');
  if (judged.length && judged.every(s => s.done)) return 'done';
  if (isToday) return 'now';
  return 'ahead';
}

/* The one session that represents its day. A day cell has room for exactly
   one chip at a legible size, so the strip has to choose rather than shrink
   everything until two fit — and the same choice decides what the cell's tap
   opens, which is why it lives here and not in the card.

   Most specific first:
     1. the day's event, which IS the day
     2. a test or tune-up, which already carries `key` from the generator
     3. anything that is not a `second`: the volume and strength doubles are
        add-ons by construction, so the session they hang off outranks them
     4. the longest, then the id, so a stable schedule renders stably */
function keySession(sessions) {
  const rank = s => (s.race ? 0 : s.flagged ? 1 : !s.second ? 2 : 3);
  return [...sessions].sort((a, b) =>
    rank(a) - rank(b) || (b.min || 0) - (a.min || 0) || (a.id < b.id ? -1 : 1))[0] || null;
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
      // storage saves { reason, at }; the classifier wants the reason itself,
      // and MISSED_REASONS[wholeObject] silently discarded every one-tap
      // answer (audit, 2026-08-05). Legacy bare strings still pass through.
      const mr = missed[w.id];
      return {
        id: w.id, discipline: w.discipline, role: w.role || null,
        /* `race` is the DISPLAY flag (gold chip) and includes tune-ups;
           `goalRace` is the accounting flag. The goal race can never be
           logged, so counting it made "week complete" unreachable in the
           one week it matters most. Tune-ups are loggable and stay counted. */
        title: w.title, race: !!(w.race || w.bRace), goalRace: !!w.race, done, min,
        // planned survives the log: the tiles' denominators must not shrink
        // to match a shortfall or inflate to match an overrun
        plannedMin: w.durationMin || 0,
        /* `flagged`, not `key`: the day's chosen session is `day.key`, and a
           session carrying its own `key` would read as `day.key.key`. This
           is the generator's key flag — tests, tune-ups, the CSS test. */
        flagged: !!w.key, second: !!w.second,
        tss: Math.round(estimateTss(w, adj[w.id], entry && entry.actualMin)),
        plannedTss: Math.round(estimateTss(w, adj[w.id])),
        status: classifyCompletion({
          workout: w, entry, adjustEntry: adj[w.id],
          missedReason: mr && typeof mr === 'object' ? mr.reason : mr,
          day: date, todayISO,
        }),
      };
    });
    return {
      date, isToday, isPast,
      dow: fmtDate(date, { weekday: 'short' }),
      rest: sessions.length === 0,
      sessions,
      key: keySession(sessions),
      extra: Math.max(0, sessions.length - 1),
      totalMin: sessions.reduce((t, s) => t + s.min, 0),
      status: dayStatus({ sessions, isToday }),
    };
  });

  // the goal race is out of every aggregate — buildWeeklyDigest's own rule —
  // because nothing can ever tick it; it still renders as its day's session
  const flat = days.flatMap(d => d.sessions).filter(s => !s.goalRace);
  const doneOnes = flat.filter(s => s.done);
  const counts = { done: doneOnes.length, planned: flat.length, remaining: flat.length - doneOnes.length };

  /* Strictly AFTER today, so this never repeats the session the Today screen
     is already leading with in full detail above this card. */
  const next = days.filter(d => d.date > todayISO)
    .flatMap(d => d.sessions.filter(s => !s.done && !s.goalRace).map(s => ({ d, s })))[0] || null;
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
      planned: flat.reduce((t, s) => t + s.plannedMin, 0),
    },
    tss: {
      done: doneOnes.reduce((t, s) => t + s.tss, 0),
      planned: flat.reduce((t, s) => t + s.plannedTss, 0),
    },
    days,
    upNext: next ? { ...next.s, date: next.d.date, when: whenFor(next.d.date) } : null,
    notes: notesFor({ days, plan }),
  };
}
