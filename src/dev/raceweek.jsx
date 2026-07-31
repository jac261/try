/* Dev-only visual harness for the race-week countdown card.
 *
 * Same trick as curve.jsx: the card lives on Today behind Clerk, so this
 * root entry mounts the real component with the real stylesheet and fixture
 * plans. `now` is pinned to a fixed morning so every case renders the same
 * whatever the wall clock says. Ticks persist to an in-memory store, so the
 * checklist is interactive but nothing touches real user storage.
 */
import '@/styles.css';
import { createRoot } from 'react-dom/client';
import { RaceWeekCard } from '@/features/today/RaceWeekCard.jsx';
import * as T from '@/lib';

const NOW = new Date('2026-08-10T08:00:00');
const planAt = (days, race = 'olympic') =>
  ({ race, profile: { raceDate: T.iso(T.addDays(NOW, days)) }, weeks: [] });
const mem = () => {
  const m = {};
  return { load: (k, fb) => (k in m ? m[k] : fb), save: (k, v) => { m[k] = v; } };
};

const CASES = [
  ['Week opens (7 days out)', planAt(7)],
  ['Mid taper (4 days out, checklist interactive)', planAt(4)],
  ['Eve of the race (1 day)', planAt(1)],
  ['Race day', planAt(0)],
  ['Solo run race (half marathon, 5 days)', planAt(5, 'runhalf')],
  ['Outside the window (8 days: renders nothing)', planAt(8)],
];

createRoot(document.getElementById('root')).render(
  <div className="app" style={{ paddingTop: 20 }}>
    {CASES.map(([label, plan]) => (
      <div key={label}>
        <div className="section-title">{label}</div>
        <RaceWeekCard plan={plan} storage={mem()} now={NOW} />
      </div>
    ))}
  </div>
);
