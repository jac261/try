import { useState } from 'react';
import * as T from '@/lib';
import { effDate } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';

export function CalendarView({ plan, log, moves, open, easedOf, onToggleWorkout }) {
  const todayISO = T.iso(new Date());
  const firstFuture = plan.weeks.findIndex(w => w.workouts.some(x => x.date >= todayISO));
  const [openWeek, setOpenWeek] = useState(firstFuture < 0 ? 0 : firstFuture);

  return (
    <>
      <div className="section-title">Training calendar</div>
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
