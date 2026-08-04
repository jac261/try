/* Dev-only visual harness for the icon set (not shipped — the vite build
 * lists only index.html and the style guide as inputs).
 *
 * The glass emboss is a sub-pixel effect at most sizes and it only exists
 * above a threshold, so it is invisible to a test and nearly invisible in
 * the app. This is the surface that makes it checkable: every icon, at every
 * size the app actually uses, on both of the backdrops that matter — a plain
 * card, where icons are monochrome chrome, and a discipline tile, where they
 * are white on a gradient and where the doc illustrates the effect.
 */
import '@/styles.css';
import { initHarnessTheme } from '@/dev/harness-theme.js';
import { createRoot } from 'react-dom/client';
import { Icon } from '@/components/Icon.jsx';
import { DISCIPLINES } from '@/lib/disciplines.js';

// Every name in the set, in the order Icon.jsx declares them.
const NAMES = ['logo', 'swim', 'bike', 'run', 'brick', 'rest', 'strength', 'today',
  'calendar', 'plan', 'progress', 'you', 'plus', 'grip', 'bolt', 'flag', 'flame',
  'download', 'trend', 'watch', 'transition', 'stopwatch', 'route', 'heartrate',
  'pace', 'trophy', 'settings', 'book', 'nextplan'];

/* The sizes the app really renders at, with the threshold sitting between 22
   and 26. Reading left to right across a row, the emboss should switch on
   exactly once and never for the logo. */
const SIZES = [15, 18, 22, 26, 32, 64];
const EMBOSS_MIN = 26;

const Label = ({ children }) => (
  <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', margin: '18px 0 8px' }}>{children}</div>
);

// A row of one icon at every size, so the threshold is visible as a step.
const Row = ({ name, tile }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '7px 0' }}>
    <div className="muted" style={{ fontSize: 11, width: 74, flex: 'none' }}>{name}</div>
    {SIZES.map(size => (
      <div key={size} data-icon={name} data-size={size}
        data-expect={size >= EMBOSS_MIN && name !== 'logo' ? 'embossed' : 'flat'}
        style={{ width: 68, display: 'grid', placeItems: 'center' }}>
        {tile ? (
          <div className="dot" style={{
            width: size + 20, height: size + 20, borderRadius: Math.round((size + 20) * 0.3),
            display: 'grid', placeItems: 'center', color: '#fff',
            background: DISCIPLINES[tile].grad,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.12), inset 0 1px 0 rgba(255,255,255,.45), 4px 6px 14px rgba(0,0,0,.4)',
          }}><Icon name={name} size={size} /></div>
        ) : <Icon name={name} size={size} />}
      </div>
    ))}
  </div>
);

initHarnessTheme();
createRoot(document.getElementById('root')).render(
  <div className="wrap" style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
    <h1 style={{ fontSize: 18, marginBottom: 4 }}>Icons harness</h1>
    <p className="muted" style={{ fontSize: 12, marginTop: 0, lineHeight: 1.5 }}>
      Dev only. Sizes {SIZES.join(' / ')} px; the emboss switches on at {EMBOSS_MIN}.
      Every tile carries <code>data-expect</code> so the check can be computed
      rather than squinted at.
    </p>

    <Label>On a discipline tile (white on a gradient — the doc&rsquo;s own case)</Label>
    <div className="card">
      {['swim', 'bike', 'run', 'brick', 'strength', 'rest'].map(k => (
        <Row key={k} name={DISCIPLINES[k].icon} tile={k} />
      ))}
    </div>

    <Label>The brand mark, which stays flat at every size</Label>
    <div className="card"><Row name="logo" /></div>

    <Label>On a card (monochrome — nav, buttons, inline markers)</Label>
    <div className="card">
      {NAMES.filter(n => n !== 'logo').map(n => <Row key={n} name={n} />)}
    </div>
  </div>,
);
