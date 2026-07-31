/* Dev harness (committed like its siblings): mounts TodayView Clerk-free on
   the day shapes the phase 5 briefing distinguishes. TodayView reads the
   REAL clock, so each mode scans startDate offsets until real-today lands on
   the wanted day shape, rather than pretending to inject a date. */
import '@/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TodayView } from '@/features/today/TodayView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { iso, addDays } from '@/lib/date.js';

const today = new Date();
const todayISO = iso(today);
const base = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'elite',
  fivekSec: 1200, css100Sec: 95, ftp: 300, weightKg: 72,
  trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7,
  startDate: iso(addDays(today, -35)), raceDate: iso(addDays(today, 77)), ...over,
});

/* Plans snap their week grid to Monday, so shifting startDate day by day
   cannot steer which weekday a double or long ride falls on. Instead the
   harness uses the app's own moves mechanism (TodayView resolves effDate)
   to land the wanted sessions on real-today. */
const scanPlan = (pred, over = {}) => {
  for (let back = 28; back <= 70; back += 7) {
    const p = generatePlan(base({ startDate: iso(addDays(today, -back)), ...over }));
    const day = p.weeks.flatMap(w => w.workouts).filter(w => w.date === todayISO && w.discipline !== 'rest');
    const wk = p.weeks.find(w => w.workouts.some(x => x.date >= todayISO));
    if (pred(day, wk)) return p;
  }
  return generatePlan(base(over)); // fall back to something rather than nothing
};
const moveOntoToday = (pickIds, over = {}) => {
  const p = generatePlan(base(over));
  const all = p.weeks.flatMap(w => w.workouts);
  const ids = pickIds(all) || [];
  const moves = {};
  // clear today's own sessions out of the way, then land the picked ones
  all.filter(w => w.date === todayISO && w.discipline !== 'rest' && !ids.includes(w.id))
    .forEach(w => { moves[w.id] = iso(addDays(today, 1)); });
  ids.forEach(id => { moves[id] = todayISO; });
  return { plan: p, moves };
};

const MODES = {
  single: () => ({ plan: scanPlan(day => day.length === 1 && !day[0].race && !day[0].test), moves: {} }),
  double: () => moveOntoToday(all => {
    const dbl = all.find(w => w.second && w.discipline === 'strength');
    if (!dbl) return null;
    const host = all.find(w => w.date === dbl.date && !w.second && w.discipline !== 'rest');
    return host ? [host.id, dbl.id] : null;
  }),
  'long-ride': () => moveOntoToday(all => {
    const long = all.find(w => w.discipline === 'bike' && w.type === 'Long' && !w.race);
    return long ? [long.id] : null;
  }),
  brick: () => moveOntoToday(all => {
    // a half-distance brick asks more than the no-history default, so the
    // proven-fuel toggle visibly caps this cue (olympic rides never do)
    const brick = all.find(w => w.discipline === 'brick' && !w.race);
    return brick ? [brick.id] : null;
  }, { raceType: 'half' }),
  recovery: () => ({ plan: scanPlan((day, wk) => wk && wk.isRecovery && day.length >= 1), moves: {} }),
  'race-day': () => ({ plan: generatePlan(base({ startDate: iso(addDays(today, -112)), raceDate: todayISO })), moves: {} }),
  rest: () => ({ plan: scanPlan(day => day.length === 0, { trainingDays: [1, 3, 5], daysPerWeek: 3, fitness: 'beginner' }), moves: {} }),
  tracker: () => ({ plan: buildTrackerPlan(generatePlan(base()), new Date().toISOString()), moves: {} }),
};

const noop = () => {};
function Harness() {
  const [mode, setMode] = useState('double');
  const [proven, setProven] = useState(false);
  const { plan, moves } = MODES[mode]();
  // With no history everything sits on the novice default, so the visible
  // demo is a proven tolerance RAISING the ceiling: 'solid' (60 g/h held)
  // lets a half-distance brick ask its full demand instead of the default.
  // Watch the brick mode's cue rise when this is on.
  const fuelLog = proven ? { a1: { level: 'solid', discipline: 'bike' } } : {};
  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 8, padding: '10px 0', flexWrap: 'wrap' }}>
        {Object.keys(MODES).map(k => (
          <button key={k} className={'btn sm ' + (mode === k ? 'primary' : 'ghost')} style={{ width: 'auto' }}
            onClick={() => setMode(k)}>{k}</button>
        ))}
        <button className={'btn sm ' + (proven ? 'primary' : 'ghost')} style={{ width: 'auto' }}
          onClick={() => setProven(v => !v)}>proven fuel</button>
      </div>
      <TodayView key={mode + proven} plan={plan} log={{}} moves={moves} open={noop} onTune={noop}
        wellness={[]} onFeel={noop} onEditWellness={noop} easedOf={w => w} onEaseToday={noop}
        onRestoreToday={noop} weekly={null} onWeekly={noop} spotted={null} onLogSpotted={noop}
        onAddWorkout={noop} eftp={null} onEftp={noop} onToggleWorkout={noop} planEdge={null}
        onSupport={noop} activities={[]} displayActivities={[]} recovery={null}
        onOpenRecording={noop} onEditPlan={noop} onEnterTracker={noop} offerTracker={false}
        adjust={{}} adjustLog={[]} coachLog={{}} blockReviewed={null} onBlockReviewed={noop}
        onFocus={noop} storage={null} retest={null} onRetest={noop} cssFail={null} onFixCss={noop}
        runFail={null} onFixRun={noop} ftpRetest={null} onFtpRetest={noop} startShortfall={null}
        onDecision={noop} fuelLog={fuelLog} />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
