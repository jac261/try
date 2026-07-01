/* Try — React UI (Vite entry point).
   The domain layer lives in @/lib as plain ES modules; `T` is its namespace
   (T.iso, T.RACES, T.generatePlan, T.wellness, …) — the replacement for the old
   `window.TF` global, with load order now handled by the module graph. */
import './styles.css';
import { useState, useEffect, useMemo, Component } from 'react';
import { createRoot } from 'react-dom/client';
import * as T from '@/lib';
import { effDate, catchUpMoves } from '@/lib/schedule.js';
import { INTENSITY_TYPES, paceSuggestions, tuneFields } from '@/lib/tuning.js';
import { downloadICS } from '@/lib/ics.js';
import { LS, NS } from '@/app/storage.js';
import { Icon } from '@/components/Icon.jsx';
import { DetailSheet } from '@/components/DetailSheet.jsx';
import { Onboarding } from '@/features/onboarding/Onboarding.jsx';
import { BuildingPlan } from '@/features/onboarding/BuildingPlan.jsx';
import { FitnessEditor } from '@/features/settings/FitnessEditor.jsx';
import { PlanSettingsEditor } from '@/features/settings/PlanSettingsEditor.jsx';
import { SettingsView } from '@/features/settings/SettingsView.jsx';
import { WellnessEditor } from '@/features/wellness/WellnessEditor.jsx';
import { TodayView } from '@/features/today/TodayView.jsx';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { PlanView } from '@/features/plan/PlanView.jsx';
import { ProgressView } from '@/features/progress/ProgressView.jsx';
import { WurmReveal } from '@/features/easter-egg/WurmReveal.jsx';

/* ---------------- root ---------------- */
function App() {
  const [plan, setPlan] = useState(() => LS.load('plan', null));
  const [log, setLog] = useState(() => LS.load('log', {}));
  const [moves, setMoves] = useState(() => LS.load('moves', {}));
  const [view, setView] = useState('today');
  const [detail, setDetail] = useState(null);
  const [editFitness, setEditFitness] = useState(false);
  const [editPlan, setEditPlan] = useState(false);
  const [building, setBuilding] = useState(false);
  const [wurm, setWurm] = useState(false);
  const [wellness, setWellness] = useState(() => T.wellness.load());
  const [editWellness, setEditWellness] = useState(false);
  const saveWellness = rec => { setWellness(T.wellness.upsert(rec)); setEditWellness(false); };
  const [adjust, setAdjust] = useState(() => LS.load('adjust', {}));

  useEffect(() => { if (plan) LS.save('plan', plan); }, [plan]);
  useEffect(() => { LS.save('log', log); }, [log]);
  useEffect(() => { LS.save('moves', moves); }, [moves]);
  useEffect(() => { LS.save('adjust', adjust); }, [adjust]);

  if (!plan) return <Onboarding onCreate={p => { setPlan(T.generatePlan(p)); setView('today'); setBuilding(true); }} />;
  if (building) return <BuildingPlan plan={plan} onDone={() => setBuilding(false)} />;

  const toggle = id => setLog(l => { const n = { ...l }; if (n[id]) delete n[id]; else n[id] = { done: true, at: new Date().toISOString() }; return n; });
  const moveWorkout = (id, date) => setMoves(m => { const n = { ...m }; if (date === null) delete n[id]; else n[id] = date; return n; });
  const catchUp = () => setMoves(m => catchUpMoves(plan, log, m).next);
  // Re-target the plan from updated fitness. Same level/days/race → identical
  // week/day IDs, so the log & moves overlays stay valid; only paces change.
  const retarget = fields => {
    const old = plan.profile;
    const snapshot = { date: T.iso(new Date()), fivekSec: old.fivekSec, css100Sec: old.css100Sec, ftp: old.ftp, fitness: old.fitness };
    const profile = Object.assign({}, old, fields, { fitnessHistory: (old.fitnessHistory || []).concat([snapshot]) });
    const np = T.generatePlan(profile);
    np.createdAt = plan.createdAt;
    np.updatedAt = new Date().toISOString();
    setPlan(np);
  };
  const updateFitness = fields => { retarget(fields); setEditFitness(false); };
  const applyTune = () => { const s = paceSuggestions(plan, log); if (s.length) retarget(tuneFields(plan.profile, s)); };
  const setFeel = (id, feel) => setLog(l => ({ ...l, [id]: Object.assign({}, l[id], { done: true, at: (l[id] && l[id].at) || new Date().toISOString(), feel: feel }) }));
  // Readiness-driven adjustments overlay: eased session ids → easy aerobic version.
  const easedOf = w => (w && adjust[w.id] ? T.easeWorkout(w, plan) : w);
  const todaysHard = () => { const t = T.iso(new Date()); return plan.weeks.flatMap(wk => wk.workouts).filter(w => effDate(w, moves) === t && INTENSITY_TYPES[w.type] && !w.race); };
  const easeToday = () => { const hard = todaysHard(); if (!hard.length) return; setAdjust(a => { const n = { ...a }; hard.forEach(w => n[w.id] = { kind: 'ease', at: new Date().toISOString() }); return n; }); };
  const restoreToday = () => { const t = T.iso(new Date()); setAdjust(a => { const n = { ...a }; plan.weeks.flatMap(wk => wk.workouts).forEach(w => { if (effDate(w, moves) === t) delete n[w.id]; }); return n; }); };
  const unEase = id => setAdjust(a => { const n = { ...a }; delete n[id]; return n; });
  // Rebuild the plan after a race/schedule change. This reshapes the structure, so we
  // prune log & moves to the workout IDs that still exist (fitness/history carry over).
  const reshapePlan = fields => {
    const profile = Object.assign({}, plan.profile, fields);
    const np = T.generatePlan(profile);
    np.createdAt = plan.createdAt;
    if (plan.updatedAt) np.updatedAt = plan.updatedAt;
    const valid = new Set(np.weeks.flatMap(w => w.workouts).map(w => w.id));
    setLog(l => { const n = {}; Object.keys(l).forEach(id => { if (valid.has(id)) n[id] = l[id]; }); return n; });
    setMoves(m => { const n = {}; Object.keys(m).forEach(id => { if (valid.has(id)) n[id] = m[id]; }); return n; });
    setPlan(np);
    setEditPlan(false);
  };
  const race = T.RACES[plan.race];
  const daysToRace = Math.max(0, T.daysBetween(new Date(), plan.profile.raceDate));

  const tabs = [
    ['today', 'today', 'Today'], ['calendar', 'calendar', 'Calendar'],
    ['plan', 'plan', 'Plan'], ['progress', 'progress', 'Progress'], ['settings', 'you', 'You'],
  ];

  return (
    <div className="app">
      <div className="topbar">
        <h1><Icon name="logo" size={26} /> Try</h1>
        <div className="sub">Hi {plan.profile.name} — let's get to the finish line</div>
        <div className="race-chip"><span>{race.name} Triathlon</span><b>{daysToRace}</b><span>days to go</span></div>
      </div>

      {view === 'today' && <TodayView plan={plan} log={log} moves={moves} open={setDetail} onCatchUp={catchUp} onTune={applyTune} wellness={wellness} onEditWellness={() => setEditWellness(true)} easedOf={easedOf} onEaseToday={easeToday} onRestoreToday={restoreToday} />}
      {view === 'calendar' && <CalendarView plan={plan} log={log} moves={moves} open={setDetail} easedOf={easedOf} />}
      {view === 'plan' && <PlanView plan={plan} />}
      {view === 'progress' && <ProgressView plan={plan} log={log} wellness={wellness} />}
      {view === 'settings' && <SettingsView plan={plan}
        onEditFitness={() => setEditFitness(true)}
        onEditPlan={() => setEditPlan(true)}
        onRegenerate={() => { if (confirm('Start a new plan? Your current plan will be replaced.')) { LS.clear(); setLog({}); setMoves({}); setPlan(null); } }}
        onReset={() => { if (confirm('Clear all completion progress?')) setLog({}); }}
        onExport={() => downloadICS(plan, moves)} onReleaseWurm={() => setWurm(true)} />}

      {wurm && <WurmReveal onClose={() => setWurm(false)} />}

      {editFitness && <FitnessEditor profile={plan.profile} onClose={() => setEditFitness(false)} onSave={updateFitness} />}
      {editPlan && <PlanSettingsEditor profile={plan.profile} onClose={() => setEditPlan(false)} onSave={reshapePlan} />}
      {editWellness && <WellnessEditor onClose={() => setEditWellness(false)} onSave={saveWellness} />}

      {detail && <DetailSheet w={easedOf(detail)} plan={plan} done={!!log[detail.id]} eff={effDate(detail, moves)}
        feel={(log[detail.id] || {}).feel} onFeel={setFeel}
        onClose={() => setDetail(null)} onToggle={() => toggle(detail.id)}
        onMove={moveWorkout} onResetMove={id => moveWorkout(id, null)} onRestore={() => unEase(detail.id)}
        onLogResult={() => { setDetail(null); setEditFitness(true); }} />}

      <div className="nav">
        {tabs.map(([k, ic, label]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            <span className="ic"><Icon name={ic} size={22} /></span>{label}</button>
        ))}
      </div>
    </div>
  );
}

