import { useState, useEffect, useMemo, useRef } from 'react';
import * as T from '@/lib';
import { makeSync } from '@/app/sync.js';
import { buildObservation, toNote, downloadCalibration } from '@/app/calibration.js';
import { effDate, catchUpMoves } from '@/lib/schedule.js';
import { INTENSITY_TYPES, paceSuggestions, tuneFields } from '@/lib/tuning.js';
import { downloadICS } from '@/lib/ics.js';
import { Icon } from '@/components/Icon.jsx';
import { DetailSheet } from '@/components/DetailSheet.jsx';
import { Onboarding } from '@/features/onboarding/Onboarding.jsx';
import { BuildingPlan } from '@/features/onboarding/BuildingPlan.jsx';
import { FitnessEditor } from '@/features/settings/FitnessEditor.jsx';
import { PlanSettingsEditor } from '@/features/settings/PlanSettingsEditor.jsx';
import { SettingsView } from '@/features/settings/SettingsView.jsx';
import { WellnessEditor } from '@/features/wellness/WellnessEditor.jsx';
import { ReadinessInfo } from '@/features/wellness/ReadinessInfo.jsx';
import { TodayView } from '@/features/today/TodayView.jsx';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { PlanView } from '@/features/plan/PlanView.jsx';
import { ProgressView } from '@/features/progress/ProgressView.jsx';
import { WurmReveal } from '@/features/easter-egg/WurmReveal.jsx';

