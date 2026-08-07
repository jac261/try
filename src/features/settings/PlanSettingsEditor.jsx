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
  /* A maintenance block edits like the fresh choice it is. Its raceType
     appears in NEITHER pill list (both filter noRace out), so initialising
     f.raceType with it left nothing selected while keeping Save enabled —
     and its raceDate is the roll's synthetic horizon Sunday, which the
     extend card routes athletes here to replace at the exact moment it is
     at most 14 days away (audit 2026-08-07). Both reset to the tracker
     defaults: pick a race, and the date starts 12 weeks out. */
  const noRace = !!(T.RACES[profile.raceType] || {}).noRace;
  const [f, setF] = useState({
    raceType: noRace ? null : profile.raceType,
    // Tracker mode nulls raceDate; default the picker to 12 weeks out rather
    // than the epoch (T.iso(null) is 1970-01-01, which would build a broken
    // past-dated plan if saved unchanged). A noRace plan's synthetic horizon
    // date defaults the same way.
    raceDate: profile.raceDate && !noRace ? T.iso(profile.raceDate) : T.iso(T.addDays(new Date(), 12 * 7)),
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
  const todayISO = T.iso(new Date());
  const tuneTooClose = tune && tune.date && f.raceDate
    && T.daysBetween(tune.date, f.raceDate) < 10 && T.daysBetween(tune.date, f.raceDate) >= 0;
  /* The other side of the same boundary: a tune-up typed AFTER the goal race
     (the input max constrains the picker, not the keyboard, and moving the
     race date earlier never re-validates). It used to save silently and ride
     into generation (audit 2026-08-07). */
  const tuneAfterRace = tune && tune.date && f.raceDate && T.daysBetween(tune.date, f.raceDate) < 0;
  /* Save refuses what generatePlan cannot build. An empty date produced a
     zero-week NaN plan without throwing; a past one (reachable because the
     prefill has no past guard and min= constrains only the picker) rebuilt a
     dead plan while wholesale-clearing real overlay data. And a tune-up with
     a kind but no date was silently discarded — the sheet closed as if it
     saved. Each refusal says why, below the button. */
  const dateInvalid = !f.raceDate || f.raceDate < todayISO;
  const tuneIncomplete = !!tune && !tune.date;
  const saveBlocked = !f.raceType || dateInvalid || tuneIncomplete || !!tuneAfterRace;
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="Edit plan" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>Edit plan</h2>
        {/* Honest about all three discards: reshapePlan clears reschedules,
            eases and coach adjustments wholesale (the id-reuse hazard its
            comment documents), so this lead must not promise they survive —
            it did, and the athlete read it seconds before losing them
            (audit 2026-08-07). */}
        <p className="lead">Change your race or schedule and the plan rebuilds around it. Completed sessions are kept for the days that still exist; your fitness and paces carry over. Reschedules and coach adjustments reset with the new structure.</p>
        <label className="field"><span className="lab">Race</span></label>
        <div className="lab muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>Triathlon</div>
        <div className="choice">
          {Object.values(T.RACES).filter(r => !r.noRace && !r.solo).map(r => (
            <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} aria-pressed={f.raceType === r.key}
              {...tap(() => pickRace(r.key))}>{r.name}<small>{r.swim}k · {r.bike}k · {r.run}k</small></div>
          ))}
        </div>
        <div className="lab muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>Running</div>
        <div className="choice">
          {Object.values(T.RACES).filter(r => r.solo).map(r => (
            <div key={r.key} className={'opt' + (f.raceType === r.key ? ' on' : '')} aria-pressed={f.raceType === r.key}
              {...tap(() => pickRace(r.key))}>{r.name}<small>{r.run} km</small></div>
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
              <div key={r.key} className={'opt' + (tune.kind === r.key ? ' on' : '')} aria-pressed={tune.kind === r.key}
                {...tap(() => setTune(t => ({ ...t, kind: r.key })))}>{r.name}</div>
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
        {f.raceType && dateInvalid && <p className="lead" style={{ margin: '0 2px 8px' }}>
          {f.raceDate ? 'That race date has already passed — pick a day ahead.' : 'Pick a race date to build the plan.'}</p>}
        {f.raceType && !dateInvalid && tuneIncomplete && <p className="lead" style={{ margin: '0 2px 8px' }}>
          Pick a date for the tune-up race, or remove it.</p>}
        {f.raceType && !dateInvalid && tuneAfterRace && <p className="lead" style={{ margin: '0 2px 8px' }}>
          The tune-up is after your goal race — move it earlier, or remove it.</p>}
        <button className="btn primary" disabled={saveBlocked}
          onClick={() => !saveBlocked && onSave({ raceType: f.raceType, raceDate: f.raceDate, daysPerWeek: f.trainingDays.length, trainingDays: f.trainingDays, longDay: f.longDay,
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
