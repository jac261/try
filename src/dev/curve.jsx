/* Dev-only visual harness for the power curve (untracked, not shipped).
 *
 * The real PowerCurveCard lives behind Clerk AND behind a backend endpoint
 * that may not be serving, so neither the tests nor the app could show me
 * what it actually looks like. Vite serves any root HTML entry directly, so
 * this mounts the real component with the real stylesheet and fixture data,
 * bypassing main.jsx and therefore Clerk. No credentials, no backend.
 */
import '@/styles.css';
import { createRoot } from 'react-dom/client';
import { PowerCurveCard } from '@/components/PowerCurveCard.jsx';
import { powerCurve } from '@/lib/bike-power-curve.js';

const FTP = 260;
const pt = (durationSec, watts, extra = {}) => ({
  durationSec, watts, date: '2026-07-01', source: 'Quarq', bike: 'Tarmac', indoor: false, quality: 'high', ...extra,
});
// A plausible rider: ~260 W threshold, punchy sprint.
const REAL = [[5, 880], [15, 700], [30, 560], [60, 450], [180, 340], [300, 315], [720, 280], [1200, 268], [2400, 250], [3600, 242]];
const raw = (f = () => ({})) => powerCurve(REAL.map(([d, w], i) => pt(d, w, f(d, w, i))));
const scaled = (k, f = () => ({})) => powerCurve(REAL.map(([d, w], i) => pt(d, Math.round(w * k), f(d, w, i))));

const CASES = [
  ['Full curve', { curve: raw() }],
  ['Comparable previous curve (both lines drawn)', { curve: raw(), previous: scaled(0.95) }],
  ['Previous on a DIFFERENT meter (line withheld)', { curve: raw(), previous: scaled(0.95, () => ({ source: 'Assioma' })) }],
  ['Sparse: only 5 s, 1 min, 60 min', { curve: powerCurve([pt(5, 880), pt(60, 450), pt(3600, 242)]) }],
  ['Hour best gone stale', { curve: raw((d) => (d === 3600 ? { date: '2026-01-01' } : {})) }],
  ['No threshold known', { curve: raw(), ftpWatts: null }],
];

createRoot(document.getElementById('root')).render(
  <div className="wrap" style={{ maxWidth: 460, margin: '0 auto', padding: 16 }}>
    <h1 style={{ fontSize: 18, marginBottom: 4 }}>Power curve harness</h1>
    <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
      Dev only. Fixture data, real component, real stylesheet.
    </p>
    {CASES.map(([title, props]) => (
      <section key={title} data-case={title} style={{ marginBottom: 28 }}>
        <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{title}</div>
        <PowerCurveCard ftpWatts={FTP} todayISO="2026-07-30" previous={null} {...props} />
      </section>
    ))}
  </div>,
);
