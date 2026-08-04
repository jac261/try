import { useState } from 'react';
import * as T from '@/lib';
import { weekStrip } from '@/lib/week-strip.js';
import { effDate } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';

/* Your week — the design's day strip (Your week day strip.dc.html).
 *
 * Replaces the old "This week" card and absorbs the weekly digest, which
 * used to be a second card carrying the same three numbers under the title
 * this one now wears. Header line, two stat tiles, the seven days, what is
 * next, and the week's own facts as chips.
 *
 * The mockup is display-only: no role, no tabindex, no cursor, no hover
 * anywhere in it. That is a property of a static mockup, not a decision
 * about the card, so every interaction the old strip had survives here —
 * tapping a day opens its session, the header folds out the rest of the
 * week, and each cell keeps its spoken label. A redesign that quietly
 * removed them would be a regression wearing a new coat.
 *
 * The mockup also has no answer for a day with two sessions, a race day, or
 * a missed one. Those are ordinary in a real week, so they get treatments
 * built in the design's own vocabulary rather than borrowed from elsewhere.
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

/* One day's chips. The design draws a single 28px gradient tile per day and
   never shows a double, but Jon's weeks routinely hold two sessions, so a
   second chip rides alongside at a reduced size and a third becomes a count
   rather than a squeeze. */
function DayChips({ day }) {
  if (day.rest) return <span className="yw-chip rest" aria-hidden="true"><Icon name="rest" size={15} /></span>;
  const shown = day.sessions.slice(0, 2);
  const extra = day.sessions.length - shown.length;
  return (
    <span className={'yw-chips' + (shown.length > 1 ? ' pair' : '')}>
      {shown.map(s => (
        <span key={s.id} className={'yw-chip' + (s.race ? ' race' : '') + (s.done ? ' done' : '')}
          style={s.race ? undefined : { background: (T.DISCIPLINES[s.discipline] || {}).grad }} aria-hidden="true">
          <Icon name={(T.DISCIPLINES[s.discipline] || {}).icon} size={shown.length > 1 ? 12 : 15} />
        </span>
      ))}
      {extra > 0 && <span className="yw-more" aria-hidden="true">+{extra}</span>}
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
  plan, log, moves, adjust, missedReasons, open, easedOf, todayISO, onToggleWorkout,
  loadOpen, saveOpen, children,
}) {
  const [openWk, setOpenWk] = useState(() => loadOpen() === true);
  const toggle = () => setOpenWk(o => { saveOpen(!o); return !o; });
  const wk = weekStrip({ plan, log, moves, adjust, missedReasons, todayISO });
  if (!wk) return null;

  const curWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
  // the strip carries ids, not plan objects, so the sheet gets the real
  // workout rather than the selector's flattened view of it
  const byId = new Map(plan.weeks.flatMap(w => w.workouts).map(w => [w.id, w]));
  const rest = plan.weeks.flatMap(w => w.workouts)
    .filter(w => w.discipline !== 'rest' && !w.race && effDate(w, moves) > todayISO && effDate(w, moves) <= wk.range.end)
    .sort((a, b) => (effDate(a, moves) < effDate(b, moves) ? -1 : 1));

  return (
    <div className="card yw">
      <div className="yw-head" {...tap(toggle)} aria-expanded={openWk}
        aria-label={'Your week, ' + wk.headline + ': show the rest of the week'}>
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
          <div key={day.date} className={'yw-day' + (day.isToday ? ' today' : '') + (day.isPast && !day.isToday ? ' past' : '')}
            aria-label={spoken(day)}
            {...tap(e => { e.stopPropagation(); if (day.sessions.length) open(byId.get(day.sessions[0].id)); else toggle(); })}>
            <span className="yw-dow">{day.dow.slice(0, 3)}</span>
            <DayChips day={day} />
            <span className="yw-min">{day.rest ? '—' : T.fmtDuration(day.totalMin)}</span>
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

      {openWk && (rest.length
        ? rest.map(w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)}
          moved={effDate(w, moves) !== w.date} onClick={() => open(w)} onToggle={() => onToggleWorkout(w.id)} />)
        : <div className="muted yw-empty">Nothing more this week — rest up.</div>)}

      {children}
    </div>
  );
}
