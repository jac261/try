/* Try — React UI (Vite entry point).
   The domain layer lives in @/lib as plain ES modules; `T` is its namespace
   (T.iso, T.RACES, T.generatePlan, T.wellness, …) — the replacement for the old
   `window.TF` global, with load order now handled by the module graph. */
import './styles.css';
import { useState, useEffect, useMemo, Component } from 'react';
import { createRoot } from 'react-dom/client';
import * as T from '@/lib';
import { LS, NS } from '@/app/storage.js';
import { tap } from '@/utils/a11y.js';
import { effDate, weekRange, catchUpMoves } from '@/lib/schedule.js';
import { INTENSITY_TYPES, paceSuggestions, tuneFields } from '@/lib/tuning.js';
import { downloadICS } from '@/lib/ics.js';

const D = T.DISCIPLINES;
import { Icon } from '@/components/Icon.jsx';
import { BarChart, Donut, Sparkline, TrendChart } from '@/components/charts.jsx';
import { DaySelector } from '@/components/DaySelector.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { DetailSheet } from '@/components/DetailSheet.jsx';

function fitnessSeries(profile, startDate) {
  const hist = profile.fitnessHistory || [];
  const series = key => {
    const dates = [startDate].concat(hist.map(h => h.date));
    const vals = hist.map(h => h[key]).concat([profile[key]]);
    const pts = [];
    for (let i = 0; i < vals.length; i++) if (vals[i] != null) pts.push({ date: dates[i], value: vals[i] });
    return pts;
  };
  return { run: series('fivekSec'), swim: series('css100Sec'), bike: series('ftp') };
}

// Sensible default training weekdays per count (0=Mon..6=Sun), matching the legacy layout.
const DEFAULT_DAYS = { 3: [1, 5, 6], 4: [0, 1, 3, 5], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };

/* ---------------- onboarding ---------------- */
function Onboarding({ onCreate }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    name: '', raceType: 'olympic', fitness: 'intermediate', trainingDays: [0, 1, 3, 5, 6], longDay: 5,
    raceDate: T.iso(T.addDays(new Date(), 84)), fivek: '', css100: '', ftp: '',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  function finish() {
    onCreate({
      name: f.name.trim() || 'Athlete', raceType: f.raceType, fitness: f.fitness,
      trainingDays: f.trainingDays, longDay: f.longDay,
      daysPerWeek: f.trainingDays.length, raceDate: f.raceDate,
      fivekSec: T.parseTimeToSec(f.fivek), css100Sec: T.parseTimeToSec(f.css100),
      ftp: f.ftp ? Number(f.ftp) : null, startDate: T.iso(new Date()),
    });
  }

  return (
    <div className="app">
      <div className="topbar"><h1><Icon name="logo" size={24} /> Try</h1><div className="sub">Your personalised triathlon coach</div></div>
      <div className="card">
        {step === 0 && <>
          <h2>Let's build your plan</h2>
          <p className="lead">Three quick steps and you'll have a full periodised plan to race day.</p>
          <label className="field"><span className="lab">What should we call you?</span>
            <input value={f.name} placeholder="Your name" onChange={e => set('name', e.target.value)} /></label>
          <label className="field"><span className="lab">Which race are you training for?</span></label>
          <div className="choice">
            {Object.values(T.RACES).map(r => (
              <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} {...tap(() => set('raceType', r.key))}>
                {r.name}<small>{r.swim}k swim · {r.bike}k bike · {r.run}k run</small></div>
            ))}
          </div>
          <div style={{ height: 12 }} />
          <button className="btn primary" onClick={() => setStep(1)}>Continue</button>
        </>}

        {step === 1 && <>
          <h2>Schedule & experience</h2>
          <p className="lead">This shapes your volume, intensity and ramp rate.</p>
          <label className="field"><span className="lab">Race date</span>
            <input type="date" value={f.raceDate} min={T.iso(T.addDays(new Date(), 7))} onChange={e => set('raceDate', e.target.value)} /></label>
          <label className="field" style={{ marginBottom: 8 }}><span className="lab">Which days will you train?</span></label>
          <DaySelector days={f.trainingDays} longDay={f.longDay} onChange={(d, l) => setF(s => ({ ...s, trainingDays: d, longDay: l }))} />
          <div style={{ height: 18 }} />
          <label className="field"><span className="lab">Experience level</span></label>
          <div className="choice">
            {Object.values(T.FITNESS).map(l => (
              <div key={l.key} className={'opt' + (f.fitness === l.key ? ' on' : '')} {...tap(() => set('fitness', l.key))}>{l.name}<small>{l.blurb}</small></div>
            ))}
          </div>
          <div style={{ height: 12 }} />
          <div className="row"><button className="btn ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn primary" onClick={() => setStep(2)}>Continue</button></div>
        </>}

        {step === 2 && <>
          <h2>Your current fitness <span className="hint" style={{ fontWeight: 500 }}>· optional</span></h2>
          <p className="lead"><b>New to triathlon? You can skip all of these.</b> We'll then guide every session by effort (RPE / heart-rate zones), with ballpark paces estimated from your {T.FITNESS[f.fitness].name} level. Add any numbers you do know to make it precise.</p>
          <label className="field"><span className="lab">Recent 5 km run time <span className="hint">optional · mm:ss</span></span>
            <input value={f.fivek} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].est5k)} onChange={e => set('fivek', e.target.value)} /></label>
          <label className="field"><span className="lab">Swim pace per 100 m <span className="hint">optional · mm:ss</span></span>
            <input value={f.css100} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].estCss)} onChange={e => set('css100', e.target.value)} /></label>
          <label className="field"><span className="lab">Cycling FTP <span className="hint">optional · watts</span></span>
            <input value={f.ftp} placeholder="e.g. 200" inputMode="numeric" onChange={e => set('ftp', e.target.value)} /></label>
          <div className="row"><button className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" onClick={finish}>Generate plan →</button></div>
        </>}
      </div>
      <div className="center muted" style={{ fontSize: 12 }}>Step {step + 1} of 3</div>
    </div>
  );
}

