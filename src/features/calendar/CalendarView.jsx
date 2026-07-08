import { useMemo, useRef, useState } from 'react';
import * as T from '@/lib';
import { effDate, monthGrid, addMonths } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
const D = T.DISCIPLINES;

/* A real calendar: one month at a time as a grid of days, sessions shown as
   discipline dots on their EFFECTIVE dates. Tap a day to see its sessions
   below; hold a session's grip and drag it onto another day to reschedule
   (writes the existing moves overlay, so it syncs and tags exactly like the
   detail sheet's reschedule — which remains the keyboard/screen-reader path).
   The week-by-week programme listing lives on the Plan tab now. */
export function CalendarView({ plan, log, moves, open, easedOf, onToggleWorkout, onMove }) {
  const todayISO = T.iso(new Date());
  const planStart = plan.weeks[0].start;
  const planEnd = T.iso(T.addDays(plan.weeks[plan.weeks.length - 1].start, 6));
  const raceISO = T.iso(plan.profile.raceDate);
  const clampDay = d => (d < planStart ? planStart : d > planEnd ? planEnd : d);

  const [anchor, setAnchor] = useState(() => clampDay(todayISO));
  const [selected, setSelected] = useState(() => clampDay(todayISO));
  const grid = useMemo(() => monthGrid(anchor), [anchor]);

  const byDate = useMemo(() => {
    const m = {};
    plan.weeks.flatMap(w => w.workouts).forEach(w => {
      if (w.discipline === 'rest') return;
      const d = effDate(w, moves);
      (m[d] = m[d] || []).push(w);
    });
    return m;
  }, [plan, moves]);

  const ym = s => s.slice(0, 7);
  const canPrev = ym(anchor) > ym(planStart);
  const canNext = ym(anchor) < ym(planEnd);

  // Pointer-based drag (touch and mouse): the grip captures the pointer, a
  // ghost chip follows it, and elementFromPoint hit-tests the day cells.
  // State drives the render; the ref keeps handlers off stale closures.
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const setDragBoth = d => { dragRef.current = d; setDrag(d); };
  const startDrag = (w, e) => {
    e.preventDefault();
    if (dragRef.current) return; // a second finger must not hijack an active drag
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    setDragBoth({ id: w.id, home: w.date, title: w.title, color: D[w.discipline].color, x: e.clientX, y: e.clientY, over: null });
  };
  const moveDrag = e => {
    if (!dragRef.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest ? el.closest('[data-caldate]') : null;
    const over = cell ? cell.getAttribute('data-caldate') : null;
    const valid = over && over >= planStart && over <= planEnd && over !== raceISO;
    setDragBoth({ ...dragRef.current, x: e.clientX, y: e.clientY, over: valid ? over : null });
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (d && d.over) { onMove(d.id, d.over === d.home ? null : d.over); setSelected(d.over); }
    setDragBoth(null);
  };

  const daySessions = (byDate[selected] || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));

  return (
    <>
      <div className="section-title">Calendar</div>
      <div className="card">
        <div className="cal-head">
          <button className="cal-nav" type="button" disabled={!canPrev} aria-label="Previous month"
            onClick={() => { setAnchor(a => addMonths(a, -1)); setSelected(null); }}>‹</button>
          <div className="ttl">{grid.label}</div>
          <button className="cal-nav" type="button" disabled={!canNext} aria-label="Next month"
            onClick={() => { setAnchor(a => addMonths(a, 1)); setSelected(null); }}>›</button>
        </div>
        <div className="cal-dow">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="cal-grid">
          {grid.cells.map((d, i) => {
            const ws = d ? (byDate[d] || []) : [];
            const inPlan = d && d >= planStart && d <= planEnd;
            return (
              <div key={i} data-caldate={d || undefined}
                className={'cal-day' + (!d ? ' blank' : '') + (d && !inPlan ? ' off' : '')
                  + (d === todayISO ? ' today' : '') + (d === selected ? ' sel' : '')
                  + (d === raceISO ? ' race' : '') + (drag && d && drag.over === d ? ' drop' : '')}
                aria-current={d === selected ? 'date' : undefined}
                aria-label={d ? T.fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })
                  + (ws.length ? ': ' + ws.map(w => w.title).join(' and ') : '') : undefined}
                {...(d ? tap(() => setSelected(d)) : {})}>
                {d && <div className="cd-num">{Number(d.slice(8))}</div>}
                {d && <div className="cd-dots">
                  {ws.slice(0, 3).map(w => <i key={w.id} className={log[w.id] ? 'done' : ''}
                    style={{ background: w.race ? '#facc15' : D[w.discipline].color }} />)}
                </div>}
              </div>
            );
          })}
        </div>
      </div>

      {selected && <>
        <div className="section-title">{T.fmtDate(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <div className="card">
          {daySessions.length === 0
            ? <div className="empty" style={{ padding: '18px 8px' }}>Nothing planned — drop a session here, or rest.</div>
            : daySessions.map(w => (
              <div className="cal-row" key={w.id}>
                {/* pointer-only grip, aria-hidden: the accessible reschedule path
                    is the detail sheet's day picker */}
                {!w.race && <div className="drag-handle" aria-hidden="true"
                  onPointerDown={e => startDrag(w, e)} onPointerMove={moveDrag}
                  onPointerUp={endDrag} onPointerCancel={endDrag}>
                  <Icon name="grip" size={17} /></div>}
                <WorkoutRow w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)}
                  moved={effDate(w, moves) !== w.date} onClick={() => open(w)} onToggle={() => onToggleWorkout(w.id)} />
              </div>
            ))}
          {daySessions.some(w => !w.race) && <div className="cal-hint">Hold a session's grip and drag it onto a day above to reschedule</div>}
        </div>
      </>}

      {drag && <div className="drag-ghost" style={{ left: drag.x, top: drag.y, borderColor: drag.color }}>{drag.title}</div>}
    </>
  );
}
