import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';

export function FitnessEditor({ profile, onClose, onSave }) {
  const lvl0 = T.FITNESS[profile.fitness] ? profile.fitness : 'intermediate';
  const [f, setF] = useState({
    fitness: lvl0,
    fivek: profile.fivekSec ? T.fmtPace(profile.fivekSec) : '',
    css100: profile.css100Sec ? T.fmtPace(profile.css100Sec) : '',
    ftp: profile.ftp || '',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="Update fitness" onClick={e => e.stopPropagation()}>
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
