import { useRef } from 'react';

/* The pill row that switches between views: the calendar's Week/Month/Season
 * and Progress's Overview/Swim/Bike/Run.
 *
 * ONE component because there were two, byte-alike in markup and identical on
 * screen, and both claimed role="tablist" while implementing none of what
 * that role promises: no roving tabindex, no arrow keys. A tablist tells a
 * screen-reader user "this is a set of tabs, use the arrows" — so the
 * announcement was an instruction the widget could not honour (calendar
 * audit, 2026-08-06). Fixing one surface and leaving its identical-looking
 * twin behaving differently would be the worse outcome, so the fix is the
 * extraction.
 *
 * Automatic activation (arrow moves focus AND selects) rather than manual
 * (arrow moves focus, Enter selects): both surfaces switch instantly on tap,
 * every panel is already rendered, and a keyboard user should get the same
 * behaviour as a pointer user rather than a second, slower model.
 *
 * `items` is [key, label] pairs — the shape both call sites already had.
 * `idFor`/`controlsFor` are optional: Progress wires its tabs to panels,
 * the calendar's ranges have no panel element to point at, and inventing
 * aria-controls for one would be a promise about markup that is not there. */
export function SegBar({ label, items, value, onChange, idFor, controlsFor }) {
  const refs = useRef([]);
  const go = i => {
    const n = (i + items.length) % items.length;   // wraps, as a tablist should
    onChange(items[n][0]);
    if (refs.current[n]) refs.current[n].focus();
  };
  const onKeyDown = (e, i) => {
    // Both axes: the row is horizontal, but a screen reader's own navigation
    // may present it either way, and Home/End are part of the same contract.
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
  };
  return (
    <div className="segbar" role="tablist" aria-label={label}>
      {items.map(([k, lab], i) => (
        <button key={k} type="button" role="tab" aria-selected={value === k}
          id={idFor ? idFor(k) : undefined}
          aria-controls={controlsFor ? controlsFor(k) : undefined}
          /* Roving: one stop for the whole row, so Tab moves past the set
             rather than through it, and the arrows walk inside it. */
          tabIndex={value === k ? 0 : -1}
          ref={el => { refs.current[i] = el; }}
          className={value === k ? 'on' : ''}
          onKeyDown={e => onKeyDown(e, i)}
          onClick={() => onChange(k)}>{lab}</button>
      ))}
    </div>
  );
}
