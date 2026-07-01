/* a11y: make a non-<button> element keyboard-operable — focusable and driven by
   Enter/Space, with a button role. Spread onto clickable <div>s: {...tap(fn)}. */
export function tap(handler) {
  return {
    role: 'button', tabIndex: 0, onClick: handler,
    onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); } },
  };
}
