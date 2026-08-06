import { useEffect, useMemo, useRef, useState } from 'react';
import * as T from '@/lib';
import { effDate, monthGrid, addMonths, weekRange } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { RecordedActivities } from '@/components/RecordedActivities.jsx';
import { dayLedger, spanLedger, sessionLoad, weekLoad } from '@/lib/calendar-load.js';
import { LoadSlot } from '@/components/LoadSlot.jsx';
import { SeasonPanel } from '@/features/calendar/SeasonPanel.jsx';
const D = T.DISCIPLINES;
const RANGES = [['week', 'Week'], ['month', 'Month'], ['season', 'Season']];

/* A real calendar: one month at a time as a grid of days, sessions shown as
   discipline dots on their EFFECTIVE dates. Tap a day to see its sessions
   below. Rescheduling by drag lives on the WEEK range only (Jon,
   2026-08-06): its seven visible cards make within-week the natural
   constraint, where a month grid let an athlete pile a whole month's
   sessions into its last week. The detail sheet's day picker remains the
   keyboard/screen-reader path, and both write the same moves overlay.
   The week-by-week programme listing lives on the Plan tab now. */
export function CalendarView({ plan, log, moves, open, easedOf, onToggleWorkout, onMove, activities, onOpenRecording, onAddWorkout, wellness, adjust, onOpenSettings }) {
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
     for it. That claim now comes from the shared ledger in calendar-load,
     the same one the week's totals are built from, so the grid and the
     numbers can never disagree about who owns a ride. */
  /* One pass over the whole shown grid, not per cell: a session moved off the
     day its recording sits on claims that recording from another day, and a
     cell that cannot see the rest of the grid would dot a ride the week's
     totals have already counted against its session. */
  const gridSpan = useMemo(() => spanLedger({
    dates: grid.cells.filter(Boolean), byDate, activities, log, moves,
  }), [grid, byDate, activities, log, moves]);
  const unclaimedActs = d => (gridSpan[d] ? gridSpan[d].unclaimed : []);

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
  /* One pass over the week for every number on it: the rows and the header
     read the same ledger, so the total is always the sum of what is visible.
     Memoised on the same inputs the rows themselves render from. */
  const load = useMemo(() => weekLoad({ dates: week, byDate, activities, log, moves, easedOf }),
    [week, byDate, activities, log, moves, easedOf]);

  /* "Week 2 of 4 · 6h 10m / 9h 40m · ~310 / 512 TSS".
     Position is within the PHASE GROUP, not the plan: phaseGroups returns the
     week index each group starts at, so it is week.index - group.start + 1,
     and it is simply absent when the shown week is outside the plan.

     Two pairs, done over planned, in the slash form the Your Week card
     already uses. Done counts what happened — a session its recording speaks
     for, a ticked session's estimate, and every recording the plan never
     asked for — so a week with two extra rides finally shows them. Planned
     stays the forecast, priced through easedOf like the rows themselves, so
     the total can never disagree with what is under it.

     Done may exceed planned. That is an ordinary week and it is displayed as
     one: no clamp, no colour, no apology.

     A week with nothing recorded says "512 TSS, estimated" exactly as it
     always did — a number that is entirely modelled should admit it in words
     rather than wear a tilde and a denominator it cannot use. And a week with
     no plan sessions at all (tracker, or before the plan began) still gets a
     header now, because it is precisely the week that is all recordings. */
  const weekHeader = useMemo(() => {
    const anyPlanned = week.some(d => (byDate[d] || []).length);
    if (!anyPlanned && !load.doneTss && !load.doneMin) return null;
    const pw = plan.weeks.find(w => w.start === week[0]);
    const grp = pw && T.phaseGroups(plan).find(g => pw.index >= g.start && pw.index < g.start + g.weeks);
    const where = grp ? 'Week ' + (pw.index - grp.start + 1) + ' of ' + grp.weeks + ' · ' : '';
    const tilde = load.estimated ? '~' : '';
    if (!load.doneMin && !load.doneTss) {
      return where + T.fmtDuration(load.plannedMin) + ' · ' + load.plannedTss + ' TSS, estimated';
    }
    if (!anyPlanned) return where + T.fmtDuration(load.doneMin) + ' · ' + tilde + load.doneTss + ' TSS';
    return where + T.fmtDuration(load.doneMin) + ' / ' + T.fmtDuration(load.plannedMin)
      + ' · ' + tilde + load.doneTss + ' / ' + load.plannedTss + ' TSS';
  }, [week, byDate, plan, load]);

  const ym = s => s.slice(0, 7);
  /* "2026 season" / "Mar – Oct · week 22 of 34". Two years when the plan
     straddles New Year, because "2026 season" would be wrong for half of it. */
  const season = useMemo(() => T.seasonCurve({ plan, wellness, log, moves, adjust, todayISO }),
    [plan, wellness, log, moves, adjust, todayISO]);
  const seasonLabel = season
    ? (season.from.slice(0, 4) === season.to.slice(0, 4)
      ? season.from.slice(0, 4) + ' season'
      : season.from.slice(0, 4) + '–' + season.to.slice(2, 4) + ' season')
    : 'Season';
  const seasonSub = season
    ? T.fmtDate(season.from, { month: 'short' }) + ' – ' + T.fmtDate(season.to, { month: 'short' })
      + (season.weekOfSeason ? ' · week ' + season.weekOfSeason + ' of ' + season.weeks : '')
    : null;

  /* "Build · 38 h planned" under the month name. The design writes numbered
     blocks ("Build 3"); Try does not have those, so it uses the phase label
     the plan itself carries. Hours are the sessions whose EFFECTIVE date
     lands in the shown month, so a moved session counts where it now is. */
  /* Done over planned, the pair the week header already uses. A month you are
     halfway through described itself purely by intention, which made it the
     one range that could not tell you how it was going. Summed from the same
     ledger the week and the dots read, never a lighter parallel count: a
     second currency drifts, and drift is the defect this whole surface has
     been paying off. */
  const monthLoad = useMemo(() => weekLoad({
    dates: grid.cells.filter(Boolean).filter(d => ym(d) === ym(anchor)),
    byDate, activities, log, moves, easedOf,
  }), [grid, anchor, byDate, activities, log, moves, easedOf]);
  const monthSub = useMemo(() => {
    if (!monthLoad.plannedMin && !monthLoad.doneMin) return null;
    const phases = [...new Set(plan.weeks.filter(w => ym(w.start) === ym(anchor)).map(w => T.weekPhaseLabel(plan, w)))];
    const where = phases.length === 1 ? phases[0] + ' · ' : '';
    const hrs = m => Math.round(m / 60) + 'h';
    return monthLoad.doneMin
      ? where + hrs(monthLoad.doneMin) + ' / ' + hrs(monthLoad.plannedMin)
      : where + Math.round(monthLoad.plannedMin / 60) + ' h planned';
  }, [monthLoad, anchor, plan]);

  const step = n => (range === 'week' ? T.iso(T.addDays(anchor, n * 7)) : addMonths(anchor, n));
  /* Month compares months, week compares the days it would land on, so the
     arrows stop exactly where there is nothing left to show in EITHER range
     rather than at whichever boundary the month happened to own. */
  /* Season steps nowhere. The design draws arrows either side of "2026
     season", but Try has exactly one plan at a time — there is no previous
     season to reach. Disabled says so; arrows that do nothing would not. */
  /* Browsing reaches TODAY even when today is past the plan's last day. A
     plan does not become a tracker the moment it ends: planEnded holds it for
     a week of grace, and a plan with no appended recovery week (legacy, or an
     exactly-40-week build) leaves the athlete inside a live plan whose
     calendar cannot step to the day they are on — a ride recorded the Tuesday
     after the race renders nowhere until the grace expires. */
  const viewEnd = planEnd > todayISO ? planEnd : todayISO;
  const canPrev = range === 'season' ? false : range === 'week' ? week[0] > viewStart : ym(anchor) > ym(viewStart);
  const canNext = range === 'season' ? false : range === 'week' ? week[6] < viewEnd : ym(anchor) < ym(viewEnd);

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
    setDragBoth({ id: w.id, home: w.date, title: w.title, color: D[w.discipline].color,
      pointer: e.pointerId, x: e.clientX, y: e.clientY, over: null });
  };
  /* The hit test, shared between pointer moves and the auto-scroll loop: the
     nearest [data-caldate] under the point, valid inside the plan window and
     never race day. In the week range the seven visible cards are the only
     carriers, so within-week is structural — the athlete cannot pile a
     month's sessions into its last week, which is why the drag lives here
     and not on the month grid. */
  const dropAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest ? el.closest('[data-caldate]') : null;
    const over = cell ? cell.getAttribute('data-caldate') : null;
    return over && over >= planStart && over <= planEnd && over !== raceISO ? over : null;
  };
  /* Edge auto-scroll. Seven stacked day cards outrun a phone viewport, and
     touch-action: none plus pointer capture kill native scrolling — while a
     finger held still at the screen edge fires no pointermove at all, which
     is exactly the posture of someone reaching for Sunday. So the scroll
     cannot ride the move events: a timer loop scrolls the window and re-runs
     the hit test at the frozen finger. A timer, not requestAnimationFrame,
     deliberately: rAF is paint-gated and observed suspended in an embedded
     webview while the page was fully interactive — a stalled auto-scroll is
     a drag that cannot reach Sunday, so the loop rides the mechanism every
     environment services. */
  const tickRef = useRef(0);
  const edgeRef = useRef(0);       // -1 scroll up, 0 idle, +1 scroll down
  const EDGE = 64, SPEED = 10, TICK = 16;  // px zone, px per tick, ms
  const stopScroll = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = 0; edgeRef.current = 0;
  };
  // a drag interrupted by unmount must not leave a live timer behind
  useEffect(() => stopScroll, []);
  // Only the finger that started the drag may steer or end it. Without this
  // a second finger's move drags the ghost and its lift COMMITS the move —
  // the first finger is still down and never chose to drop.
  const mine = e => dragRef.current && (dragRef.current.pointer == null || dragRef.current.pointer === e.pointerId);
  const moveDrag = e => {
    if (!mine(e)) return;
    setDragBoth({ ...dragRef.current, x: e.clientX, y: e.clientY, over: dropAt(e.clientX, e.clientY) });
    edgeRef.current = e.clientY < EDGE ? -1 : e.clientY > window.innerHeight - EDGE ? 1 : 0;
    if (!edgeRef.current) { stopScroll(); return; }
    if (!tickRef.current) tickRef.current = setInterval(() => {
      if (!dragRef.current || !edgeRef.current) { stopScroll(); return; }
      window.scrollBy(0, edgeRef.current * SPEED);
      const d = dragRef.current;
      setDragBoth({ ...d, over: dropAt(d.x, d.y) });
    }, TICK);
  };
  /* A LIFT commits; a CANCEL abandons. pointercancel means the browser or OS
     took the gesture away — a notification shade pulled down, the phone
     rotated, a palm rejected — so the athlete never chose a day, and
     committing the move to whatever happened to be under the finger is the
     app inventing an intent (calendar audit, 2026-08-06). */
  const endDrag = e => {
    if (e && !mine(e)) return;
    stopScroll();
    const d = dragRef.current;
    if (d && d.over) { onMove(d.id, d.over === d.home ? null : d.over); setSelected(d.over); }
    setDragBoth(null);
  };
  const cancelDrag = e => {
    if (e && !mine(e)) return;
    stopScroll();
    setDragBoth(null);
  };

  /* Once a recording speaks for a session, the row describes what HAPPENED:
     the measured minutes replace the planned ones beside the measured number,
     rather than a row reading "1h 20m" from the plan next to a load from a
     ride that took an hour (Jon's call, 2026-08-06). The plan's own figures
     stay one tap deeper, in the detail sheet. */
  const recordedShape = (shown, rec) => {
    const mins = Math.round((rec.movingTimeSec || 0) / 60);
    return mins ? { ...shown, durationMin: mins, distance: null } : shown;
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
        {/* Stepping mid-drag unmounts the day cards under the finger, so the
            grip's pointerup never arrives and the ghost is stranded over a
            week that is no longer there. The segbar has carried this guard
            since the drag moved here; the arrows are the other way out. */}
        <button className="cal-nav" type="button" disabled={!canPrev}
          aria-label={range === 'week' ? 'Previous week' : 'Previous month'}
          onClick={() => { cancelDrag(); setAnchor(step(-1)); setSelected(null); }}>‹</button>
        <div className="ttl">{range === 'season' ? seasonLabel : range === 'week' ? weekLabel : grid.label}
          {range === 'month' && monthSub && <div className="sub">{monthSub}</div>}
          {range === 'season' && seasonSub && <div className="sub">{seasonSub}</div>}</div>
        <button className="cal-nav" type="button" disabled={!canNext}
          aria-label={range === 'week' ? 'Next week' : 'Next month'}
          onClick={() => { cancelDrag(); setAnchor(step(1)); setSelected(null); }}>›</button>
      </div>
      <div className="segbar" role="tablist" aria-label="Calendar range">
        {RANGES.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={range === k}
            className={range === k ? 'on' : ''}
            /* a second finger can switch range mid-drag, unmounting the
               captured grip: the ghost must not outlive its surface */
            onClick={() => { cancelDrag(); setRange(k); }}>{label}</button>
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
                  + (d && d === raceISO ? ' race' : '')}
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

      {range === 'season' && <SeasonPanel plan={plan} wellness={wellness} log={log}
        moves={moves} adjust={adjust} todayISO={todayISO} onOpenSettings={onOpenSettings} />}

      {range === 'week' && <>
        {weekHeader && <div className="wk-head">{weekHeader}</div>}
        {week.map(d => {
          const ws = (byDate[d] || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
          const hasActs = (actByDate[d] || []).length > 0;
          return (
            <div key={d} data-caldate={d}
              className={'card wk-day' + (d < todayISO ? ' past' : '') + (d === todayISO ? ' today' : '')
                + (drag && drag.over === d ? ' drop' : '')}>
              <div className="wd-when">
                <div className="wd-dow">{T.fmtDate(d, { weekday: 'short' }).toUpperCase()}</div>
                <div className="wd-num">{Number(d.slice(8))}</div>
              </div>
              <div className="wd-rows">
                {ws.map(w => {
                  const row = (load.days[d].sessions || []).find(x => x.w.id === w.id);
                  const shown = row ? row.shown : easedOf(w);
                  return (
                    <div className="cal-row" key={w.id}>
                      {/* pointer-only grip, aria-hidden: the accessible
                          reschedule path is the detail sheet's day picker */}
                      {!w.race && !w.bRace && <div className="drag-handle" aria-hidden="true"
                        onPointerDown={e => startDrag(w, e)} onPointerMove={moveDrag}
                        onPointerUp={endDrag} onPointerCancel={cancelDrag}>
                        <Icon name="grip" size={17} /></div>}
                      <WorkoutRow w={row && row.recording ? recordedShape(shown, row.recording) : shown}
                        done={!!log[w.id]} eff={effDate(w, moves)}
                        moved={effDate(w, moves) !== w.date} onClick={() => open(w)} onToggle={() => onToggleWorkout(w.id)}
                        /* The A race's durationMin is a placeholder — WorkoutRow
                           suppresses its duration for the same reason — so a load
                           estimated off it would be invented. Its recordings still
                           count: they arrive as their own rows, each carrying what
                           it actually measured. Tune-ups keep theirs; they have
                           real durations. */
                        right={w.race ? null : <LoadSlot tss={row ? row.tss : T.estimateTss(shown)} measured={!!row && row.measured} />} />
                    </div>
                  );
                })}
                <RecordedActivities bare activities={activities} date={d} plan={plan} log={log} moves={moves}
                  ledger={load.days[d].ledger}
                  onOpen={onOpenRecording} />
                {!ws.length && !hasActs && <div className="wd-none">{tracker ? 'Nothing recorded.'
                  : d < planStart ? 'Before this plan began.'
                    : d > planEnd ? 'After this plan ends.' : 'Rest day'}</div>}
              </div>
            </div>
          );
        })}
      </>}

      {range === 'month' && selected && <>
        <div className="section-title">{T.fmtDate(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        {!((tracker || selected < planStart) && dayActs.length > 0) && <div className="card">
          {daySessions.length === 0
            ? <div className="empty" style={{ padding: '18px 8px' }}>{tracker ? 'Nothing recorded.'
              : selected < planStart ? 'Before this plan began.'
                : 'Nothing planned — rest, or add a session below.'}</div>
            : daySessions.map(w => {
              /* The same number the week range shows. The right slot used to
                 repeat the weekday the section title above already gives, so
                 one surface priced a session and the other named a day the
                 athlete had just tapped. */
              const row = (gridSpan[selected] ? gridSpan[selected].rows : []).find(x => x.w.id === w.id);
              const shown = easedOf(w);
              const priced = sessionLoad({ shown, entry: log[w.id], recording: row && row.recording });
              return <WorkoutRow key={w.id} w={shown} done={!!log[w.id]} eff={effDate(w, moves)}
                moved={effDate(w, moves) !== w.date} onClick={() => open(w)} onToggle={() => onToggleWorkout(w.id)}
                right={w.race ? null : <LoadSlot tss={priced.tss} measured={priced.measured} />} />;
            })}
        </div>}
        <RecordedActivities activities={activities} date={selected} plan={plan} log={log} moves={moves}
          ledger={gridSpan[selected]}
          onOpen={onOpenRecording} noHeading={tracker} />
      </>}

      {/* One card per sport, full discipline colour with the icon front and
          centre (Jon, 2026-07-17): tap to open the add sheet with that sport
          preselected and the selected day as the target; the sheet's library
          list carries the type choice. In plan mode this schedules a custom
          workout; in tracker mode App routes it to the manual-log flavour. */}
      {/* Season has no add-a-session row: the design does not draw one, and
          with no day on screen there is no honest target for it. */}
      {onAddWorkout && range !== 'season' && (() => {
        // Plan mode clamps into the plan window: edge months show tappable
        // off-plan days, and addCustomWorkout files any out-of-window date
        // under the LAST week (gauntlet 2026-07-16). Tracker's browse window
        // already covers any day worth logging.
        /* The target must be a day the athlete can SEE. The week range has no
           selected day, and the month range clears its selection when the
           arrows step, so falling back to today files a session onto a day
           that left the screen the moment they browsed away. Both ranges
           therefore prefer today when today is on screen and the shown
           period's first day otherwise. */
        const shownFirst = range === 'week' ? week[0] : grid.cells.find(Boolean);
        const onScreen = range === 'week'
          ? (todayISO >= week[0] && todayISO <= week[6])
          : ym(todayISO) === ym(anchor);
        const want = range === 'week'
          ? (onScreen ? todayISO : shownFirst)
          : (selected || (onScreen ? todayISO : shownFirst));
        const addTarget = tracker ? want : clampDay(want);
        /* And it must be an HONEST target. Clamping silently files a session
           under planStart/planEnd, so browsing before or after the plan shows
           four inviting cards that put the session on a day the athlete is
           not looking at; and race day is the third path onto the race that
           the drag and the sheet's picker already refuse (calendar audit,
           2026-08-06). Where there is no honest target, the row is simply
           absent — the same rule the season range already follows. */
        if (addTarget !== want || addTarget === raceISO) return null;
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
