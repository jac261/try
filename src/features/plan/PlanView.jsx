import { useMemo, useState } from 'react';
import * as T from '@/lib';
import { effDate } from '@/lib/schedule.js';
import { tap } from '@/utils/a11y.js';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';
import { Icon } from '@/components/Icon.jsx';
const D = T.DISCIPLINES;

/* The plan tab owns the whole programme: the phase overview, then every week
   as an expandable card (moved here from the old calendar tab, which is now a
   real month calendar). */
export function PlanView({ plan, log, moves, open, easedOf, onToggleWorkout, onSupport, onEditPlan, onStartMaintenance , onFocus }) {
  // Tracker mode: no programme to show, just the way back into one.
  if (plan.race === 'tracker') return (
    <>
      <div className="section-title">Plan</div>
      <div className="card" style={{ textAlign: 'center', padding: '26px 18px' }}>
        <div className="empty" style={{ padding: 0, marginBottom: 14 }}>
          <div className="big"><Icon name="nextplan" size={64} /></div>No plan active
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.5, margin: '0 0 18px' }}>
          You are just tracking right now. When you are ready, I will build your next plan around your fitness and your dates.
        </p>
        <button className="btn primary" onClick={onEditPlan}><Icon name="calendar" size={18} /> Start a plan</button>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={onStartMaintenance}><Icon name="flame" size={18} /> Start a maintenance block</button>
      </div>
    </>
  );
  // Every week card starts folded: the tab loads tidy and the athlete opens
  // what they want to read (Jon, 2026-07-16).
  const [openWeek, setOpenWeek] = useState(-1);

  const race = T.RACES[plan.race];
  // The scheduled post-race recovery week (always the last week, isRecovery,
  // race plans only) displays as its own 'Recovery' group and is excluded from
  // the "N-week build" headline — the build is the build.
  const hasRecoveryWeek = !race.noRace && plan.weeks.length > 0 && plan.weeks[plan.weeks.length - 1].isRecovery;
  const buildLen = plan.totalWeeks - (hasRecoveryWeek ? 1 : 0);
  const phaseGroups = useMemo(() => T.phaseGroups(plan), [plan]);
  // display-and-coach-only: the declared focus labels blocks; the limiter
  // keeps actuating, and when they disagree both are said plainly
  const solo = race.solo || null;
  const fx = T.resolveFocus(plan.profile, T.weakestLink({ profile: plan.profile }), solo);
  const [fxOpen, setFxOpen] = useState(false);
  const totalHrs = Math.round(plan.weeks.reduce((a, b) => a + b.totalMin, 0) / 60);

  return (
    <>
      <div className="section-title"><InfoLink onOpen={onSupport} topic="plan-structure" />Plan overview</div>
      <div className="card">
        <h2>{race.noRace ? 'Maintenance block' : race.name + (race.solo ? '' : ' Triathlon')}</h2>
        <p className="lead">{buildLen}-week {race.noRace ? 'block' : 'build'}{hasRecoveryWeek ? ' + recovery week' : ''} · {totalHrs} total training hours · {plan.profile.daysPerWeek} days/week</p>
        {plan.shortRunway && <p className="lead" style={{ color: '#fde68a', fontSize: 13 }}>
          Short runway: fewer weeks than the recommended minimum for this distance, so this plan sharpens what you have rather than building from scratch.</p>}
        {plan.leadIn > 0 && <p className="lead" style={{ color: '#9ab8ff', fontSize: 13 }}>
          Your race is beyond the ideal build window, so the first {plan.leadIn} {plan.leadIn === 1 ? 'week is' : 'weeks are'} maintenance — the real build starts after.</p>}
        {phaseGroups.map((g, i) => {
          const pi = T.PHASE_INFO[g.phase];
          return (
            <div className="seg" key={i} style={{ alignItems: 'center' }}>
              <div className="bar" style={{ background: pi.color, height: 38 }} />
              <div><div className="l">{g.phase} <span className="muted">· {g.weeks} {g.weeks === 1 ? 'week' : 'weeks'}</span>{(() => {
                const fc = solo ? null : T.focusClause(g.phase, fx.focus);
                return fc ? <span className="muted"> · {fc}</span> : null;
              })()}</div>
                <div className="d">{pi.blurb}</div></div>
              <div className="m">{T.fmtDuration(g.min)}</div>
            </div>
          );
        })}
        {(() => {
          // Legend keys only what the plan actually schedules; a run-only
          // legend is one swatch explaining nothing, so it hides entirely.
          const present = ['swim', 'bike', 'run', 'brick'].filter(k =>
            plan.weeks.some(wk => wk.workouts.some(w => w.discipline === k)));
          return present.length >= 2 ? <div className="legend" style={{ marginTop: 12 }}>
            {present.map(k => (
              <div className="li" key={k}><i style={{ background: D[k].color }} />{D[k].name}</div>
            ))}
          </div> : null;
        })()}
        {fx.diverges && <div className="focus-note">Focus: {T.FOCUS_OPTIONS[fx.focus]}, your call. The plan's extra work still goes to {T.FOCUS_OPTIONS[fx.derived]}, your limiter.</div>}
        {onFocus && !solo && !fxOpen && <a className="reset" role="button" {...tap(() => setFxOpen(true))} style={{ display: 'inline-block', marginTop: 6 }}>Change what this plan is about</a>}
        {onFocus && !solo && fxOpen && <div className="feel-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {Object.entries(T.FOCUS_OPTIONS)
            .filter(([k]) => k === 'general' || plan.profile.excludedDiscipline !== k)
            .map(([k, lab]) => <button key={k} className="feelbtn" style={{ flex: '1 1 45%' }}
              onClick={() => { onFocus(k === 'general' ? null : k); setFxOpen(false); }}>{k === 'general' ? 'Everything evenly' : 'Focus on ' + lab}</button>)}
        </div>}
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
