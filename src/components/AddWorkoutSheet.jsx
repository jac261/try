import { useState } from 'react';
import * as T from '@/lib';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';

const D = T.DISCIPLINES;

/* Add a session outside the plan: pick a sport, a session from the library and
   a duration. The workout is built from the same templates as planned sessions,
   so its steps, load estimate and watch copy behave like any other. */
const TYPE_OPTIONS = {
  run: ['Easy', 'Long', 'Fartlek', 'Tempo', 'Threshold', 'VO2 Intervals'],
  bike: ['Endurance', 'Long', 'Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'],
  swim: ['Technique', 'Endurance', 'CSS Intervals', 'Race Pace', 'Open Water'],
  brick: ['Brick'],
  strength: ['Strength'],
};
const DEFAULT_DUR = { run: 45, bike: 60, swim: 40, brick: 60, strength: 40 };

export function AddWorkoutSheet({ onAdd, onClose }) {
  const [disc, setDisc] = useState('run');
  const [type, setType] = useState('Easy');
  const [dur, setDur] = useState(DEFAULT_DUR.run);
  const pick = d => { setDisc(d); setType(TYPE_OPTIONS[d][0]); setDur(DEFAULT_DUR[d]); };
  const fixed = disc === 'strength';
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="grab" />
        <h2 style={{ margin: '0 0 4px', fontSize: 21, letterSpacing: '-.5px' }}>Add a session</h2>
        <div className="muted" style={{ fontSize: 13 }}>An extra session on today, outside your plan. It counts towards your training load like any other.</div>
        <div className="aw-lab">Sport</div>
        <div className="aw-discs">
          {Object.keys(TYPE_OPTIONS).map(d => (
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
            <button className="btn ghost sm" type="button" onClick={() => setDur(d => Math.max(20, d - 5))}>−5</button>
            <div className="aw-durv">{T.fmtDuration(dur)}</div>
            <button className="btn ghost sm" type="button" onClick={() => setDur(d => Math.min(240, d + 5))}>+5</button>
          </div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 18 }} type="button"
          onClick={() => onAdd({ discipline: disc, type, durationMin: dur })}>Add to today</button>
      </div>
    </div>
  );
}