/* ---------------- update-fitness editor ---------------- */
function FitnessEditor({ profile, onClose, onSave }) {
  const lvl0 = T.FITNESS[profile.fitness] ? profile.fitness : 'intermediate';
  const [f, setF] = useState({
    fitness: lvl0,
    fivek: profile.fivekSec ? T.fmtPace(profile.fivekSec) : '',
    css100: profile.css100Sec ? T.fmtPace(profile.css100Sec) : '',
    ftp: profile.ftp || '',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>Update fitness</h2>
        <p className="lead">Logged a test, race or just got fitter? Update your numbers and every <b>upcoming</b> session re-targets to the new paces. Completed sessions and reschedules stay put.</p>
        <label className="field"><span className="lab">Experience level</span></label>
        <div className="choice">
          {Object.values(T.FITNESS).map(l => (
            <div key={l.key} className={'opt' + (f.fitness === l.key ? ' on' : '')} {...tap(() => set('fitness', l.key))}>{l.name}<small>{l.blurb}</small></div>
          ))}
        </div>
        <div style={{ height: 16 }} />
        <label className="field"><span className="lab">Recent 5 km run time <span className="hint">optional · mm:ss</span></span>
          <input value={f.fivek} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].est5k)} onChange={e => set('fivek', e.target.value)} /></label>
        <label className="field"><span className="lab">Swim pace per 100 m <span className="hint">optional · mm:ss</span></span>
          <input value={f.css100} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].estCss)} onChange={e => set('css100', e.target.value)} /></label>
        <label className="field"><span className="lab">Cycling FTP <span className="hint">optional · watts</span></span>
          <input value={f.ftp} placeholder="e.g. 200" inputMode="numeric" onChange={e => set('ftp', e.target.value)} /></label>
        <button className="btn primary" onClick={() => onSave({
          fitness: f.fitness,
          fivekSec: T.parseTimeToSec(f.fivek),
          css100Sec: T.parseTimeToSec(f.css100),
          ftp: f.ftp ? Number(f.ftp) : null,
        })}>Save &amp; re-target plan</button>
      </div>
    </div>
  );
}

