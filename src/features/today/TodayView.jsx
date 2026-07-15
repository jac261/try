import { useState } from 'react';
import * as T from '@/lib';
import { effDate, weekRange } from '@/lib/schedule.js';
import { paceSuggestions } from '@/lib/tuning.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { ReadinessCard } from '@/features/wellness/ReadinessCard.jsx';
import { RecordedActivities } from '@/components/RecordedActivities.jsx';
import { WeeklyDigest } from '@/features/today/WeeklyDigest.jsx';
const D = T.DISCIPLINES;

// The user's expand/collapse choice for the week tab sticks across visits.
const WEEK_PREF = 'try.showWeek';
const loadWeekPref = () => { try { return JSON.parse(localStorage.getItem(WEEK_PREF)); } catch (e) { return null; } };
const saveWeekPref = v => { try { localStorage.setItem(WEEK_PREF, JSON.stringify(v)); } catch (e) {} };

/* One glanceable card for the rest of the week: a 7-day strip of discipline
   dots (faded = logged, gold = race day, dash = rest), tap to fold out the
   remaining sessions in full detail. Replaces the old separate "Week N of M"
   card and always-open "Coming up" list. */
function WeekOverview({ plan, log, moves, open, easedOf, todayISO, onToggleWorkout }) {
  const [openWk, setOpenWk] = useState(() => loadWeekPref() === true);
  const toggle = () => setOpenWk(o => { saveWeekPref(!o); return !o; });
  const days = weekRange(todayISO);
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest');
  const byDay = d => all.filter(w => effDate(w, moves) === d);
  const curWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
  const upcoming = all.filter(w => { const d = effDate(w, moves); return !w.race && d > todayISO && d <= days[6]; })
    .sort((a, b) => effDate(a, moves) < effDate(b, moves) ? -1 : 1);
  return (
    <div className="card week-tab">
      <div className="wt-head" {...tap(toggle)} aria-expanded={openWk}
        aria-label={'This week, week ' + (curWeek.index + 1) + ' of ' + plan.totalWeeks + ': show remaining sessions'}>
        <div>
          <div className="wt-title">This week</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Week {curWeek.index + 1} of {plan.totalWeeks} · {curWeek.phase} · {T.fmtDuration(curWeek.totalMin)} planned
          </div>
        </div>
        <div className="spacer" />
        <span className="wt-chev">{openWk ? '▾' : '▸'}</span>
      </div>
      {/* strip background is a pointer-only shortcut to toggle; each day cell is
          the keyboard/screen-reader path (avoids a button-inside-a-button). */}
      <div className="wt-strip" onClick={toggle}>
        {days.map(d => {
          const ws = byDay(d);
          const logged = ws.filter(w => log[w.id]).length;
          return (
            <div key={d} className={'wt-day' + (d === todayISO ? ' today' : '') + (d < todayISO ? ' past' : '')}
              aria-label={T.fmtDate(d, { weekday: 'long' }) + ': ' + (ws.length === 0 ? 'rest day'
                : ws.map(w => w.title).join(' and ') + (logged ? ', ' + logged + ' logged' : ''))}
              {...tap(e => { e.stopPropagation(); if (ws.length) open(ws[0]); else toggle(); })}>
              <div className="wt-lab">{T.fmtDate(d, { weekday: 'short' }).slice(0, 1)}</div>
              <div className="wt-dots">
                {ws.length === 0 ? <i className="wt-rest" />
                  : ws.slice(0, 3).map(w => <i key={w.id} className={log[w.id] ? 'done' : ''}
                    style={{ background: w.race || w.bRace ? '#facc15' : D[w.discipline].color }} />)}
              </div>
            </div>
          );
        })}
      </div>
      {openWk && (upcoming.length
        ? upcoming.map(w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)}
          moved={effDate(w, moves) !== w.date} onClick={() => open(w)} onToggle={() => onToggleWorkout(w.id)} />)
        : <div className="muted" style={{ fontSize: 13, padding: '10px 2px 2px' }}>Nothing more this week — rest up.</div>)}
    </div>
  );
}

