import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { useSheetFocus } from '@/utils/useSheetFocus.js';
import { Icon } from '@/components/Icon.jsx';

const D = T.DISCIPLINES;

/* Add a session outside the plan: pick a sport, a session from the library and
   a duration. The workout is built from the same templates as planned sessions,
   so its steps, load estimate and watch copy behave like any other.
   mode="log" is the tracker diary's flavour of the same sheet: a session the
   athlete already DID, stored as a manual activity — no generated structure,
   an optional feel, and (when editing an existing entry) a delete affordance. */
const TYPE_OPTIONS = {
  run: ['Easy', 'Long', 'Fartlek', 'Tempo', 'Threshold', 'VO2 Intervals'],
  bike: ['Endurance', 'Long', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'],
  swim: ['Technique', 'Endurance', 'CSS Intervals', 'Race Pace', 'Open Water'],
  brick: ['Brick'],
  strength: ['Strength'],
};
const DEFAULT_DUR = { run: 45, bike: 60, swim: 40, brick: 60, strength: 40 };

export function AddWorkoutSheet({ onAdd, onClose, initialDisc, dateISO, mode, editing, onDelete }) {
  const log = mode === 'log';
  // Log mode drops the brick: a brick is a paired ride+run structure the plan
  // generates; a done brick is honestly logged as its two legs.
  const sports = Object.keys(TYPE_OPTIONS).filter(d => (log ? d !== 'brick' : true));
  // The calendar's cards open this sheet with a sport preselected and a
  // target day (the selected calendar day); the Today doorway passes neither.
  const e0 = editing || null;
  const init = e0 ? e0.sport : (TYPE_OPTIONS[initialDisc] ? initialDisc : 'run');
  const d0 = sports.includes(init) ? init : 'run';
  const [disc, setDisc] = useState(d0);
  const [type, setType] = useState(e0 ? e0.sessionType : TYPE_OPTIONS[d0][0]);
  const [dur, setDur] = useState(e0 ? e0.durationMin : DEFAULT_DUR[d0]);
  const [feel, setFeel] = useState(e0 ? e0.feel || null : null);
  const pick = d => { setDisc(d); setType(TYPE_OPTIONS[d][0]); setDur(DEFAULT_DUR[d]); };
  // Only plan mode's strength has a generated structure to describe; a logged
  // strength session's load is duration-driven, so it keeps the stepper.
  const fixed = !log && disc === 'strength';
  const target = e0 ? e0.date : (dateISO || T.iso(new Date()));
  const dayLabel = target === T.iso(new Date()) ? 'today'
    : T.fmtDate(target, { weekday: 'long', month: 'short', day: 'numeric' });
  const heading = e0 ? 'Edit session' : log ? 'Log a session' : 'Add a session';
  const sub = e0 ? 'Update the details, or remove it if you logged it by mistake.'
    : log ? 'A session you did, outside a plan. It lands in your training diary and on your calendar.'
      : 'An extra session on ' + dayLabel + ', outside your plan. It counts towards your training load like any other.';
  const sheetRef = useSheetFocus(onClose);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={heading} onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 21, letterSpacing: '-.5px' }}>{heading}</h2>
        <div className="muted" style={{ fontSize: 13 }}>{sub}</div>
        <div className="aw-lab">Sport</div>
        <div className="aw-discs">
          {sports.map(d => (
            <div key={d} className={'aw-disc' + (disc === d ? ' on' : '')} {...tap(() => pick(d))}>
              <div className="dot" style={{ background: D[d].grad }}><Icon name={D[d].icon} size={20} /></div>
              <span>{D[d].name}</span>
            </div>
          ))}
        </div>
        <div className="aw-lab">Session</div>
        <div className="aw-types">
          {TYPE_OPTIONS[disc].map(t => (
            <div key={t} className={'aw-type' + (type === t ? ' on' : '')} {...tap(() => setType(t))}>{t}</div>
          ))}
        </div>
        <div className="aw-lab">Duration</div>
        {fixed
          ? <div className="muted" style={{ fontSize: 13 }}>Strength sessions run their own ~40 minute structure.</div>
          : <div className="aw-dur">
            <button className="btn ghost sm" type="button" onClick={() => setDur(d => Math.max(20, d - 5))}><span className="sgn">−</span>5</button>
            <div className="aw-durv">{T.fmtDuration(dur)}</div>
            <button className="btn ghost sm" type="button" onClick={() => setDur(d => Math.min(240, d + 5))}><span className="sgn">+</span>5</button>
          </div>}
        {log && <>
          <div className="aw-lab">How did it feel? <span className="hint" style={{ textTransform: 'none', letterSpacing: 0 }}>optional</span></div>
          <div className="feel-row">
            {[['easy', 'Easy'], ['right', 'Just right'], ['hard', 'Hard']].map(([k, lab]) =>
              <button key={k} type="button" className={'feelbtn' + (feel === k ? ' on ' + k : '')}
                onClick={() => setFeel(f => (f === k ? null : k))}>{lab}</button>)}
          </div>
        </>}
        <button className="btn primary" style={{ width: '100%', marginTop: 18 }} type="button"
          onClick={() => onAdd({ discipline: disc, type, durationMin: dur, dateISO: target, feel })}>
          {e0 ? 'Save changes' : (log ? 'Log for ' : 'Add to ') + dayLabel}</button>
        {log && !e0 && <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 8 }}>Kept on this device.</div>}
        {e0 && onDelete && <button className="btn ghost remove" style={{ width: '100%', marginTop: 10 }} type="button"
          onClick={() => { if (confirm("Remove this logged session? This can't be undone.")) onDelete(); }}>Remove this session</button>}
      </div>
    </div>
  );
}