/* ---------------- edit-plan (race / schedule) editor ---------------- */
function PlanSettingsEditor({ profile, onClose, onSave }) {
  const initDays = (profile.trainingDays && profile.trainingDays.length >= 3)
    ? profile.trainingDays.slice().sort((a, b) => a - b)
    : (DEFAULT_DAYS[Math.max(3, Math.min(7, profile.daysPerWeek))] || DEFAULT_DAYS[5]);
  const initLong = (profile.longDay !== undefined && initDays.indexOf(profile.longDay) >= 0)
    ? profile.longDay : (initDays.indexOf(5) >= 0 ? 5 : initDays[initDays.length - 1]);
  const [f, setF] = useState({
    raceType: profile.raceType,
    raceDate: T.iso(profile.raceDate),
    trainingDays: initDays,
    longDay: initLong,
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const todayISO = T.iso(new Date());
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>Edit plan</h2>
        <p className="lead">Change your race or schedule and the plan rebuilds around it. Completed sessions and reschedules are kept for the days that still exist; your fitness, paces and progress carry over.</p>
        <label className="field"><span className="lab">Race</span></label>
        <div className="choice">
          {Object.values(T.RACES).map(r => (
            <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} {...tap(() => set('raceType', r.key))}>{r.name}<small>{r.swim}k · {r.bike}k · {r.run}k</small></div>
          ))}
        </div>
        <div style={{ height: 16 }} />
        <label className="field"><span className="lab">Race date</span>
          <input type="date" value={f.raceDate} min={todayISO} onChange={e => set('raceDate', e.target.value)} /></label>
        <label className="field" style={{ marginBottom: 8 }}><span className="lab">Which days will you train?</span></label>
        <DaySelector days={f.trainingDays} longDay={f.longDay} onChange={(d, l) => setF(s => ({ ...s, trainingDays: d, longDay: l }))} />
        <div style={{ height: 18 }} />
        <button className="btn primary" onClick={() => onSave({ raceType: f.raceType, raceDate: f.raceDate, daysPerWeek: f.trainingDays.length, trainingDays: f.trainingDays, longDay: f.longDay })}>Save &amp; rebuild plan</button>
      </div>
    </div>
  );
}

/* ---------------- views ---------------- */
/* ---------------- readiness (wellness-driven) ---------------- */
function ReadinessRing({ score, band }) {
  const r = 26, c = 2 * Math.PI * r;
  const col = band === 'green' ? 'var(--run)' : band === 'amber' ? 'var(--bike)' : 'var(--danger)';
  return (
    <svg width="74" height="74" viewBox="0 0 72 72" style={{ flex: 'none' }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--track)" strokeWidth="6" />
      <circle cx="36" cy="36" r={r} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={(score / 100 * c) + ' ' + c} transform="rotate(-90 36 36)" />
      <text x="36" y="41" textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--ink)">{score}</text>
    </svg>
  );
}

