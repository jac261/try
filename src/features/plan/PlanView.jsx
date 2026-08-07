import { useMemo, useState } from 'react';
import * as T from '@/lib';
import { effDate } from '@/lib/schedule.js';
import { isDone } from '@/lib/api.js';
import { tap } from '@/utils/a11y.js';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { InfoLink } from '@/components/InfoLink.jsx';
import { Icon } from '@/components/Icon.jsx';
const D = T.DISCIPLINES;

/* The plan tab owns the whole programme: the phase overview, then every week
   as an expandable card (moved here from the old calendar tab, which is now a
   real month calendar). */
export function PlanView({ plan, log, moves, open, easedOf, onToggleWorkout, onSupport, onEditPlan, onStartMaintenance, onFocus }) {
  /* EVERY hook above the tracker return. They sat below it — a
     rules-of-hooks violation that React's runtime happens to tolerate in
     this exact shape (a ZERO-hook early return advances no hook cursor, so
     the fewer-hooks invariant never fires), which makes it worse, not
     better: the first hook anyone adds above the return arms a real crash
     on the enterTracker flip, the one plan.race change with no splash
     unmount in front of it (audit 2026-08-07). Runtime cannot see this, so
     the source pin in PlanView.test.jsx is the guard. */
  // Every week card starts folded: the tab loads tidy and the athlete opens
  // what they want to read (Jon, 2026-07-16).
  const [openWeek, setOpenWeek] = useState(-1);
  const [fxOpen, setFxOpen] = useState(false);
  /* Closing the chooser puts keyboard focus back on the trigger it grew
     from: opening unmounts the focused link and choosing unmounts the
     buttons, so focus fell to document.body twice per visit (audit IA-5). */
  const closeChooser = () => {
    setFxOpen(false);
    requestAnimationFrame(() => { const t = document.getElementById('fx-trigger'); if (t) t.focus(); });
  };
  const phaseGroups = useMemo(() => T.phaseGroups(plan), [plan]);
  const race = T.RACES[plan.race];
  // display-and-coach-only: the declared focus labels blocks; the limiter
  // keeps actuating, and when they disagree both are said plainly.
  // Memoised beside phaseGroups: weakestLink walks the ladder tables and was
  // recomputed on every render while its sibling memo watched (audit SE-7).
  const solo = race.solo || null;
  const fx = useMemo(() => T.resolveFocus(plan.profile, T.weakestLink({ profile: plan.profile }), solo),
    [plan, solo]);

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
  /* ONE phase boundary. hasRecoveryWeek reads the shared weekPhaseLabel
     rather than re-deriving the rule — the drift the helper's own comment
     was written to end, and this file was the consumer that never called
     it. The relabel now also covers a postRace block's baked-in week-1
     recovery, so the overview, the headline and the week cards agree there
     too. */
  const lastWeek = plan.weeks[plan.weeks.length - 1];
  const hasRecoveryWeek = !!lastWeek && T.weekPhaseLabel(plan, lastWeek) === 'Recovery';
  // The headline stops counting weeks it disowns one line later: lead-in
  // maintenance weeks are not build, and the note under this line says so.
  const buildLen = plan.totalWeeks - (hasRecoveryWeek ? 1 : 0) - (plan.leadIn || 0);
  const totalMin = plan.weeks.reduce((a, b) => a + b.totalMin, 0);

  return (
    <>
      <div className="section-title"><InfoLink onOpen={onSupport} topic="plan-structure" />Plan overview</div>
      <div className="card">
        <h2>{race.noRace ? 'Maintenance block' : race.name + (race.solo ? '' : ' Triathlon')}</h2>
        <p className="lead">{plan.leadIn > 0 ? plan.leadIn + '-week lead-in + ' : ''}{buildLen}-week {race.noRace ? 'block' : 'build'}{hasRecoveryWeek ? ' + recovery week' : ''} · {T.fmtDuration(totalMin)} training · {plan.profile.daysPerWeek} days/week</p>
        {plan.shortRunway && <p className="lead note-warn">
          Short runway: fewer weeks than the recommended minimum for this distance, so this plan sharpens what you have rather than building from scratch.</p>}
        {plan.leadIn > 0 && <p className="lead note-info">
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
        {onFocus && !solo && !fxOpen && <a className="reset" role="button" id="fx-trigger"
          {...tap(() => setFxOpen(true))} style={{ display: 'inline-block', marginTop: 6 }}>Change what this plan is about</a>}
        {onFocus && !solo && fxOpen && <div style={{ marginTop: 8 }}
          onKeyDown={e => { if (e.key === 'Escape') closeChooser(); }}>
          {/* Honest at CHOOSE time, not only after a divergence exists: the
              focus is labels and coach language by design (2026-07-21), and
              this line is where the athlete learns it. */}
          <p className="lead" style={{ fontSize: 13, margin: '0 0 8px' }}>
            This changes what the blocks are called and what the coach talks about.
            The plan's extra work still follows your limiter.</p>
          <div className="feel-row" style={{ flexWrap: 'wrap' }}>
            {Object.entries(T.FOCUS_OPTIONS)
              .filter(([k]) => k === 'general' || plan.profile.excludedDiscipline !== k)
              .map(([k, lab]) => {
                /* The current choice is marked, and re-choosing it just
                   closes: it used to fire a full plan push + splash for a
                   no-op. 'Everything evenly' stores 'general' rather than
                   null — null is "never declared", which silently reverted
                   the labels to the derived limiter and made the tap look
                   broken (audit SW-2). */
                return <button key={k} className={'feelbtn' + (fx.declared === k ? ' on' : '')} style={{ flex: '1 1 45%' }}
                  aria-pressed={fx.declared === k}
                  onClick={() => { if (fx.declared !== k) onFocus(k); closeChooser(); }}>
                  {k === 'general' ? 'Everything evenly' : 'Focus on ' + lab}</button>;
              })}
            <button className="feelbtn" style={{ flex: '1 1 45%' }}
              onClick={closeChooser}>Never mind</button>
          </div>
        </div>}
      </div>

      <div className="section-title"><InfoLink onOpen={onSupport} topic="workout-library" />Week by week</div>
      {plan.weeks.map(week => {
        const isOpen = week.index === openWeek;
        // the pill says what the overview says: one boundary (weekPhaseLabel),
        // not week.phase raw beside a Recovery tag reading differently
        const phaseLabel = T.weekPhaseLabel(plan, week);
        const pi = T.PHASE_INFO[phaseLabel];
        /* The A-race is excluded from the denominator: it can never be
           logged (every path blocks it), so race week's bar could never
           read complete and "4 sessions" counted the race as one (audit
           IA-7). The sort breaks effective-date ties by id so same-day
           doubles keep a stable order. */
        const sessions = week.workouts.filter(w => w.discipline !== 'rest' && !w.race);
        const doneCount = sessions.filter(w => isDone(log[w.id])).length;
        const ordered = week.workouts.slice().sort((a, b) => {
          const da = effDate(a, moves), db = effDate(b, moves);
          return da < db ? -1 : da > db ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        });
        return (
          <div className="card" key={week.index} style={{ padding: '14px 16px' }}>
            <div className="weekhdr" {...tap(() => setOpenWeek(isOpen ? -1 : week.index))} aria-expanded={isOpen} style={{ cursor: 'pointer' }}>
              <div><div className="ttl">Week {week.index + 1} {week.isRecovery && <span className="tag recovery">Recovery</span>}</div>
                <div className="muted" style={{ fontSize: 12 }}>{T.fmtDate(week.start, { month: 'short', day: 'numeric' })} · {doneCount > 0 ? doneCount + ' of ' + sessions.length + ' sessions done' : sessions.length + ' sessions'} · {T.fmtDuration(week.totalMin)}</div></div>
              <div className="ph" style={{ background: pi.color }}>{phaseLabel}</div>
            </div>
            {/* the bar is a progressbar to AT, and the count is said in
                text once anything is done — completion was width-only, so a
                screen reader had to expand every week and count rows */}
            <div className="weekbar" role="progressbar" aria-valuemin={0} aria-valuemax={sessions.length}
              aria-valuenow={doneCount} aria-label={'Sessions done, week ' + (week.index + 1)}>
              <span style={{ width: (sessions.length ? doneCount / sessions.length * 100 : 0) + '%', background: 'var(--accent)' }} /></div>
            {isOpen && <div style={{ marginTop: 8 }}>
              {/* profile strip deliberately omitted: this tab reads structure;
                  paces live one tap deeper in the sheet (Jon, 2026-08-07) */}
              {ordered.map(w => <WorkoutRow key={w.id} w={easedOf(w)} done={isDone(log[w.id])} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} onToggle={() => onToggleWorkout(w.id)} />)}
            </div>}
          </div>
        );
      })}
    </>
  );
}