// Catches any render-time throw — most likely a plan saved by an older build whose
// shape no longer matches the code. Everything lives in one localStorage blob, so a
// crash would otherwise white-screen and re-crash on reload; this offers a clean out.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null, nonce: 0 }; }
  static getDerivedStateFromError(err) { return { err: err }; }
  componentDidCatch(err) { try { console.error('Try crashed:', err); } catch (e) {} }
  reset() {
    try { LS.clear(); localStorage.removeItem(NS + 'adjust'); } catch (e) {}
    // Clear the error and bump the key so App remounts and re-reads (now-empty)
    // storage. reload() gives a fully clean slate when available; the remount is
    // the fallback for environments where reload is a no-op.
    this.setState(s => ({ err: null, nonce: s.nonce + 1 }));
    try { location.reload(); } catch (e) {}
  }
  render() {
    if (!this.state.err) return <div key={this.state.nonce} style={{ display: 'contents' }}>{this.props.children}</div>;
    return (
      <div className="app">
        <div className="topbar"><h1><Icon name="logo" size={26} /> Try</h1></div>
        <div className="card">
          <h2>Something went wrong</h2>
          <p className="lead">Your saved plan couldn't be loaded — this can happen after an update. Starting a new plan clears the old data and fixes it. Your fitness numbers are quick to re-enter.</p>
          <button className="btn primary" onClick={() => this.reset()}>Start a fresh plan</button>
        </div>
      </div>
    );
  }
}

// Reuse one root across hot-reloads (avoids the "createRoot() on a container that
// has already been passed to createRoot()" warning and double-mount churn in dev).
const _container = document.getElementById('root');
const _root = _container.__try_root || (_container.__try_root = createRoot(_container));
_root.render(<ErrorBoundary><App /></ErrorBoundary>);