function ReadinessCard({ wellness, today, onEdit, onEase, onRestore }) {
  const todayISO = T.iso(new Date());
  const rec = wellness.find(r => r.date === todayISO) || (wellness.length ? wellness[wellness.length - 1] : null);
  if (!rec) {
    return (
      <div className="banner rd-empty" {...tap(onEdit)}>
        <div className="bi"><Icon name="heartrate" size={20} /></div>
        <div><div className="bt">Add your morning readiness</div>
          <div className="bs">Log HRV, sleep &amp; resting HR for a daily go / ease / recover call →</div></div>
      </div>
    );
  }
  const base = T.wellness.baseline(wellness, todayISO);
  const rd = T.wellness.readiness(rec, base);
  const eased = today.find(w => w.eased);
  const hard = today.find(w => INTENSITY_TYPES[w.type]);
  const sessTitle = (hard || eased || today.find(w => w.discipline !== 'rest') || {}).title;
  const adv = T.wellness.advice(rd.band, !!hard, today.length && sessTitle ? sessTitle : 'rest day');
  const stale = rec.date !== todayISO;
  return (
    <div className={'card rd rd-' + rd.band}>
      <div className="rd-top">
        <ReadinessRing score={rd.score} band={rd.band} />
        <div className="rd-main">
          <div className="rd-headline">{rd.headline}</div>
          <div className="rd-advice">{adv}</div>
        </div>
      </div>
      {eased
        ? <div className="rd-eased"><Icon name="rest" size={15} /> Today eased to {eased.title} for recovery · <a className="reset" {...tap(onRestore)}>undo</a></div>
        : (!stale && rd.band !== 'green' && hard && <button className="btn ghost sm rd-action" onClick={onEase}>Ease today's {hard.title} → easy aerobic</button>)}
      <div className="rd-why">
        {rd.why.map((w, i) => <span key={i} className={'rd-chip' + (w.bad ? ' bad' : '')}>{w.t}</span>)}
      </div>
      {(rec.ctl != null || rec.tsb != null) && <div className="rd-pmc">
        {rec.ctl != null && <div><b>{Math.round(rec.ctl)}</b><span>Fitness</span></div>}
        {rec.atl != null && <div><b>{Math.round(rec.atl)}</b><span>Fatigue</span></div>}
        {rec.tsb != null && <div><b>{T.wellness.signed(rec.tsb)}</b><span>Form</span></div>}
      </div>}
      <div className="rd-foot">
        <span>{stale ? 'From ' + T.fmtDate(rec.date, { month: 'short', day: 'numeric' }) : 'This morning'}</span>
        <a className="reset" {...tap(onEdit)}>Update →</a>
      </div>
    </div>
  );
}

function WellnessEditor({ onClose, onSave }) {
  const [f, setF] = useState({ hrv: '', sleepH: '', rhr: '', tsb: '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const num = v => (v === '' || v == null ? null : Number(v));
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="hero"><div className="dot" style={{ background: D.run.grad }}><Icon name="heartrate" size={26} /></div>
          <div><h2>This morning's readiness</h2><div className="s">From your watch or intervals.icu</div></div></div>
        <label className="field"><span className="lab">HRV <span className="hint">ms · overnight</span></span>
          <input type="number" inputMode="numeric" value={f.hrv} onChange={e => set('hrv', e.target.value)} placeholder="e.g. 56" /></label>
        <label className="field"><span className="lab">Sleep <span className="hint">hours</span></span>
          <input type="number" inputMode="decimal" step="0.1" value={f.sleepH} onChange={e => set('sleepH', e.target.value)} placeholder="e.g. 7.5" /></label>
        <label className="field"><span className="lab">Resting HR <span className="hint">bpm</span></span>
          <input type="number" inputMode="numeric" value={f.rhr} onChange={e => set('rhr', e.target.value)} placeholder="e.g. 51" /></label>
        <label className="field"><span className="lab">Form / TSB <span className="hint">optional · from intervals.icu</span></span>
          <input type="number" inputMode="numeric" value={f.tsb} onChange={e => set('tsb', e.target.value)} placeholder="e.g. 12" /></label>
        <button className="btn primary" onClick={() => onSave({ date: T.iso(new Date()), hrv: num(f.hrv), sleepH: num(f.sleepH), rhr: num(f.rhr), tsb: num(f.tsb) })}>Save readiness</button>
        <div className="fithint">Auto-sync from intervals.icu arrives with the backend. For now, pop in this morning's numbers.</div>
      </div>
    </div>
  );
}

function TodayView({ plan, log, moves, open, onCatchUp, onTune, wellness, onEditWellness, easedOf, onEaseToday, onRestoreToday }) {
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
      <ReadinessCard wellness={wellness} today={today.map(easedOf)} onEdit={onEditWellness} onEase={onEaseToday} onRestore={onRestoreToday} />
      {missed.length > 0 && <div className="banner" {...tap(onCatchUp)}>
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

function CalendarView({ plan, log, moves, open, easedOf }) {
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
              {ordered.map(w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} />)}
            </div>}
          </div>
        );
      })}
    </>
  );
}

