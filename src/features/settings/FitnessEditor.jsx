import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';

export function FitnessEditor({ profile, onClose, onSave, noPlan, solo }) {
  const lvl0 = T.FITNESS[profile.fitness] ? profile.fitness : 'intermediate';
  // Closed only for an athlete who never set a goal: they never meet
  // weight-goal language. But a returning athlete WITH a goal must see it
  // open, or the collapsed link is indistinguishable from No goal and
  // clearing the goal (the whole escape hatch) has hidden friction
  // (gauntlet catch 2026-07-22).
  const [goalOpen, setGoalOpen] = useState(!!profile.massGoal);
  const [f, setF] = useState({
    fitness: lvl0,
    fivek: profile.fivekSec ? T.fmtPace(profile.fivekSec) : '',
    css100: profile.css100Sec ? T.fmtPace(profile.css100Sec) : '',
    ftp: profile.ftp || '',
    weightKg: profile.weightKg || '',
    massGoal: profile.massGoal || null,
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="Update fitness" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>Update fitness</h2>
        <p className="lead">{noPlan
          ? <>Logged a test, race or just got fitter? Update your numbers and they carry into your fitness history, ready for your next plan.</>
          : <>Logged a test, race or just got fitter? Update your numbers and every <b>upcoming</b> session re-targets to the new paces. Completed sessions and reschedules stay put.</>}</p>
        {/* This sheet edits the athlete, not the plan, so every field stays
            even on a run-only plan; the sentence says which one drives it. */}
        {solo && <p className="lead" style={{ fontSize: 13, marginTop: -4 }}>Your run time drives this plan; swim and bike numbers are kept for your next multisport plan.</p>}
        <label className="field"><span className="lab">Experience level</span></label>
        <div className="choice">
          {Object.values(T.FITNESS).map(l => (
            <div key={l.key} className={'opt' + (f.fitness === l.key ? ' on' : '')} {...tap(() => set('fitness', l.key))}>{l.name}<small>{solo ? l.runBlurb : l.blurb}</small></div>
          ))}
        </div>
        <div style={{ height: 16 }} />
        <label className="field"><span className="lab">Recent 5 km run time <span className="hint">optional · mm:ss</span></span>
          <input value={f.fivek} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].est5k)} onChange={e => set('fivek', e.target.value)} /></label>
        <label className="field"><span className="lab">Swim pace per 100 m <span className="hint">optional · mm:ss</span></span>
          <input value={f.css100} placeholder={'e.g. ' + T.fmtPace(T.FITNESS[f.fitness].estCss)} onChange={e => set('css100', e.target.value)} /></label>
        {/* Placeholder only, exactly like the run and swim estimates above:
            pre-filling the level estimate into the field would let a guess
            become a saved, untilded FTP on a single tap (design panel
            2026-07-18). */}
        <label className="field"><span className="lab">Cycling FTP <span className="hint">optional · watts</span></span>
          <input value={f.ftp} placeholder={'e.g. ' + (T.saneWeightKg(f.weightKg) ? Math.round(T.FITNESS[f.fitness].estWkg * T.saneWeightKg(f.weightKg)) : 200)} inputMode="numeric" onChange={e => set('ftp', e.target.value)} /></label>
        <label className="field"><span className="lab">Weight <span className="hint">optional · kg — lets the bike join the weakest-link scale (W/kg)</span></span>
          <input value={f.weightKg} placeholder="e.g. 70" inputMode="decimal" onChange={e => set('weightKg', e.target.value)} /></label>
        {/* Closed by default on purpose: an athlete who never opens this
            never meets weight-goal language at all. Without a declared goal
            the app tracks weight and never judges it (design panel
            2026-07-21). */}
        {!goalOpen && <a className="reset" role="button" {...tap(() => setGoalOpen(true))}>Body-mass goal (optional)</a>}
        {goalOpen && <>
          <label className="field" style={{ marginTop: 8 }}><span className="lab">Body-mass goal <span className="hint">optional</span></span></label>
          <div className="choice">
            <div className={'opt' + (!f.massGoal ? ' on' : '')} {...tap(() => set('massGoal', null))}>No goal<small>Weight is tracked but never judged.</small></div>
            <div className={'opt' + (f.massGoal === 'hold' ? ' on' : '')} {...tap(() => set('massGoal', 'hold'))}>Holding steady<small>Shows the weekly rate against staying level.</small></div>
            <div className={'opt' + (f.massGoal === 'gain' ? ' on' : '')} {...tap(() => set('massGoal', 'gain'))}>Gaining on purpose<small>Shows a weekly rate against a gradual gain target.</small></div>
          </div>
        </>}
        <button className="btn primary" onClick={() => onSave({
          fitness: f.fitness,
          fivekSec: T.parseTimeToSec(f.fivek),
          css100Sec: T.parseTimeToSec(f.css100),
          ftp: f.ftp ? Number(f.ftp) : null,
          weightKg: f.weightKg ? Number(f.weightKg) : null,
          massGoal: f.massGoal || null,
        })}>{noPlan ? 'Save to fitness history' : 'Save & re-target plan'}</button>
      </div>
    </div>
  );
}
