/* Dev harness (committed like its siblings): the app shell chrome, Clerk-free.
 *
 * None of the other seven harnesses renders .topbar or .nav — they each mount
 * one view — and the full app is Clerk-gated with no bypass, so until this
 * existed the two bars every screen carries could not be looked at at all.
 * That is also why the blur counts in STYLE_GUIDE.md were low: they were
 * counted here, where the shell is absent.
 *
 * Both bars are translucent, so what they are over decides whether they work.
 * The content below is deliberately half bright and half dark: scroll it and
 * read the header text and the active tab at each position. A screenshot of
 * one scroll position proves nothing about a surface that shows what is
 * behind it.
 *
 * This mirrors App.jsx's chrome markup rather than importing it. That means
 * it can only ever prove the MATERIAL; the markup itself (the landmark and
 * aria-current) is asserted against the real App in src/app/nav.test.jsx.
 */
import '@/styles.css';
import { initHarnessTheme } from '@/dev/harness-theme.js';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from '@/components/Icon.jsx';

const TABS = [
  ['today', 'today', 'Today'], ['calendar', 'calendar', 'Calendar'],
  ['plan', 'plan', 'Plan'], ['progress', 'progress', 'Progress'],
];

/* Bands the bars have to stay legible over. White and near-white are the hard
   case: a translucent light-tinted pane over bright content is where header
   text disappears. */
const BANDS = [
  { name: 'App background (the lit field)', css: 'transparent' },
  { name: 'Card-dark', css: 'var(--card)' },
  { name: 'Discipline colours', css: 'linear-gradient(90deg, var(--swim), var(--bike), var(--run), var(--brick))' },
  { name: 'Bright', css: 'linear-gradient(180deg, #ffffff, #dfe6f2)' },
  { name: 'White', css: '#ffffff' },
  { name: 'Blue', css: 'var(--blue)' },
  { name: 'Card-dark', css: 'var(--card)' },
  { name: 'Bright', css: '#f4f7fb' },
];

function Harness() {
  const [view, setView] = useState('today');
  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-top">
          <button className="avatar-btn" type="button" aria-label="Profile and settings">
            <span className="avatar avatar-fallback">J</span>
          </button>
          <h1><Icon name="logo" size={26} /> Try</h1>
        </div>
        <div className="sub">Hi Jon</div>
        <div className="race-chip"><span>Outlaw Half Triathlon</span><b>36</b><span>days to go</span></div>
      </div>

      {BANDS.map((b, i) => (
        <div key={i} style={{
          background: b.css, height: 210, borderRadius: 'var(--pane-radius)', marginBottom: 14,
          display: 'grid', placeItems: 'center', color: i > 1 ? '#0e1217' : 'var(--muted)',
          fontWeight: 800, fontSize: 13,
        }}>{b.name}</div>
      ))}

      <nav className="nav" aria-label="Main">
        <div className="tabs">
          {TABS.map(([k, ic, label]) => (
            <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}
              aria-current={view === k ? 'page' : undefined}>
              <span className="ic"><Icon name={ic} size={22} /></span>{label}</button>
          ))}
        </div>
      </nav>
    </div>
  );
}

initHarnessTheme();
createRoot(document.getElementById('root')).render(<Harness />);
