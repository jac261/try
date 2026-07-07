import { useState } from 'react';
import * as T from '@/lib';
import { Icon } from '@/components/Icon.jsx';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
const D = T.DISCIPLINES;

export function WellnessEditor({ onClose, onSave }) {
  const [f, setF] = useState({ hrv: '', sleepH: '', rhr: '', tsb: '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const num = v => (v === '' || v == null ? null : Number(v));
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="This morning's readiness" onClick={e => e.stopPropagation()}>
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