function PlanView({ plan }) {
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

// Fitness/Form (PMC) + recovery (HRV / sleep) trends from the wellness store.
function WellnessTrends({ wellness }) {
  const w = wellness.filter(r => r.ctl != null || r.hrv != null);
  if (w.length < 2) return (
    <>
      <div className="section-title">Fitness &amp; recovery</div>
      <div className="card"><div className="empty" style={{ padding: '22px 16px' }}>
        <div className="big"><Icon name="heartrate" size={32} /></div>
        Log a few days of readiness (or connect intervals.icu) and your Fitness, Form &amp; HRV trends will appear here.
      </div></div>
    </>
  );
  const last = w[w.length - 1], first = w[0];
  const num = (arr, k) => arr.map(r => r[k]).filter(v => v != null);
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const ctl = num(w, 'ctl'), atl = num(w, 'atl'), hrv = num(w, 'hrv');
  const tsb = last.tsb != null ? last.tsb : (last.ctl != null && last.atl != null ? last.ctl - last.atl : null);
  const ctlD = (last.ctl != null && first.ctl != null) ? last.ctl - first.ctl : null;
  const base = T.wellness.baseline(wellness, T.iso(new Date()));
  const sleepAvg = avg(num(w, 'sleepH')), rhrAvg = avg(num(w, 'rhr'));
  const formLabel = tsb == null ? '' : (tsb > 8 ? ' · fresh' : tsb < -10 ? ' · fatigued' : ' · neutral');
  return (
    <>
      <div className="section-title">Fitness &amp; Form <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>last {w.length} days</span></div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, marginBottom: 14 }}>
          <div><b>{Math.round(last.ctl)}</b><span>Fitness{ctlD != null ? ' ' + T.wellness.signed(ctlD) : ''}</span></div>
          <div><b>{Math.round(last.atl)}</b><span>Fatigue</span></div>
          <div><b>{tsb != null ? T.wellness.signed(tsb) : '—'}</b><span>Form{formLabel}</span></div>
        </div>
        {ctl.length >= 2 && <TrendChart height={104} series={[
          { values: ctl, color: 'var(--blue)', fill: true, width: 2.4 },
          { values: atl, color: 'var(--muted)', width: 1.8 },
        ]} />}
        <div className="chart-legend"><span><i style={{ background: 'var(--blue)' }} />Fitness (CTL)</span><span><i style={{ background: 'var(--muted)' }} />Fatigue (ATL)</span><span className="dim">gap = Form</span></div>
      </div>

      <div className="section-title">Recovery</div>
      <div className="card">
        <div className="rd-pmc" style={{ marginTop: 0, marginBottom: 14 }}>
          <div><b>{last.hrv != null ? last.hrv : '—'}</b><span>HRV{base.hrvMean ? ' · base ' + Math.round(base.hrvMean) : ''}</span></div>
          <div><b>{rhrAvg != null ? Math.round(rhrAvg) : '—'}</b><span>Rest HR avg</span></div>
          <div><b>{sleepAvg != null ? T.wellness.fmtH(sleepAvg) : '—'}</b><span>Sleep avg</span></div>
        </div>
        {hrv.length >= 2 && <TrendChart height={96}
          band={base.hrvMean ? { lo: base.hrvMean - base.hrvSd, hi: base.hrvMean + base.hrvSd } : null}
          series={[{ values: hrv, color: 'var(--run)', width: 2.4 }]} />}
        <div className="chart-legend"><span><i style={{ background: 'var(--run)' }} />HRV</span><span className="dim">shaded = your baseline range</span></div>
      </div>
    </>
  );
}

