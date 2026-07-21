import { useState } from 'react';
import * as T from '@/lib';
import { Icon } from '@/components/Icon.jsx';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
const D = T.DISCIPLINES;

export function WellnessEditor({ onClose, onSave, existing, lastWeightKg }) {
  // Prefilled from today's existing record, and saved as a MERGE onto it:
  // the store and the backend both replace whole rows per date, so a bare
  // object here silently wiped every synced field the sheet does not show
  // (ctl, atl, sleep score) — a live bug before weight ever joined this
  // sheet (design panel 2026-07-21).
  const e0 = existing || {};
  const [f, setF] = useState({
    hrv: e0.hrv ?? '', sleepH: e0.sleepH ?? '', rhr: e0.rhr ?? '', tsb: e0.tsb ?? '',
    weightKg: e0.weightKg ?? '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const num = v => (v === '' || v == null ? null : Number(v));
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label="This morning's readiness" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <div className="hero"><div className="dot" style={{ background: D.run.grad }}><Icon name="heartrate" size={26} /></div>
          <div><h2>This morning's readiness</h2><div className="s">From your watch this morning</div></div></div>
        <label className="field"><span className="lab">HRV <span className="hint">ms · overnight</span></span>
          <input type="number" inputMode="numeric" value={f.hrv} onChange={e => set('hrv', e.target.value)} placeholder="e.g. 56" /></label>
        <label className="field"><span className="lab">Sleep <span className="hint">hours</span></span>
          <input type="number" inputMode="decimal" step="0.1" value={f.sleepH} onChange={e => set('sleepH', e.target.value)} placeholder="e.g. 7.5" /></label>
        <label className="field"><span className="lab">Resting HR <span className="hint">bpm</span></span>
          <input type="number" inputMode="numeric" value={f.rhr} onChange={e => set('rhr', e.target.value)} placeholder="e.g. 51" /></label>
        <label className="field"><span className="lab">Form / TSB <span className="hint">optional · fills itself once connected</span></span>
          <input type="number" inputMode="numeric" value={f.tsb} onChange={e => set('tsb', e.target.value)} placeholder="e.g. 12" /></label>
        <label className="field"><span className="lab">Weight <span className="hint">optional · kg</span></span>
          <input type="number" inputMode="decimal" step="0.1" min="30" max="250" value={f.weightKg} onChange={e => set('weightKg', e.target.value)} placeholder="e.g. 70.5" /></label>
        <button className="btn primary" onClick={() => {
          const w = num(f.weightKg);
          // a range check cannot catch 150 typed for 150 lb; a step change
          // of more than a tenth against the last known weigh-in earns one
          // question before it enters the averages
          if (w != null && lastWeightKg && Math.abs(w - lastWeightKg) > lastWeightKg * 0.1
            && !confirm('That weight is quite a jump from your last one (' + lastWeightKg + ' kg). Save it anyway?')) return;
          onSave({ ...e0, date: T.iso(new Date()), hrv: num(f.hrv), sleepH: num(f.sleepH), rhr: num(f.rhr), tsb: num(f.tsb), weightKg: w });
        }}>Save readiness</button>
        <div className="fithint">Connect your watch data in Settings and this fills itself each morning. Until then, pop in this morning's numbers.</div>
      </div>
    </div>
  );
}
