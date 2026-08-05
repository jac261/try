import { useMemo } from 'react';
import * as T from '@/lib';
import { weekStrip } from '@/lib/week-strip.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';

/* Your week — the design's day strip (Your week day strip.dc.html).
 *
 * Replaces the old "This week" card and absorbs the weekly digest, which
 * used to be a second card carrying the same three numbers under the title
 * this one now wears. Header line, two stat tiles, the seven days, what is
 * next, and the week's own facts as chips.
 *
 * The mockup is display-only: no role, no tabindex, no cursor, no hover
 * anywhere in it. That is a property of a static mockup, not a decision
 * about the card, so tapping a day still opens that day's session and each
 * cell still speaks its own state.
 *
 * The mockup also has no answer for a day with two sessions, a race day, or
 * a missed one. Those are ordinary in a real week, so they get treatments
 * built in the design's own vocabulary rather than borrowed from elsewhere.
 *
 * GLANCEABLE, and only that (Jon, 2026-08-04). The card used to fold out the
 * week's remaining sessions in full; that detail lives in the calendar's week
 * tab, so the fold is gone rather than duplicated. A day shows ONE chip — two
 * at a reduced size overflowed a 39px cell on a phone — and counts the rest.
 */

const NOUN = { swim: 'Swim', bike: 'Ride', run: 'Run', brick: 'Brick', strength: 'Strength' };

// The design's status line under each day. A miss is ours: the mockup shows
// only ticks, NOW and a dot, because a mockup week goes to plan.
const MARK = {
  done: { text: '✓', cls: 'done' },
  now: { text: 'NOW', cls: 'now' },
  missed: { text: '–', cls: 'missed' },
  ahead: { text: '·', cls: '' },
  rest: { text: '·', cls: '' },
};

/* One day, one chip. Two chips side by side overflowed the cell even shrunk
   to 21px — a day is about 39px wide on a phone — so the day's key session
   wears the tile at full size and the others become a count. weekStrip picks
   which one that is; the spoken label below still names them all. */
function DayChips({ day }) {
  if (day.rest) return <span className="yw-chip rest" aria-hidden="true"><Icon name="rest" size={15} /></span>;
  const s = day.key;
  return (
    <span className="yw-chips">
      <span className={'yw-chip' + (s.race ? ' race' : '') + (s.done ? ' done' : '')}
        style={s.race ? undefined : { background: (T.DISCIPLINES[s.discipline] || {}).grad }} aria-hidden="true">
        <Icon name={(T.DISCIPLINES[s.discipline] || {}).icon} size={15} />
      </span>
      {day.extra > 0 && <span className="yw-more" aria-hidden="true">+{day.extra}</span>}
    </span>
  );
}

const spoken = day => {
  const when = T.fmtDate(day.date, { weekday: 'long' });
  if (day.rest) return when + ': rest day';
  const what = day.sessions.map(s => s.title).join(' and ');
  const how = day.status === 'done' ? ', done'
    : day.status === 'missed' ? ', not logged'
      : day.status === 'now' ? ', today' : '';
  return when + ': ' + what + how;
};

export function WeekCard({
  plan, log, moves, adjust, missedReasons, open, todayISO, children,
}) {
  /* Above the early return, where every hook must live. Memoised because
     this card re-renders whenever ANY Today state changes — a coach-chip
     tap, a readiness fold — and weekStrip walks the plan seven times over
     and classifies every session (audit 2026-08-05). Its deps are its
     arguments, so a real change still rebuilds it. */
  const wk = useMemo(() => weekStrip({ plan, log, moves, adjust, missedReasons, todayISO }),
    [plan, log, moves, adjust, missedReasons, todayISO]);
  const byId = useMemo(() => new Map(plan.weeks.flatMap(w => w.workouts).map(w => [w.id, w])), [plan]);
  if (!wk) return null;

  const curWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
  // (byId is memoised above the early return: the strip carries ids, not
  // plan objects, so the sheet gets the real workout rather than the
  // selector's flattened view of it)

  return (
    <div className="card yw">
      {/* not a button any more: the fold it used to open is gone */}
      <div className="yw-head">
        <div className="yw-head-l">
          <div className="yw-eyebrow">Your week</div>
          <div className="yw-headline">{wk.headline}</div>
          <div className="yw-sub">Week {curWeek.index + 1} of {plan.totalWeeks} · {curWeek.phase}</div>
        </div>
        <div className="yw-range">{wk.label}</div>
      </div>

      <div className="yw-stats">
        <div className="yw-stat">
          <span className="yw-stat-lab">Hours</span>
          <span className="yw-stat-val">{T.fmtDuration(wk.minutes.done)}
            <i>/ {T.fmtDuration(wk.minutes.planned)}</i></span>
        </div>
        <div className="yw-stat">
          <span className="yw-stat-lab">TSS</span>
          <span className="yw-stat-val">{wk.tss.done}<i>/ {wk.tss.planned}</i></span>
        </div>
      </div>

      <div className="yw-strip">
        {wk.days.map(day => (
          /* A rest day is inert: it has nothing to open, and its tap used to
             toggle the fold that no longer exists, so keyboard focus should
             not stop on it. It keeps its spoken label for a screen reader
             reading the strip across. */
          <div key={day.date} className={'yw-day' + (day.isToday ? ' today' : '') + (day.isPast && !day.isToday ? ' past' : '') + (day.rest ? ' inert' : '')}
            aria-label={spoken(day)}
            /* role="img" on the inert ones: an aria-label on a role-less div
               is ignored by most screen readers, so making rest days inert
               in #61 quietly silenced them (audit 2026-08-05). The
               interactive cells get their role from tap(). */
            {...(day.rest ? { role: 'img' } : tap(() => open(byId.get(day.key.id))))}>
            <span className="yw-dow">{day.dow.slice(0, 3)}</span>
            <DayChips day={day} />
            {/* a goal race carries no planned duration, so its day totals 0;
                "0" reads as a data error where the dash reads as "not a
                number that applies" */}
            <span className="yw-min">{day.rest || !day.totalMin ? '—' : T.fmtDurationCompact(day.totalMin)}</span>
            <span className={'yw-mark ' + MARK[day.status].cls}>{MARK[day.status].text}</span>
          </div>
        ))}
      </div>

      {wk.upNext && (
        <div className="yw-next">
          <span className="yw-chip" style={{ background: (T.DISCIPLINES[wk.upNext.discipline] || {}).grad }} aria-hidden="true">
            <Icon name={(T.DISCIPLINES[wk.upNext.discipline] || {}).icon} size={17} />
          </span>
          <span className="yw-next-txt">
            <span className="yw-next-kick">Up next · {wk.upNext.when}</span>
            <span className="yw-next-title">{wk.upNext.title}</span>
            <span className="yw-next-meta">{T.fmtDuration(wk.upNext.min)} · {wk.upNext.tss} TSS · {NOUN[wk.upNext.discipline] || wk.upNext.discipline}</span>
          </span>
        </div>
      )}

      {!!wk.notes.length && (
        <div className="yw-notes">{wk.notes.map(n => <span className="yw-note" key={n}>{n}</span>)}</div>
      )}

      {children}
    </div>
  );
}
