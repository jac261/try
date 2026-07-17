import { useMemo, useRef, useState } from 'react';
import * as T from '@/lib';
import { effDate, monthGrid, addMonths } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { RecordedActivities } from '@/components/RecordedActivities.jsx';
const D = T.DISCIPLINES;

/* A real calendar: one month at a time as a grid of days, sessions shown as
   discipline dots on their EFFECTIVE dates. Tap a day to see its sessions
   below; hold a session's grip and drag it onto another day to reschedule
   (writes the existing moves overlay, so it syncs and tags exactly like the
   detail sheet's reschedule — which remains the keyboard/screen-reader path).
   The week-by-week programme listing lives on the Plan tab now. */
export function CalendarView({ plan, log, moves, open, easedOf, onToggleWorkout, onMove, activities, onOpenRecording, onAddWorkout }) {
  const todayISO = T.iso(new Date());
  // Tracker mode has no plan weeks: browse a rolling window around today so the
  // month grid still works and detected activities land on their days.
  const tracker = plan.race === 'tracker';
  const planStart = tracker ? addMonths(todayISO, -6) : plan.weeks[0].start;
  const planEnd = tracker ? addMonths(todayISO, 1) : T.iso(T.addDays(plan.weeks[plan.weeks.length - 1].start, 6));
  const raceISO = tracker ? null : T.iso(plan.profile.raceDate);
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

  // Tracker mode is a diary: the grid's dots come from the RECORDED feed,
  // since there are no plan workouts to dot the days with (field report
  // 2026-07-16: recorded workouts were invisible until a day was tapped).
  const actByDate = useMemo(() => {
    const m = {};
    if (tracker) (activities || []).forEach(a => {
      // The exact guard RecordedActivities uses, drift check included: an
      // unmapped activity type (walk, yoga, ski) stays off the grid rather
      // than defaulting to a bike dot, and the grid, the day card and the
      // Recorded list can never disagree about whether a day has recordings.
      if (!a || !a.date || !a.movingTimeSec || !T.DISCIPLINES[T.DISCIPLINE[a.type]]) return;
      (m[a.date] = m[a.date] || []).push(a);
    });
    return m;
  }, [tracker, activities]);

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
  // With no plan there are never day sessions, so the card exists only to say
  // "Nothing recorded." — which it must not while the Recorded list below has
  // rows for the day (field report 2026-07-16: it contradicted a recorded run).
  const dayActs = selected ? (actByDate[selected] || []) : [];

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
            const acts = d ? (actByDate[d] || []) : [];
            const inPlan = d && d >= planStart && d <= planEnd;
            return (
              <div key={i} data-caldate={d || undefined}
                className={'cal-day' + (!d ? ' blank' : '') + (d && !inPlan ? ' off' : '')
                  + (d === todayISO ? ' today' : '') + (d === selected ? ' sel' : '')
                  + (d && d === raceISO ? ' race' : '') + (drag && d && drag.over === d ? ' drop' : '')}
                aria-current={d === selected ? 'date' : undefined}
                aria-label={d ? T.fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })
                  + (ws.length ? ': ' + ws.map(w => w.title).join(' and ') : '')
                  + (acts.length ? ': ' + acts.length + ' recorded ' + (acts.length === 1 ? 'session' : 'sessions') : '') : undefined}
                {...(d ? tap(() => setSelected(d)) : {})}>
                {d && <div className="cd-num">{Number(d.slice(8))}</div>}
                {d && <div className="cd-dots">
                  {ws.slice(0, 3).map(w => <i key={w.id} className={log[w.id] ? 'done' : ''}
                    style={{ background: w.race || w.bRace ? '#facc15' : D[w.discipline].color }} />)}
                  {/* recorded sessions are inherently done, so they wear the tick */}
                  {acts.slice(0, Math.max(0, 3 - ws.length)).map(a => <i key={'a' + a.id} className="done"
                    style={{ background: (D[T.DISCIPLINE[a.type]] || D.bike).color }} />)}
                </div>}
              </div>
            );
          })}
        </div>
      </div>

      {selected && <>
        <div className="section-title">{T.fmtDate(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        {!(tracker && dayActs.length > 0) && <div className="card">
          {daySessions.length === 0
            ? <div className="empty" style={{ padding: '18px 8px' }}>{tracker ? 'Nothing recorded.' : 'Nothing planned — drop a session here, or rest.'}</div>
            : daySessions.map(w => (
              <div className="cal-row" key={w.id}>
                {/* pointer-only grip, aria-hidden: the accessible reschedule path
                    is the detail sheet's day picker */}
                {!w.race && !w.bRace && <div className="drag-handle" aria-hidden="true"
                  onPointerDown={e => startDrag(w, e)} onPointerMove={moveDrag}
                  onPointerUp={endDrag} onPointerCancel={endDrag}>
                  <Icon name="grip" size={17} /></div>}
                <WorkoutRow w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)}
                  moved={effDate(w, moves) !== w.date} onClick={() => open(w)} onToggle={() => onToggleWorkout(w.id)} />
              </div>
            ))}
          {daySessions.some(w => !w.race && !w.bRace) && <div className="cal-hint">Hold a session's grip and drag it onto a day above to reschedule</div>}
        </div>}
        <RecordedActivities activities={activities} date={selected} plan={plan} log={log} moves={moves} onOpen={onOpenRecording} noHeading={tracker} />
      </>}

      {/* One card per sport, full discipline colour with the icon front and
          centre (Jon, 2026-07-17): tap to open the add sheet with that sport
          preselected and the selected day as the target; the sheet's library
          list carries the type choice. In plan mode this schedules a custom
          workout; in tracker mode App routes it to the manual-log flavour. */}
      {onAddWorkout && (() => {
        // Plan mode clamps into the plan window: edge months show tappable
        // off-plan days, and addCustomWorkout files any out-of-window date
        // under the LAST week (gauntlet 2026-07-16). Tracker's browse window
        // already covers any day worth logging.
        const addTarget = tracker ? (selected || todayISO) : clampDay(selected || todayISO);
        return <>
          <div className="section-title">Add a session</div>
          <div className="cal-add">
            {['run', 'bike', 'swim'].map(k => (
              <div key={k} className="card cal-add-card" style={{ background: D[k].grad }}
                {...tap(() => onAddWorkout(k, addTarget))}
                aria-label={'Add a ' + D[k].name.toLowerCase() + ' session on '
                  + T.fmtDate(addTarget, { weekday: 'long', month: 'long', day: 'numeric' })}>
                <Icon name={D[k].icon} size={36} />
                <span className="cal-add-name">{D[k].name}</span>
              </div>
            ))}
          </div>
        </>;
      })()}

      {drag && <div className="drag-ghost" style={{ left: drag.x, top: drag.y, borderColor: drag.color }}>{drag.title}</div>}
    </>
  );
}
