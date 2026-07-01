import { useMemo } from 'react';
import * as T from '@/lib';
const D = T.DISCIPLINES;

export function PlanView({ plan }) {
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
      <div className="section-title">Plan overview</div>
      <div className="card">
        <h2>{race.name} Triathlon</h2>
        <p className="lead">{plan.totalWeeks}-week build · {totalHrs} total training hours · {plan.profile.daysPerWeek} days/week</p>
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
      </div>
      <div className="section-title">How your week is structured</div>
      <div className="card">
        <p className="lead">Built from your {plan.profile.daysPerWeek} available days, balancing all three disciplines with key long & brick sessions on weekends.</p>
        <div className="legend">
          {['swim', 'bike', 'run', 'brick'].map(k => (
            <div className="li" key={k}><i style={{ background: D[k].color }} />{D[k].name}</div>
          ))}
        </div>
      </div>
    </>
  );
}
