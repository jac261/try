import * as T from '@/lib';
import { effDate, weekRange } from '@/lib/schedule.js';
import { paceSuggestions } from '@/lib/tuning.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { ReadinessCard } from '@/features/wellness/ReadinessCard.jsx';
const D = T.DISCIPLINES;

export function TodayView({ plan, log, moves, open, onCatchUp, onTune, wellness, onEditWellness, easedOf, onEaseToday, onRestoreToday, weekly, onWeekly, spotted, onLogSpotted }) {
  const todayISO = T.iso(new Date());
  const all = plan.weeks.flatMap(w => w.workouts);
  const sessions = all.filter(w => w.discipline !== 'rest' && !w.race);
  const today = all.filter(w => effDate(w, moves) === todayISO);
  const upcoming = sessions.filter(w => effDate(w, moves) > todayISO)
    .sort((a, b) => effDate(a, moves) < effDate(b, moves) ? -1 : 1).slice(0, 4);
  const curWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
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
      {curWeek && <div className="card">
        <div className="row"><div><h2 style={{ margin: 0 }}>Week {curWeek.index + 1} of {plan.totalWeeks}</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{curWeek.phase} · {T.PHASE_INFO[curWeek.phase].blurb}</div></div>
          <div className="spacer" /><div className="center"><div style={{ fontSize: 22, fontWeight: 700 }}>{T.fmtDuration(curWeek.totalMin)}</div>
            <div className="muted" style={{ fontSize: 11 }}>planned</div></div></div>
      </div>}
      <div className="section-title">Coming up</div>
      <div className="card">
        {upcoming.length ? upcoming.map(row)
          : <div className="empty"><div className="big"><Icon name="trophy" size={40} /></div>All done — race time!</div>}
      </div>
    </>
  );
}
