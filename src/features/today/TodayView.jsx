import { useState } from 'react';
import * as T from '@/lib';
import { effDate, weekRange } from '@/lib/schedule.js';
import { paceSuggestions } from '@/lib/tuning.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { ReadinessCard } from '@/features/wellness/ReadinessCard.jsx';
const D = T.DISCIPLINES;

// The user's expand/collapse choice for the week tab sticks across visits.
const WEEK_PREF = 'try.showWeek';
const loadWeekPref = () => { try { return JSON.parse(localStorage.getItem(WEEK_PREF)); } catch (e) { return null; } };
const saveWeekPref = v => { try { localStorage.setItem(WEEK_PREF, JSON.stringify(v)); } catch (e) {} };

/* One glanceable card for the rest of the week: a 7-day strip of discipline
   dots (faded = logged, gold = race day, dash = rest), tap to fold out the
   remaining sessions in full detail. Replaces the old separate "Week N of M"
   card and always-open "Coming up" list. */
function WeekOverview({ plan, log, moves, open, easedOf, todayISO }) {
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
      <div className="wt-head" {...tap(toggle)}>
        <div>
          <div className="wt-title">This week</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Week {curWeek.index + 1} of {plan.totalWeeks} · {curWeek.phase} · {T.fmtDuration(curWeek.totalMin)} planned
          </div>
        </div>
        <div className="spacer" />
        <span className="wt-chev">{openWk ? '▾' : '▸'}</span>
      </div>
      <div className="wt-strip" {...tap(toggle)}>
        {days.map(d => {
          const ws = byDay(d);
          return (
            <div key={d} className={'wt-day' + (d === todayISO ? ' today' : '') + (d < todayISO ? ' past' : '')}>
              <div className="wt-lab">{T.fmtDate(d, { weekday: 'short' }).slice(0, 1)}</div>
              <div className="wt-dots">
                {ws.length === 0 ? <i className="wt-rest" />
                  : ws.slice(0, 3).map(w => <i key={w.id}
                    style={{ background: w.race ? '#facc15' : D[w.discipline].color, opacity: log[w.id] ? 0.35 : 1 }} />)}
              </div>
            </div>
          );
        })}
      </div>
      {openWk && (upcoming.length
        ? upcoming.map(w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)}
          moved={effDate(w, moves) !== w.date} onClick={() => open(w)} />)
        : <div className="muted" style={{ fontSize: 13, padding: '10px 2px 2px' }}>Nothing more this week — rest up.</div>)}
    </div>
  );
}

export function TodayView({ plan, log, moves, open, onCatchUp, onTune, wellness, onEditWellness, easedOf, onEaseToday, onRestoreToday, weekly, onWeekly, spotted, onLogSpotted }) {
  const todayISO = T.iso(new Date());
  const all = plan.weeks.flatMap(w => w.workouts);
  const sessions = all.filter(w => w.discipline !== 'rest' && !w.race);
  const today = all.filter(w => effDate(w, moves) === todayISO);
  const weekStart = weekRange(todayISO)[0];
  const missed = sessions.filter(w => { const d = effDate(w, moves); return d < todayISO && d >= weekStart && !log[w.id]; });
  const suggestions = paceSuggestions(plan, log);
  const row = w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} />;

  return (
    <>
      <div className="section-title">Today's readiness</div>
      <ReadinessCard wellness={wellness} today={today.map(w => ({ ...easedOf(w), done: !!log[w.id] }))}
        onEdit={onEditWellness} onEase={onEaseToday} onRestore={onRestoreToday} onOpen={open} />
      {weekly && (() => {
        // banner skin per proposal kind: trims wear the amber ramp variant,
        // the build nudge wears the green tune variant, restores stay blue
        const skin = { 'trim-week': ['banner ramp', 'trend'], 'boost-week': ['banner tune', 'flame'], 'restore-week': ['banner', 'bolt'], 'catch-up': ['banner', 'bolt'] };
        const [cls, icon] = skin[weekly.kind] || ['banner', 'bolt'];
        return (
          <div className={cls} {...tap(() => onWeekly(weekly))}>
            <div className="bi"><Icon name={icon} size={20} /></div>
            <div><div className="bt">{weekly.headline}</div>
              <div className="bs">{weekly.why} Tap to apply →</div></div>
          </div>
        );
      })()}
      {spotted && spotted.length > 0 && <div className="banner" {...tap(onLogSpotted)}>
        <div className="bi"><Icon name="watch" size={20} /></div>
        <div><div className="bt">{spotted.length === 1 ? 'Session spotted on your watch' : spotted.length + ' sessions spotted on your watch'}</div>
          <div className="bs">{spotted.map(m => m.workout.title).join(' · ')} — tap to log {spotted.length === 1 ? 'it' : 'them'} →</div></div>
      </div>}
      {missed.length > 0 && (!weekly || weekly.kind !== 'catch-up') && <div className="banner" {...tap(onCatchUp)}>
        <div className="bi"><Icon name="bolt" size={20} /></div>
        <div><div className="bt">{missed.length} session{missed.length > 1 ? 's' : ''} missed this week</div>
          <div className="bs">Tap to reschedule onto your free days →</div></div>
      </div>}
      {suggestions.length > 0 && <div className="banner tune" {...tap(onTune)}>
        <div className="bi"><Icon name="pace" size={20} /></div>
        <div><div className="bt">Time to tune your paces</div>
          <div className="bs">{suggestions.map(s => D[s.discipline].name + (s.direction === 'faster' ? ' feels easy' : ' feels hard')).join(' · ')} — tap to adjust →</div></div>
      </div>}
      <div className="section-title">Today · {T.fmtDate(todayISO, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      <div className="card">
        {today.length === 0 ? <div className="empty"><div className="big"><Icon name="rest" size={40} /></div>No session scheduled today.</div>
          : today.map(row)}
      </div>
      <WeekOverview plan={plan} log={log} moves={moves} open={open} easedOf={easedOf} todayISO={todayISO} />
    </>
  );
}