function ProgressView({ plan, log, wellness }) {
  const todayISO = T.iso(new Date());
  const all = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && !w.race);
  const done = all.filter(w => log[w.id]);
  const daysToRace = Math.max(0, T.daysBetween(new Date(), plan.profile.raceDate));
  const pct = all.length ? Math.round(done.length / all.length * 100) : 0;

  // weekly bars
  const bars = plan.weeks.map(w => {
    const sess = w.workouts.filter(x => x.discipline !== 'rest' && !x.race);
    const planned = sess.reduce((a, b) => a + b.durationMin, 0) / 60;
    const dn = sess.filter(x => log[x.id]).reduce((a, b) => a + b.durationMin, 0) / 60;
    return { label: w.index % 2 === 0 ? (w.index + 1) : '', planned, done: dn, color: 'var(--accent)' };
  });

  // discipline split (hours)
  const split = {};
  all.forEach(w => { const k = w.discipline; split[k] = (split[k] || 0) + w.durationMin / 60; });
  const donut = Object.keys(split).map(k => ({ label: D[k].name, value: split[k], color: D[k].color }));

  // current streak (consecutive completed sessions up to today, backwards)
  const pastSessions = all.filter(w => w.date <= todayISO).sort((a, b) => b.date < a.date ? 1 : -1);
  let streak = 0;
  for (let i = pastSessions.length - 1; i >= 0; i--) { if (log[pastSessions[i].id]) streak++; else break; }

  const thisWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= todayISO)) || plan.weeks[plan.weeks.length - 1];
  const twSess = thisWeek.workouts.filter(x => x.discipline !== 'rest' && !x.race);
  const twDone = twSess.filter(x => log[x.id]).length;

  // fitness progression (from fitnessHistory snapshots + current baselines)
  const startISO = plan.profile.startDate || (plan.createdAt || '').slice(0, 10) || todayISO;
  const series = fitnessSeries(plan.profile, startISO);
  const METRICS = [
    { key: 'run', label: 'Run · 5k pace', fmt: v => T.fmtPace(v / 5) + ' /km', div: 5, color: D.run.color, betterDown: true },
    { key: 'swim', label: 'Swim · CSS', fmt: v => T.fmtPace(v) + ' /100m', div: 1, color: D.swim.color, betterDown: true },
    { key: 'bike', label: 'Bike · FTP', fmt: v => v + ' W', color: D.bike.color, betterDown: false },
  ];
  const trends = METRICS.map(m => {
    const pts = series[m.key];
    if (!pts.length) return null;
    const first = pts[0].value, latest = pts[pts.length - 1].value, changed = latest !== first;
    const improved = m.betterDown ? latest < first : latest > first;
    let deltaStr = null;
    if (changed) {
      const d = Math.abs(latest - first);
      deltaStr = m.key === 'bike' ? (improved ? '+' : '−') + d + ' W'
        : T.fmtPace(d / m.div) + (improved ? ' faster' : ' slower');
    }
    return { key: m.key, label: m.label, color: m.color, betterDown: m.betterDown, vals: pts.map(p => p.value), latest: m.fmt(latest), changed, improved, deltaStr };
  }).filter(Boolean);

  return (
    <>
      <div className="section-title">Progress</div>
      <div className="kpis">
        <div className="kpi"><div className="v">{daysToRace}<small> days</small></div><div className="k">Until race day</div></div>
        <div className="kpi"><div className="v">{pct}<small>%</small></div><div className="k">Sessions completed</div></div>
        <div className="kpi"><div className="v">{done.length}<small>/{all.length}</small></div><div className="k">Workouts done</div></div>
        <div className="kpi"><div className="v" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{streak}<Icon name="flame" size={22} /></div><div className="k">Current streak</div></div>
      </div>

      <div className="section-title">Weekly volume <span className="muted" style={{ textTransform: 'none', fontWeight: 400 }}>(planned vs completed)</span></div>
      <div className="card"><BarChart data={bars} height={160} /></div>

      <div className="section-title">Fitness progression</div>
      {trends.length === 0 ? (
        <div className="card"><div className="empty" style={{ padding: '24px 16px' }}><div className="big"><Icon name="trend" size={34} /></div>Log a benchmark test or update your fitness, and your pace &amp; power trends will appear here.</div></div>
      ) : (
        <div className="card">
          {trends.map(t => (
            <div className="trend" key={t.key}>
              <div className="trend-info">
                <div className="trend-label">{t.label}</div>
                <div className="trend-val">{t.latest}{t.deltaStr && <span className={'trend-delta ' + (t.improved ? 'up' : 'down')}>{t.deltaStr}</span>}</div>
              </div>
              {t.vals.length >= 2 ? <Sparkline values={t.vals} betterDown={t.betterDown} color={t.color} /> : <span className="trend-base">baseline</span>}
            </div>
          ))}
        </div>
      )}

      <div className="section-title">This week</div>
      <div className="card">
        <div className="row"><div><h2 style={{ margin: 0 }}>{twDone} of {twSess.length} done</h2>
          <div className="muted" style={{ fontSize: 12 }}>{thisWeek.phase} phase · week {thisWeek.index + 1}</div></div>
          <div className="spacer" /><div style={{ fontSize: 26, fontWeight: 750 }}>{twSess.length ? Math.round(twDone / twSess.length * 100) : 0}%</div></div>
        <div className="weekbar" style={{ height: 9 }}><span style={{ width: (twSess.length ? twDone / twSess.length * 100 : 0) + '%', background: 'var(--accent)' }} /></div>
      </div>

      <div className="section-title">Discipline balance</div>
      <div className="card center">
        <Donut segments={donut} size={170} />
        <div className="legend" style={{ justifyContent: 'center' }}>
          {donut.map(s => <div className="li" key={s.label}><i style={{ background: s.color }} />{s.label} · {Math.round(s.value)}h</div>)}
        </div>
      </div>

      <WellnessTrends wellness={wellness} />
    </>
  );
}