export function App({ storage, getToken, user }) {
  const [plan, setPlan] = useState(() => storage.load('plan', null));
  const [log, setLog] = useState(() => storage.load('log', {}));
  const [moves, setMoves] = useState(() => storage.load('moves', {}));
  const sync = useMemo(() => makeSync(getToken), [getToken]);
  const [hydrated, setHydrated] = useState(false);
  const didHydrate = useRef(false);
  // client workout ref ("0-0") → server workout GUID; the log/move endpoints key on
  // the GUID. Populated from every plan response (hydrate / create / replace).
  const [refToId, setRefToId] = useState({});
  const [view, setView] = useState('today');
  const [detail, setDetail] = useState(null);
  const [editFitness, setEditFitness] = useState(false);
  const [editPlan, setEditPlan] = useState(false);
  const [building, setBuilding] = useState(false);
  const [wurm, setWurm] = useState(false);
  const [wellness, setWellness] = useState(() => storage.loadWellness());
  const [editWellness, setEditWellness] = useState(false);
  const saveWellness = rec => { setWellness(storage.upsertWellness(rec)); sync.saveWellness(rec); setEditWellness(false); };
  const [adjust, setAdjust] = useState(() => storage.load('adjust', {}));

  useEffect(() => { if (plan) storage.save('plan', plan); }, [plan, storage]);
  useEffect(() => { storage.save('log', log); }, [log, storage]);
  useEffect(() => { storage.save('moves', moves); }, [moves, storage]);
  useEffect(() => { storage.save('adjust', adjust); }, [adjust, storage]);

  // On mount (per user): pull the server's plan graph. The server is the source of
  // truth; localStorage is the offline fallback if it's unreachable.
  useEffect(() => {
    if (didHydrate.current) return;
    didHydrate.current = true;
    let cancelled = false;
    sync.hydrate().then(result => {
      if (cancelled) return;
      if (result === 'none') {
        // Signed in but no server plan: migrate a pre-backend local plan up, else
        // fall through to onboarding.
        if (plan) sync.savePlan(plan).then(map => { if (map) setRefToId(map); }); else setPlan(null);
      } else if (result) {
        setPlan(result.plan); setLog(result.log); setMoves(result.moves); setRefToId(result.refToId || {});
        // Adjustments sync only once the backend supports them; an empty result
        // means "unknown", so the local overlay is kept rather than wiped.
        if (result.adjust && Object.keys(result.adjust).length) setAdjust(result.adjust);
      } // result === null → offline/error: keep the cache already loaded
      setHydrated(true);
    });
    // Wellness syncs separately (keyed by date, independent of the plan). The
    // refresh pulls from intervals.icu first when connected (plain GET otherwise),
    // then we merge server + local (server wins per date) and migrate any
    // local-only days up.
    sync.refreshWellness().then(serverRecs => {
      if (cancelled || !serverRecs) return; // null → offline/error, keep local cache
      applyServerWellness(serverRecs);
    });
    return () => { cancelled = true; };
  }, [sync]);

  // Fold a server wellness list into local state + the offline cache (server wins
  // per date; local-only days are pushed up). Also called when the Settings page
  // connects intervals.icu, so the readiness card updates without a reload.
  const applyServerWellness = serverRecs => {
    const local = storage.loadWellness();
    const serverDates = new Set(serverRecs.map(r => r.date));
    local.forEach(r => { if (!serverDates.has(r.date)) sync.saveWellness(r); });
    const byDate = {};
    local.forEach(r => { byDate[r.date] = r; });
    serverRecs.forEach(r => { byDate[r.date] = r; });
    const merged = Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1));
    merged.forEach(r => storage.upsertWellness(r)); // refresh the offline cache
    setWellness(merged);
  };

  if (!hydrated) return (
    <div className="app">
      <div className="topbar"><h1><Icon name="logo" size={26} /> Try</h1></div>
      <div className="card"><p className="lead">Loading your plan…</p></div>
    </div>
  );
  if (!plan) return <Onboarding onCreate={p => { const np = T.generatePlan(p); setPlan(np); setView('today'); setBuilding(true); sync.savePlan(np).then(map => { if (map) setRefToId(map); }); }} />;
  if (building) return <BuildingPlan plan={plan} onDone={() => setBuilding(false)} />;

  // Resolve our client ref → server workout GUID for the log/move endpoints; skip
  // the push (local-only) if the plan hasn't synced a GUID for it yet.
  const gid = id => refToId[id];
  // Calibration capture: when a session is completed (and again when its feel is
  // rated), snapshot the readiness inputs for that day next to the outcome —
  // stored locally (append-only) and embedded in the synced log's notes field.
  const observe = (id, feel, at) => {
    const w = plan.weeks.flatMap(wk => wk.workouts).find(x => x.id === id);
    if (!w || w.discipline === 'rest') return null;
    const obs = buildObservation({
      workout: w, date: effDate(w, moves), feel, eased: !!adjust[id], wellnessRecs: wellness, at,
    });
    storage.upsertCalibration(obs);
    return toNote(obs);
  };
  const toggle = id => {
    if (log[id]) {
      const w = plan.weeks.flatMap(wk => wk.workouts).find(x => x.id === id);
      setLog(l => { const n = { ...l }; delete n[id]; return n; });
      if (w) storage.removeCalibration(id, effDate(w, moves));
      if (gid(id)) sync.removeLog(gid(id));
    } else {
      const at = new Date().toISOString();
      const entry = { done: true, at, notes: observe(id, null, at) };
      setLog(l => ({ ...l, [id]: entry }));
      if (gid(id)) sync.saveLog(gid(id), entry);
    }
  };
  const moveWorkout = (id, date) => {
    setMoves(m => { const n = { ...m }; if (date === null) delete n[id]; else n[id] = date; return n; });
    if (gid(id)) { if (date === null) sync.removeMove(gid(id)); else sync.saveMove(gid(id), date); }
  };
  const catchUp = () => {
    const next = catchUpMoves(plan, log, moves).next;
    Object.keys(next).forEach(id => { if (next[id] !== moves[id] && gid(id)) sync.saveMove(gid(id), next[id]); });
    setMoves(next);
  };
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
    sync.replacePlan(np).then(map => { if (map) setRefToId(map); });
  };
  const updateFitness = fields => { retarget(fields); setEditFitness(false); };
  const applyTune = () => { const s = paceSuggestions(plan, log); if (s.length) retarget(tuneFields(plan.profile, s)); };
  const setFeel = (id, feel) => {
    const at = (log[id] && log[id].at) || new Date().toISOString();
    const entry = Object.assign({}, log[id], { done: true, at, feel, notes: observe(id, feel, at) });
    setLog(l => ({ ...l, [id]: entry }));
    if (gid(id)) sync.saveLog(gid(id), entry);
  };
  // Engine-adjustments overlay: session ids → their eased (readiness), trimmed
  // (ramp guardrail) or boosted (build nudge) version. The name predates the
  // extra kinds; it applies them all.
  const easedOf = w => {
    const a = w && adjust[w.id];
    if (!a) return w;
    if (a.kind === 'trim') return T.trimWorkout(w, plan, a.factor || 0.8);
    if (a.kind === 'boost') return T.boostWorkout(w, plan, a.factor || 1.1);
    return T.easeWorkout(w, plan);
  };
  const todaysHard = () => { const t = T.iso(new Date()); return plan.weeks.flatMap(wk => wk.workouts).filter(w => effDate(w, moves) === t && INTENSITY_TYPES[w.type] && !w.race); };
  const easeToday = () => {
    const hard = todaysHard(); if (!hard.length) return;
    const at = new Date().toISOString();
    setAdjust(a => { const n = { ...a }; hard.forEach(w => n[w.id] = { kind: 'ease', at }); return n; });
    hard.forEach(w => { if (gid(w.id)) sync.saveAdjustment(gid(w.id), { kind: 'ease', easedFrom: w.type, at }); });
  };
  const restoreToday = () => {
    const t = T.iso(new Date());
    const todaysIds = plan.weeks.flatMap(wk => wk.workouts).filter(w => effDate(w, moves) === t).map(w => w.id);
    setAdjust(a => { const n = { ...a }; todaysIds.forEach(id => delete n[id]); return n; });
    todaysIds.forEach(id => { if (adjust[id] && gid(id)) sync.removeAdjustment(gid(id)); });
  };
  const unEase = id => {
    setAdjust(a => { const n = { ...a }; delete n[id]; return n; });
    if (gid(id)) sync.removeAdjustment(gid(id));
  };
  // Phase 2 — the ramp guardrail's week-level proposal (rules R1-R3), and what
  // accepting it does: trim entries land in the same adjust overlay (and sync the
  // same way), so the calendar, detail sheet and undo all just work.
  const weekly = T.proposeWeek({ wellness, plan, log, moves, adjust, todayISO: T.iso(new Date()) });
  const applyWeekly = p => {
    if (!p) return;
    if (p.action === 'catchUp') return catchUp();
    if (p.action === 'restoreWeek') {
      setAdjust(a => { const n = { ...a }; p.targets.forEach(id => delete n[id]); return n; });
      p.targets.forEach(id => { if (adjust[id] && gid(id)) sync.removeAdjustment(gid(id)); });
      return;
    }
    const at = new Date().toISOString();
    const all = plan.weeks.flatMap(wk => wk.workouts);
    const kind = p.action === 'boostWeek' ? 'boost' : 'trim';
    setAdjust(a => {
      const n = { ...a };
      p.targets.forEach(id => { n[id] = { kind, factor: p.factor, at }; });
      (p.ease || []).forEach(id => { n[id] = { kind: 'ease', at }; });
      return n;
    });
    p.targets.forEach(id => { if (gid(id)) sync.saveAdjustment(gid(id), { kind, factor: p.factor, at }); });
    (p.ease || []).forEach(id => {
      const w = all.find(x => x.id === id);
      if (gid(id)) sync.saveAdjustment(gid(id), { kind: 'ease', easedFrom: w && w.type, at });
    });
  };
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
    // PUT replaces the plan graph; the server prunes logs/moves for workouts that
    // no longer exist, mirroring the local prune above.
    sync.replacePlan(np).then(map => { if (map) setRefToId(map); });
  };
  const race = T.RACES[plan.race];
  const daysToRace = Math.max(0, T.daysBetween(new Date(), plan.profile.raceDate));

  // Settings/profile now lives behind the avatar (top-left), Runna-style — off the
  // bottom nav, which stays focused on training.
  const tabs = [
    ['today', 'today', 'Today'], ['calendar', 'calendar', 'Calendar'],
    ['plan', 'plan', 'Plan'], ['progress', 'progress', 'Progress'],
  ];
  const avatarUrl = user && user.imageUrl;
  const initial = ((plan.profile.name || 'A').trim()[0] || 'A').toUpperCase();

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-top">
          <button className="avatar-btn" type="button" title="Profile &amp; settings"
            aria-label="Profile and settings" onClick={() => setView('settings')}>
            {avatarUrl ? <img className="avatar" src={avatarUrl} alt="" /> : <span className="avatar avatar-fallback">{initial}</span>}
          </button>
          <h1><Icon name="logo" size={26} /> Try</h1>
        </div>
        <div className="sub">Hi {plan.profile.name} — let's get to the finish line</div>
        <div className="race-chip"><span>{race.name} Triathlon</span><b>{daysToRace}</b><span>days to go</span></div>
      </div>

      {view === 'today' && <TodayView plan={plan} log={log} moves={moves} open={setDetail} onCatchUp={catchUp} onTune={applyTune} wellness={wellness} onEditWellness={() => setEditWellness(true)} easedOf={easedOf} onEaseToday={easeToday} onRestoreToday={restoreToday} weekly={weekly} onWeekly={applyWeekly} />}
      {view === 'calendar' && <CalendarView plan={plan} log={log} moves={moves} open={setDetail} easedOf={easedOf} />}
      {view === 'plan' && <PlanView plan={plan} />}
      {view === 'progress' && <ProgressView plan={plan} log={log} wellness={wellness} />}
      {view === 'settings' && <SettingsView plan={plan}
        onEditFitness={() => setEditFitness(true)}
        onEditPlan={() => setEditPlan(true)}
        onRegenerate={() => { if (confirm('Start a new plan? Your current plan will be replaced.')) { storage.clear(); setLog({}); setMoves({}); setPlan(null); } }}
        onReset={() => { if (confirm('Clear all completion progress?')) setLog({}); }}
        onExport={() => downloadICS(plan, moves)} onReleaseWurm={() => setWurm(true)}
        onWellnessSynced={applyServerWellness} onReadinessInfo={() => setView('readinessInfo')}
        onExportCalibration={() => downloadCalibration(storage)} calibrationCount={storage.loadCalibration().length} />}
      {view === 'readinessInfo' && <ReadinessInfo onBack={() => setView('settings')} />}

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
