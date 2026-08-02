import { useMemo, useRef, useState } from 'react';
import * as T from '@/lib';
import { effDate, monthGrid, addMonths, weekRange } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { RecordedActivities } from '@/components/RecordedActivities.jsx';
const D = T.DISCIPLINES;
/* Season is deliberately absent: it is the one panel of the screen doc that
   could not be read (the file is past the design API's size cap), and a range
   nobody has seen is a range nobody can implement. */
const RANGES = [['week', 'Week'], ['month', 'Month']];

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
  /* Browsing reaches BEFORE the plan (field report 2026-07-30: "starting a
     new plan deletes all my past recorded activities in the calendar" — it
     deleted nothing, but the previous-month button stopped at the plan's
     first week, so an athlete who came from a tracker lost sight of their
     whole diary the moment a plan began). History is continuous across plan
     boundaries: browse as far back as a tracker does, or to the plan start
     if that is older. Moves and add-targets stay clamped to the PLAN window
     below — you can look at last month, not schedule into it. */
  const viewStart = tracker ? planStart : (d => (d < planStart ? d : planStart))(addMonths(todayISO, -6));
  /* noRace, not tracker. A maintenance block has no race, but it still has a
     raceDate — "just the block's horizon" (domain.js) — and rollMaintenance
     sets it to the Monday plus twelve weeks less a day, which is exactly
     planEnd. So the gold race ring landed on the last browsable day of every
     maintenance block, marking the horizon as a race. tracker is noRace too,
     so one condition covers both. */
  const race = T.RACES[plan.race] || {};
  const raceISO = race.noRace ? null : T.iso(plan.profile.raceDate);
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
    /* Both modes since 2026-07-30 — recorded dots were tracker-only, so in
       plan mode a rest-day ride and the whole pre-plan history were
       dot-less. Which of these a cell actually dots is decided per activity
       by unclaimedActs below: a planned session that already speaks for a
       recording carries the dot for it, and nothing else is hidden. */
    (activities || []).forEach(a => {
      // The exact guard RecordedActivities uses, drift check included: an
      // unmapped activity type (walk, yoga, ski) stays off the grid rather
      // than defaulting to a bike dot, and the grid, the day card and the
      // Recorded list can never disagree about whether a day has recordings.
      if (!a || !a.date || !a.movingTimeSec || !T.DISCIPLINES[T.DISCIPLINE[a.type]]) return;
      (m[a.date] = m[a.date] || []).push(a);
    });
    return m;
  }, [activities]);

  /* Which of a day's recordings the grid must dot for itself (bug, Jon
     2026-08-01: recorded sessions showed in the day card but wore no dot).
     The old rule dotted recordings only on days with NO planned session,
     which suppressed every recording on any planned day, matched or not: a
     rest-day ride beside a planned swim was dot-less while the card
     directly beneath the grid listed it.
     A recording earns its own dot unless a planned session already speaks
     for it: half of a brick pair, or a ticked session that claims it under
     the shared rule. The `used` set makes the claim one-to-one here, unlike
     the recorded list: two rides inside one session's window must not both
     vanish from a grid whose only job is to say what happened. */
  const unclaimedActs = d => {
    const acts = actByDate[d] || [];
    if (!acts.length) return acts;
    const sessions = byDate[d] || [];
    if (!sessions.length) return acts;
    const claimed = new Set();
    const feedActs = (activities || []).filter(a => a && !a.manual);
    sessions.filter(w => w.discipline === 'brick').forEach(w => {
      const pair = T.brickPairFor({ workout: w, activities: feedActs, moves, used: claimed });
      if (pair) { claimed.add(pair.ride.id); claimed.add(pair.run.id); }
    });
    const used = new Set();
    return acts.filter(a => {
      if (claimed.has(a.id)) return false;
      const owner = T.ownerFor({ activity: a, sessions, log, used });
      if (owner) { used.add(owner.id); return false; }
      return true;
    });
  };

  /* One anchor date, two step sizes (the screen doc: "three ranges of the
     same plan, one set of chrome"). Switching range keeps the athlete on the
     date they were looking at rather than resetting them, which is the whole
     point of sharing the chrome. Season is not here yet: its panel is the one
     part of the design doc that could not be read. */
  const [range, setRange] = useState('month');
  const week = useMemo(() => weekRange(anchor), [anchor]);
  // "3 – 9 August", or "31 July – 6 August" when the week straddles two
  const weekLabel = (() => {
    const sameMonth = week[0].slice(0, 7) === week[6].slice(0, 7);
    return T.fmtDate(week[0], sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' })
      + ' – ' + T.fmtDate(week[6], { day: 'numeric', month: 'long' });
  })();
  const ym = s => s.slice(0, 7);
  const step = n => (range === 'week' ? T.iso(T.addDays(anchor, n * 7)) : addMonths(anchor, n));
  /* Month compares months, week compares the days it would land on, so the
     arrows stop exactly where there is nothing left to show in EITHER range
     rather than at whichever boundary the month happened to own. */
  const canPrev = range === 'week' ? week[0] > viewStart : ym(anchor) > ym(viewStart);
  const canNext = range === 'week' ? week[6] < planEnd : ym(anchor) < ym(planEnd);

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
  const dayActs = selected ? (actByDate[selected] || []) : []; // both modes now

  return (
    <>
      <div className="section-title">Calendar</div>
      {/* The chrome sits ON the field, not on the pane, because it is shared:
          the month grid is one panel under it, and the ranges that are not a
          grid have no card for it to sit inside. */}
      <div className="cal-head">
        <button className="cal-nav" type="button" disabled={!canPrev}
          aria-label={range === 'week' ? 'Previous week' : 'Previous month'}
          onClick={() => { setAnchor(step(-1)); setSelected(null); }}>‹</button>
        <div className="ttl">{range === 'week' ? weekLabel : grid.label}</div>
        <button className="cal-nav" type="button" disabled={!canNext}
          aria-label={range === 'week' ? 'Next week' : 'Next month'}
          onClick={() => { setAnchor(step(1)); setSelected(null); }}>›</button>
      </div>
      <div className="segbar" role="tablist" aria-label="Calendar range">
        {RANGES.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={range === k}
            className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{label}</button>
        ))}
      </div>

      {range === 'month' && <div className="card">
        <div className="cal-dow">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="cal-grid">
          {grid.cells.map((d, i) => {
            const ws = d ? (byDate[d] || []) : [];
            const acts = d ? unclaimedActs(d) : [];
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
        {/* The race, pinned. It carries the DATE, which no other surface does
            — the top bar counts days — and it survives browsing to a month
            the race is not in, which is when you most want to know. No
            countdown here: the top bar owns that language, and two places
            computing the same countdown is how PRs #19 to #23 went wrong.
            raceISO is already null for tracker and maintenance. */}
        {raceISO && raceISO >= todayISO && <div className="cal-race-pin">
          <span className="rp-dot" />
          <span>{T.fmtDate(raceISO, { day: 'numeric', month: 'short' })} · {race.name}{race.solo ? '' : ' Triathlon'}</span>
        </div>}
      </div>}

      {range === 'month' && selected && <>
        <div className="section-title">{T.fmtDate(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        {!((tracker || selected < planStart) && dayActs.length > 0) && <div className="card">
          {daySessions.length === 0
            ? <div className="empty" style={{ padding: '18px 8px' }}>{tracker ? 'Nothing recorded.'
              : selected < planStart ? 'Before this plan began.'
                : 'Nothing planned — drop a session here, or rest.'}</div>
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
            {['run', 'bike', 'swim', 'strength'].map(k => (
              <div key={k} className="card cal-add-card" style={{ background: D[k].grad }}
                {...tap(() => onAddWorkout(k, addTarget))}
                aria-label={'Add a ' + D[k].name.toLowerCase() + ' session on '
                  + T.fmtDate(addTarget, { weekday: 'long', month: 'long', day: 'numeric' })}>
                <Icon name={D[k].icon} size={32} />
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
