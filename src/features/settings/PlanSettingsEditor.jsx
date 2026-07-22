import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
import { DaySelector } from '@/components/DaySelector.jsx';

const DEFAULT_DAYS = { 3: [1, 5, 6], 4: [0, 1, 3, 5], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };

export function PlanSettingsEditor({ profile, onClose, onSave }) {
  const initDays = (profile.trainingDays && profile.trainingDays.length >= 3)
    ? profile.trainingDays.slice().sort((a, b) => a - b)
    : (DEFAULT_DAYS[Math.max(3, Math.min(7, profile.daysPerWeek))] || DEFAULT_DAYS[5]);
  const initLong = (profile.longDay !== undefined && initDays.indexOf(profile.longDay) >= 0)
    ? profile.longDay : (initDays.indexOf(5) >= 0 ? 5 : initDays[initDays.length - 1]);
  const [f, setF] = useState({
    raceType: profile.raceType,
    // Tracker mode nulls raceDate; default the picker to 12 weeks out rather
    // than the epoch (T.iso(null) is 1970-01-01, which would build a broken
    // past-dated plan if saved unchanged).
    raceDate: profile.raceDate ? T.iso(profile.raceDate) : T.iso(T.addDays(new Date(), 12 * 7)),
    trainingDays: initDays,
    longDay: initLong,
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const selSolo = (T.RACES[f.raceType] || {}).solo || null;
  const curSolo = (T.RACES[profile.raceType] || {}).solo || null;
  // Tune-up kinds scope to the goal race's sport: run goal races offer run
  // events only; tri and maintenance plans keep everything (a parkrun in a
  // tri plan stays correct).
  const tuneKinds = Object.values(T.B_RACES).filter(r => !selSolo || r.discipline === selSolo);
  // Switching sports drops an incompatible tune-up VISIBLY (the section
  // collapses back to its add button) instead of rendering an orphaned pill
  // row and discarding silently on save.
  const pickRace = key => {
    set('raceType', key);
    const ns = (T.RACES[key] || {}).solo || null;
    setTune(t => t && !Object.values(T.B_RACES).some(b => b.key === t.kind && (!ns || b.discipline === ns)) ? null : t);
  };
  // One optional tune-up (B) race — a real event raced inside the plan. The
  // engine drops it onto its day with a mini-taper around it; entries too
  // close to the goal race are ignored at generation, so warn here instead.
  const [tune, setTune] = useState(() => (profile.bRaces && profile.bRaces[0]) || null);
  const tuneTooClose = tune && tune.date && f.raceDate
    && T.daysBetween(tune.date, f.raceDate) < 10 && T.daysBetween(tune.date, f.raceDate) >= 0;
  const todayISO = T.iso(new Date());
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="Edit plan" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>Edit plan</h2>
        <p className="lead">Change your race or schedule and the plan rebuilds around it. Completed sessions and reschedules are kept for the days that still exist; your fitness, paces and progress carry over.</p>
        <label className="field"><span className="lab">Race</span></label>
        <div className="lab muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>Triathlon</div>
        <div className="choice">
          {Object.values(T.RACES).filter(r => !r.noRace && !r.solo).map(r => (
            <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} {...tap(() => pickRace(r.key))}>{r.name}<small>{r.swim}k · {r.bike}k · {r.run}k</small></div>
          ))}
        </div>
        <div className="lab muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>Running</div>
        <div className="choice">
          {Object.values(T.RACES).filter(r => r.solo).map(r => (
            <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} {...tap(() => pickRace(r.key))}>{r.name}<small>{r.run} km</small></div>
          ))}
        </div>
        {selSolo && !curSolo && <p className="lead" style={{ fontSize: 13, margin: '8px 2px 0' }}>
          This becomes a run only plan: swim and bike sessions end here. Your swim and bike numbers stay on your profile for a future triathlon plan.</p>}
        {!selSolo && curSolo && f.raceType && <p className="lead" style={{ fontSize: 13, margin: '8px 2px 0' }}>
          Back to three sports: the plan adds swim and bike sessions around your running.</p>}
        <div style={{ height: 16 }} />
        <label className="field"><span className="lab">Race date</span>
          <input type="date" value={f.raceDate} min={todayISO} onChange={e => set('raceDate', e.target.value)} /></label>
        <label className="field" style={{ marginBottom: 8 }}><span className="lab">Which days will you train?</span></label>
        <DaySelector days={f.trainingDays} longDay={f.longDay} onChange={(d, l) => setF(s => ({ ...s, trainingDays: d, longDay: l }))} />
        <div style={{ height: 16 }} />
        <label className="field" style={{ marginBottom: 8 }}><span className="lab">Tune-up race <span className="hint">optional — a real event raced mid-plan</span></span></label>
        {tune ? <>
          <div className="choice">
            {tuneKinds.map(r => (
              <div key={r.key} className={'opt' + (tune.kind === r.key ? ' on' : '')} {...tap(() => setTune(t => ({ ...t, kind: r.key })))}>{r.name}</div>
            ))}
          </div>
          <div style={{ height: 10 }} />
          <label className="field"><span className="lab">Tune-up date</span>
            <input type="date" value={tune.date || ''} min={todayISO} max={f.raceDate}
              onChange={e => setTune(t => ({ ...t, date: e.target.value }))} /></label>
          {tuneTooClose && <p className="lead" style={{ margin: '0 2px 8px' }}>That's inside the final 10 days before your goal race, so the plan will protect the taper and skip it — pick an earlier date.</p>}
          <a className="reset" {...tap(() => setTune(null))} role="button">Remove the tune-up race</a>
          <div style={{ height: 12 }} />
        </> : <>
          <button className="btn ghost sm" onClick={() => setTune({ kind: selSolo ? 'run5k' : 'sprint', date: '' })}>+ Add a tune-up race</button>
          <div style={{ height: 6 }} />
        </>}
        <div style={{ height: 12 }} />
        {/* No race chosen, no plan: a profile fetched from the server is
            plan-independent and carries no raceType, and generatePlan on an
            undefined race type crashes (gauntlet critical 2026-07-17). The
            pills above select one; until then the build stays disabled. */}
        {!f.raceType && <p className="lead" style={{ margin: '0 2px 8px' }}>Pick a race distance above to build the plan.</p>}
        <button className="btn primary" disabled={!f.raceType}
          onClick={() => f.raceType && onSave({ raceType: f.raceType, raceDate: f.raceDate, daysPerWeek: f.trainingDays.length, trainingDays: f.trainingDays, longDay: f.longDay,
            // a solo race cannot exclude its only discipline, and a stale
            // exclusion would turn the NEXT maintenance block run-free; the
            // declared focus dies with the sport switch for the same reason
            ...(selSolo ? { excludedDiscipline: null, blockFocus: null } : {}),
            // an off-list kind (tri tune-up on a now-run plan) is dropped, not saved stale
            bRaces: tune && tune.date && tuneKinds.some(k => k.key === tune.kind) ? [{ kind: tune.kind, date: tune.date }] : [] })}>Save &amp; rebuild plan</button>
      </div>
    </div>
  );
}
