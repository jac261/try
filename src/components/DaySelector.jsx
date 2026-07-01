import { tap } from '@/utils/a11y.js';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Pick training days (≥3) and the long-session day. days = sorted weekday indices.
export function DaySelector({ days, longDay, onChange }) {
  const toggle = d => {
    let nd = days.indexOf(d) >= 0 ? days.filter(x => x !== d) : days.concat([d]);
    if (nd.length < 3) return;                       // always keep at least 3 training days
    nd.sort((a, b) => a - b);
    let nl = longDay;
    if (nd.indexOf(nl) < 0) nl = nd.indexOf(5) >= 0 ? 5 : (nd.indexOf(6) >= 0 ? 6 : nd[nd.length - 1]);
    onChange(nd, nl);
  };
  return (
    <>
      <div className="days">
        {[0, 1, 2, 3, 4, 5, 6].map(d =>
          <div key={d} className={'d' + (days.indexOf(d) >= 0 ? ' on' : '')} {...tap(() => toggle(d))}>{DAY_LETTERS[d]}</div>)}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>{days.length} training days · the rest are rest days</div>
      <label className="field" style={{ marginTop: 16, marginBottom: 0 }}><span className="lab">Long session day <span className="hint">your big ride / run</span></span></label>
      <div className="days" style={{ marginTop: 8 }}>
        {[0, 1, 2, 3, 4, 5, 6].map(d => {
          const sel = days.indexOf(d) >= 0;
          return <div key={d} className={'d' + (longDay === d ? ' on' : '')} {...(sel ? tap(() => onChange(days, d)) : {})}
            style={{ opacity: sel ? 1 : .3, cursor: sel ? 'pointer' : 'default' }}>{DAY_LETTERS[d]}</div>;
        })}
      </div>
    </>
  );
}

