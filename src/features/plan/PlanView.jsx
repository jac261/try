import { useMemo, useState } from 'react';
import * as T from '@/lib';
import { effDate } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';
const D = T.DISCIPLINES;

/* The plan tab owns the whole programme: the phase overview, then every week
   as an expandable card (moved here from the old calendar tab, which is now a
   real month calendar). */
export function PlanView({ plan, log, moves, open, easedOf, onToggleWorkout, onSupport }) {
  const todayISO = T.iso(new Date());
  const firstFuture = plan.weeks.findIndex(w => w.workouts.some(x => x.date >= todayISO));
  const [openWeek, setOpenWeek] = useState(firstFuture < 0 ? 0 : firstFuture);

  const phaseGroups = useMemo(() => {
    const g = [];
    plan.weeks.forEach(w => {
      const last = g[g.length - 1];
      if (last && last.phase === w.phase) { last.weeks++; last.min += w.totalMin; }
      else g.push({ phase: w.phase, weeks: 1, min: w.totalMin, start: w.index });
    });
    return g;
  }, [plan]);
  const totalHrs = Math.round(plan.weeks.reduce((a, b) => a + b.totalMin, 0) / 60);
  const race = T.RACES[plan.race];

  return (
    <>
      <div className="section-title"><InfoLink onOpen={onSupport} topic="plan-structure" />Plan overview</div>
      <div className="card">
        <h2>{race.noRace ? 'Maintenance block' : race.name + ' Triathlon'}</h2>
        <p className="lead">{plan.totalWeeks}-week {race.noRace ? 'block' : 'build'} · {totalHrs} total training hours · {plan.profile.daysPerWeek} days/week</p>
        {plan.shortRunway && <p className="lead" style={{ color: '#fde68a', fontSize: 13 }}>
          Short runway: fewer weeks than the recommended minimum for this distance, so this plan sharpens what you have rather than building from scratch.</p>}
        {plan.leadIn > 0 && <p className="lead" style={{ color: '#9ab8ff', fontSize: 13 }}>
          Your race is beyond the ideal build window, so the first {plan.leadIn} {plan.leadIn === 1 ? 'week is' : 'weeks are'} maintenance — the real build starts after.</p>}
        {phaseGroups.map((g, i) => {
          const pi = T.PHASE_INFO[g.phase];
          return (
            <div className="seg" key={i} style={{ alignItems: 'center' }}>
              <div className="bar" style={{ background: pi.color, height: 38 }} />
              <div><div className="l">{g.phase} <span className="muted">· {g.weeks} {g.weeks === 1 ? 'week' : 'weeks'}</span></div>
                <div className="d">{pi.blurb}</div></div>
              <div className="m">{T.fmtDuration(g.min)}</div>
            </div>
          );
        })}
        <div className="legend" style={{ marginTop: 12 }}>
          {['swim', 'bike', 'run', 'brick'].map(k => (
            <div className="li" key={k}><i style={{ background: D[k].color }} />{D[k].name}</div>
          ))}
        </div>
      </div>

      <div className="section-title"><InfoLink onOpen={onSupport} topic="workout-library" />Week by week</div>
      {plan.weeks.map(week => {
        const isOpen = week.index === openWeek;
        const pi = T.PHASE_INFO[week.phase];
        const sessions = week.workouts.filter(w => w.discipline !== 'rest');
        const doneCount = sessions.filter(w => log[w.id]).length;
        const ordered = week.workouts.slice().sort((a, b) => effDate(a, moves) < effDate(b, moves) ? -1 : 1);
        return (
          <div className="card" key={week.index} style={{ padding: '14px 16px' }}>
            <div className="weekhdr" {...tap(() => setOpenWeek(isOpen ? -1 : week.index))} aria-expanded={isOpen} style={{ cursor: 'pointer' }}>
              <div><div className="ttl">Week {week.index + 1} {week.isRecovery && <span className="tag recovery">Recovery</span>}</div>
                <div className="muted" style={{ fontSize: 12 }}>{T.fmtDate(week.start, { month: 'short', day: 'numeric' })} · {sessions.length} sessions · {T.fmtDuration(week.totalMin)}</div></div>
              <div className="ph" style={{ background: pi.color }}>{week.phase}</div>
            </div>
            <div className="weekbar"><span style={{ width: (sessions.length ? doneCount / sessions.length * 100 : 0) + '%', background: 'var(--accent)' }} /></div>
            {isOpen && <div style={{ marginTop: 8 }}>
              {ordered.map(w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} onToggle={() => onToggleWorkout(w.id)} />)}
            </div>}
          </div>
        );
      })}
    </>
  );
}