// 🐛 Easter egg: a monocled, top-hatted villain worm bursts from the soil.
function WurmReveal({ onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 5600); return () => clearTimeout(t); }, []);
  const clods = [[-70, -90], [-40, -120], [-10, -100], [25, -125], [55, -95], [80, -75], [-95, -60], [95, -55]];
  return (
    <div className="wurm-scrim" onClick={onClose}>
      <div className="wurm-text">Release ze Würm!</div>
      <div className="wurm-stage">
        <div className="wurm-figure"><div className="wurm-body">
          <svg width="200" height="250" viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="wbody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#88d75c" /><stop offset="1" stopColor="#479b32" /></linearGradient></defs>
            <path d="M100 250 C 72 212 120 196 96 162 C 74 132 124 120 100 88" fill="none" stroke="url(#wbody)" strokeWidth="34" strokeLinecap="round" />
            <g stroke="#3c8629" strokeWidth="2.4" strokeLinecap="round" opacity=".5" fill="none">
              <path d="M88 224 q12 -6 24 -2" /><path d="M86 196 q14 -6 26 0" /><path d="M92 168 q12 -6 22 -1" /></g>
            <ellipse cx="100" cy="78" rx="30" ry="28" fill="url(#wbody)" />
            <ellipse cx="100" cy="86" rx="21" ry="15" fill="#c2ef9f" opacity=".4" />
            <g transform="rotate(-15 100 52)">
              <ellipse cx="100" cy="54" rx="28" ry="6" fill="#1b1b21" />
              <rect x="82" y="18" width="36" height="36" rx="3" fill="#1b1b21" />
              <rect x="82" y="45" width="36" height="6" fill="#c0413f" /></g>
            <path d="M73 60 L92 67" stroke="#27331a" strokeWidth="4" strokeLinecap="round" />
            <path d="M129 57 L110 65" stroke="#27331a" strokeWidth="4" strokeLinecap="round" />
            <ellipse cx="88" cy="76" rx="8" ry="9" fill="#fff" />
            <circle cx="90" cy="79" r="4" fill="#26331a" /><circle cx="87.5" cy="75" r="1.5" fill="#fff" />
            <ellipse cx="114" cy="74" rx="8" ry="9" fill="#fff" />
            <circle cx="116" cy="77" r="4" fill="#26331a" /><circle cx="113.5" cy="73" r="1.5" fill="#fff" />
            <circle cx="114" cy="74" r="13" fill="none" stroke="#ecc64c" strokeWidth="3.2" />
            <path d="M113 86 Q 122 104 129 111" fill="none" stroke="#ecc64c" strokeWidth="1.8" />
            <circle cx="130" cy="113" r="2.4" fill="#ecc64c" />
            <path d="M82 96 Q 100 115 122 92" fill="none" stroke="#27331a" strokeWidth="3.4" strokeLinecap="round" />
            <path d="M92 101 L96 108 L100 101 Z" fill="#fff" />
          </svg>
        </div></div>
        <div className="wurm-mound">
          {clods.map((c, i) => <span key={i} className="wurm-clod" style={{ '--dx': c[0] + 'px', '--dy': c[1] + 'px', animationDelay: (0.45 + i * 0.025) + 's' }} />)}
          <svg width="280" height="86" viewBox="0 0 280 86" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 86 L0 48 Q 70 16 142 30 Q 214 44 280 22 L280 86 Z" fill="#5a3d27" />
            <path d="M0 50 Q 70 20 142 34 Q 214 48 280 26" fill="none" stroke="#714e34" strokeWidth="6" />
            <ellipse cx="140" cy="33" rx="30" ry="10" fill="#3c2918" />
          </svg>
        </div>
      </div>
      <div className="wurm-hint">muahaha… tap to dismiss</div>
    </div>
  );
}