export function TodayView({ plan, log, moves, open, onTune, wellness, onFeel, onEditWellness, easedOf, onEaseToday, onRestoreToday, weekly, onWeekly, spotted, onLogSpotted, onAddWorkout, eftp, onEftp, onToggleWorkout, planEdge, onSupport, activities, recovery, onOpenRecording, onEditPlan, onEnterTracker, offerTracker, adjust, adjustLog, storage }) {
  const tracker = plan.race === 'tracker';
  const todayISO = T.iso(new Date());
  const all = plan.weeks.flatMap(w => w.workouts);
  const sessions = all.filter(w => w.discipline !== 'rest' && !w.race);
  const today = all.filter(w => effDate(w, moves) === todayISO);
  const suggestions = paceSuggestions(plan, log);
  const [coachIdx, setCoachIdx] = useState(0);
  const [reviewToday, setReviewToday] = useState(false);
  const row = w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} profile onToggle={() => onToggleWorkout(w.id)} />;

  // One coach voice at a time: every possible nudge queues into a single slot,
  // most important first; a counter chip cycles through the rest. Applying a
  // suggestion clears its condition, so the queue drains itself.
  const coach = [];
  // Tracker mode: the only card is the prompt to start the next plan. The
  // engine cards below are all empty here (no weeks to reason about) but we
  // build only this one to be certain. Copy is honest per connection state:
  // without a feed, nothing is being "spotted" and the card must not claim it.
  const connected = !!activities;
  if (tracker) coach.push({
    key: 'no-plan', cls: 'banner tune', icon: 'clipboard',
    title: 'Ready for your next plan?',
    sub: connected
      ? 'You are in tracker mode. Sessions from your watch land below and on your calendar. Tap to start your next plan.'
      : 'You are in tracker mode. When you are ready for structure again, tap to start your next plan.',
    act: onEditPlan,
  });
  // The plan's own edges (race just passed / maintenance block ending)
  // outrank everything: they decide what the plan even is next.
  if (!tracker && planEdge) coach.push({ key: planEdge.key, cls: 'banner tune', icon: planEdge.icon, title: planEdge.title, sub: planEdge.sub, act: planEdge.act });
  // A maintenance block near its end can also just stop into tracker mode; offer
  // it as a second card the athlete can cycle to.
  if (!tracker && offerTracker) coach.push({
    key: 'just-track', cls: 'banner', icon: 'clipboard',
    title: 'Or just track for now',
    sub: (connected
      ? 'Stop the plan and take a break from structure. Sessions from your watch still land on your calendar.'
      : 'Stop the plan and take a break from structure.')
      + ' Your fitness history is kept. Tap to switch to tracker mode.',
    act: onEnterTracker,
  });
  if (!tracker && weekly) {
    const skin = { 'trim-week': ['banner ramp', 'trend'], 'boost-week': ['banner tune', 'flame'], 'restore-week': ['banner', 'bolt'] };
    const [cls, icon] = skin[weekly.kind] || ['banner', 'bolt'];
    coach.push({ key: 'weekly', cls, icon, title: weekly.headline, sub: weekly.why + ' Tap to apply →', act: () => onWeekly(weekly) });
  }
  if (!tracker && spotted && spotted.length > 0) coach.push({
    key: 'spotted', cls: 'banner', icon: 'watch',
    title: spotted.length === 1 ? 'Session spotted on your watch' : spotted.length + ' sessions spotted on your watch',
    sub: spotted.map(m => m.workout.title).join(' · ') + ' — tap to log ' + (spotted.length === 1 ? 'it' : 'them') + ' →', act: onLogSpotted,
  });
  if (!tracker && eftp) coach.push({ key: 'eftp', cls: eftp.up ? 'banner tune' : 'banner ramp', icon: 'trend', title: eftp.headline, sub: eftp.why + ' Tap to retarget →', act: onEftp });
  if (!tracker && suggestions.length > 0) coach.push({
    key: 'tune', cls: 'banner tune', icon: 'pace', title: 'Time to tune your paces',
    sub: suggestions.map(s => D[s.discipline].name + (s.direction === 'faster' ? ' feels easy' : ' feels hard')).join(' · ') + ' — tap to adjust →', act: onTune,
  });
  const slot = coach.length ? coach[coachIdx % coach.length] : null;

  // Closing the loop: when today's training is logged (or it is a rest day),
  // answer the evening question — what's next?
  const todayReal = today.filter(w => w.discipline !== 'rest' && !w.race);
  const allDone = todayReal.length > 0 && todayReal.every(w => log[w.id]);
  const next = sessions.filter(w => effDate(w, moves) > todayISO)
    .sort((a, b) => effDate(a, moves) < effDate(b, moves) ? -1 : 1)[0];
  const restDay = todayReal.length === 0;

  return (
    <>
      <div className="section-title">Today · {T.fmtDate(todayISO, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      <ReadinessCard wellness={wellness} today={today.map(w => ({ ...easedOf(w), done: !!log[w.id] }))} noPlan={tracker}
        onEdit={onEditWellness} onFeel={onFeel} onEase={onEaseToday} onRestore={onRestoreToday} onOpen={open} onSupport={onSupport} recovery={recovery} />
      {slot && <div className={slot.cls} {...tap(slot.act)}>
        <div className="bi"><Icon name={slot.icon} size={20} /></div>
        <div style={{ flex: 1 }}><div className="bt">{slot.title}</div>
          <div className="bs">{slot.sub}</div></div>
        {coach.length > 1 && <div className="bmore" aria-hidden="true"
          onClick={e => { e.stopPropagation(); setCoachIdx(i => i + 1); }}>
          {(coachIdx % coach.length) + 1}/{coach.length} ▸</div>}
      </div>}
      <div className="card">
        {allDone && !reviewToday
          ? <div className="today-done">
            <div className="td-tick">✓</div>
            <div className="td-t">Done for today</div>
            <div className="td-s">{todayReal.map(w => easedOf(w).title).join(' · ')} logged</div>
            <a className="reset" {...tap(() => setReviewToday(true))}>Review</a>
          </div>
          : today.length === 0
            ? <div className="empty"><div className="big"><Icon name="rest" size={40} /></div>{tracker ? 'No plan running.' : 'No session scheduled today.'}</div>
            : today.map(row)}
        {(allDone || restDay) && next && <div className="tmrw" {...tap(() => open(next))}
          aria-label={'Next up, ' + T.fmtDate(effDate(next, moves), { weekday: 'long' }) + ': ' + easedOf(next).title + '. Open details'}>
          <Icon name="calendar" size={15} />
          <span>Next up · {T.fmtDate(effDate(next, moves), { weekday: 'long' })}: <b>{easedOf(next).title}</b> · {T.fmtDuration(easedOf(next).durationMin || 0)}</span>
        </div>}
        {!tracker && <div className="add-row" {...tap(onAddWorkout)}><Icon name="plus" size={15} /> Add a session</div>}
      </div>
      <RecordedActivities activities={activities} date={todayISO} plan={plan} log={log} moves={moves} onOpen={onOpenRecording} />
      {storage && <WeeklyDigest plan={plan} log={log} moves={moves} adjust={adjust} adjustLog={adjustLog}
        wellness={wellness} activities={activities} storage={storage} todayISO={todayISO} />}
      {!tracker && <WeekOverview plan={plan} log={log} moves={moves} open={open} easedOf={easedOf} todayISO={todayISO} onToggleWorkout={onToggleWorkout} />}
    </>
  );
}
