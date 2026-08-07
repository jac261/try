import { useState } from 'react';
import { tap } from '@/utils/a11y.js';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* Pick training days (at least 3) and the long-session day. days = sorted
   weekday indices.

   The two letter rows are identical glyphs with different meanings, so each
   cell carries the full day name and its row's purpose in its label, plus
   aria-pressed — without that a screen reader heard "button, T" four times
   with no way to tell Tuesday from Thursday, chosen from not, or one row
   from the other (audit 2026-08-07). The note line is aria-live because two
   of this control's behaviours are side effects the eye must otherwise
   catch mid-row: deselecting the long day silently reassigns it, and a tap
   that would go below three days silently no-ops. Both now say so, to
   everyone. */
export function DaySelector({ days, longDay, onChange }) {
  const [note, setNote] = useState('');
  const toggle = d => {
    let nd = days.indexOf(d) >= 0 ? days.filter(x => x !== d) : days.concat([d]);
    if (nd.length < 3) { setNote('At least 3 training days — add another before removing ' + DAY_NAMES[d] + '.'); return; }
    nd.sort((a, b) => a - b);
    let nl = longDay;
    if (nd.indexOf(nl) < 0) {
      nl = nd.indexOf(5) >= 0 ? 5 : (nd.indexOf(6) >= 0 ? 6 : nd[nd.length - 1]);
      setNote(DAY_NAMES[longDay] + ' was your long day, so it moved to ' + DAY_NAMES[nl] + '.');
    } else setNote('');
    onChange(nd, nl);
  };
  return (
    <>
      <div className="days">
        {[0, 1, 2, 3, 4, 5, 6].map(d =>
          <div key={d} className={'d' + (days.indexOf(d) >= 0 ? ' on' : '')} aria-pressed={days.indexOf(d) >= 0}
            aria-label={'Train on ' + DAY_NAMES[d]} {...tap(() => toggle(d))}>{DAY_LETTERS[d]}</div>)}
      </div>
      <div className="hint" style={{ marginTop: 8 }} aria-live="polite">
        {days.length} training days · the rest are rest days{note ? ' · ' + note : ''}</div>
      <label className="field" style={{ marginTop: 16, marginBottom: 0 }}><span className="lab">Long session day <span className="hint">your big ride / run</span></span></label>
      <div className="days" style={{ marginTop: 8 }}>
        {[0, 1, 2, 3, 4, 5, 6].map(d => {
          const sel = days.indexOf(d) >= 0;
          return <div key={d} className={'d' + (longDay === d ? ' on' : '')}
            aria-label={'Long session on ' + DAY_NAMES[d]} aria-pressed={longDay === d}
            aria-disabled={!sel || undefined}
            {...(sel ? tap(() => { setNote(''); onChange(days, d); }) : {})}
            style={{ opacity: sel ? 1 : .3, cursor: sel ? 'pointer' : 'default' }}>{DAY_LETTERS[d]}</div>;
        })}
      </div>
    </>
  );
}