function SettingsView({ plan, onRegenerate, onReset, onExport, onEditFitness, onEditPlan, onReleaseWurm }) {
  const [wc, setWc] = useState(0);
  const clickWurm = () => { const n = wc + 1; if (n >= 10) { setWc(0); onReleaseWurm(); } else setWc(n); };
  const p = plan.profile;
  return (
    <>
      <div className="section-title">Settings</div>
      <div className="card">
        <h2>{p.name}</h2>
        <p className="lead">Training for the {T.RACES[p.raceType].name} on {T.fmtDate(T.iso(p.raceDate), { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        <div className="statline">
          <div className="s"><b>{p.daysPerWeek}</b><span>days/week</span></div>
          <div className="s"><b style={{ textTransform: 'capitalize' }}>{p.fitness}</b><span>level</span></div>
          <div className="s"><b>{plan.totalWeeks}</b><span>weeks</span></div>
        </div>
        <div className="statline">
          <div className="s"><b>{p.fivekSec ? T.fmtPace(p.fivekSec / 5) : '~' + T.fmtPace((T.FITNESS[p.fitness] || T.FITNESS.intermediate).est5k / 5)}</b><span>{p.fivekSec ? '5k pace/km' : '5k pace · est'}</span></div>
          <div className="s"><b>{p.css100Sec ? T.fmtPace(p.css100Sec) : '~' + T.fmtPace((T.FITNESS[p.fitness] || T.FITNESS.intermediate).estCss)}</b><span>{p.css100Sec ? 'swim /100m' : 'swim · est'}</span></div>
          <div className="s"><b>{p.ftp || 'RPE'}</b><span>{p.ftp ? 'FTP watts' : 'bike by feel'}</span></div>
        </div>
        <div style={{ height: 12 }} />
        <button className="btn primary" onClick={onEditFitness}><Icon name="trend" size={18} /> Update fitness &amp; re-target</button>
        {plan.updatedAt && (() => {
          const prev = (p.fitnessHistory || []).slice(-1)[0];
          const delta = prev && prev.fivekSec && p.fivekSec
            ? ' · 5k ' + T.fmtPace(prev.fivekSec) + ' → ' + T.fmtPace(p.fivekSec) : '';
          return <p className="lead" style={{ margin: '10px 2px 0' }}>Paces re-targeted {T.fmtDate(T.iso(plan.updatedAt.slice(0, 10)), { month: 'short', day: 'numeric' })}{delta}</p>;
        })()}
        <div style={{ height: 10 }} />
        <button className="btn ghost" onClick={onEditPlan}><Icon name="calendar" size={18} /> Edit race &amp; schedule</button>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Sync & export</h2>
        <button className="btn primary" onClick={onExport}><Icon name="download" size={18} /> Export plan to calendar (.ics)</button>
        <p className="lead" style={{ margin: '10px 2px 0' }}>Downloads every session as all-day events with the full workout in the notes — import into Apple Calendar, Google Calendar or Outlook.</p>
      </div>
      <div className="card">
        <button className="btn ghost" onClick={onRegenerate}>↺ Start over / new plan</button>
        <div style={{ height: 10 }} />
        <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={onReset}>Clear all progress</button>
      </div>
      {/* Secret: quietly tap this footer 10× to release ze Würm. No label, no hint. */}
      <div className="center muted wurm-trigger" style={{ fontSize: 12 }} onClick={clickWurm}>Try · built with React</div>
    </>
  );
}

/* ---------------- building screen ---------------- */
// A brief, on-brand interstitial shown right after onboarding. The plan is
// already generated synchronously — this is purely a moment of anticipation
// so the hand-off doesn't feel abrupt. Messages are personalised to the plan.
function BuildingPlan({ plan, onDone }) {
  const p = plan.profile;
  const race = (T.RACES[plan.race] || {}).name || 'race';
  const steps = [
    'Reading your goals…',
    'Mapping out your ' + race + ' race day…',
    'Periodising Base → Build → Peak → Taper…',
    'Scheduling ' + p.daysPerWeek + ' sessions a week across ' + plan.totalWeeks + ' weeks…',
    'Setting your target paces…',
    'Your plan is ready',
  ];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const per = 460;
    const tick = setInterval(() => setStep(s => (s < steps.length - 1 ? s + 1 : s)), per);
    const done = setTimeout(onDone, per * (steps.length - 1) + 750);
    return () => { clearInterval(tick); clearTimeout(done); };
  }, []);
  const last = step === steps.length - 1;
  return (
    <div className="building">
      <div className="building-inner">
        <div className={'build-tiles' + (last ? ' done' : '')}>
          {['swim', 'bike', 'run'].map(k =>
            <span key={k} className="build-tile" style={{ background: D[k].grad }}>
              <Icon name={k} size={26} />
            </span>
          )}
        </div>
        <h1 className="build-title">{last ? "You're all set" : 'Building your plan'}</h1>
        <div key={step} className="build-step">{steps[step]}</div>
        <div className="build-bar"><span style={{ width: ((step + 1) / steps.length * 100) + '%' }} /></div>
      </div>
    </div>
  );
}

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
