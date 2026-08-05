/* Dev harness (committed like its siblings): mounts TodayView Clerk-free on
   the day shapes the phase 5 briefing distinguishes. TodayView reads the
   REAL clock, so each mode scans startDate offsets until real-today lands on
   the wanted day shape, rather than pretending to inject a date. */
import '@/styles.css';
import { initHarnessTheme } from '@/dev/harness-theme.js';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TodayView } from '@/features/today/TodayView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';
import { weekRange } from '@/lib/schedule.js';

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

/* A memory-backed storage so the digest and race-week persistence actually
   render here. Passing null gated the digest off entirely, which is how the
   embedded "Week in review" shipped without ever having been seen — and it
   also made harness dismissals write to the GLOBAL localStorage namespace
   that production falls back to (audit, 2026-08-05). */
const memStorage = () => {
  const data = {};
  return { ns: 'try.harness.', load: (k, d) => (k in data ? data[k] : d), save: (k, v) => { data[k] = v; } };
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
  /* The week card's own mode. Every other mode passes an empty log, so the
     strip's ticked and missed days — half of what it exists to show — have
     never been visible in this harness at all. This one logs the week's
     sessions up to yesterday and leaves the rest, which is what a real
     Wednesday looks like. */
  /* The digest's own mode: the REVIEWED week (last week, or this one from
     Sunday evening) fully logged, so buildWeeklyDigest returns real content
     and the embedded "Week in review" section is finally visible. */
  digest: () => {
    const plan = generatePlan(base());
    const monday = iso(addDays(startOfWeekMonday(todayISO), -7));
    const days = weekRange(monday);
    const log = {};
    plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline !== 'rest' && w.date >= days[0] && w.date <= days[6])
      .forEach(w => { log[w.id] = { done: true, at: w.date, actualMin: w.durationMin }; });
    return { plan, moves: {}, log };
  },
  /* The coach QUEUE. Every other mode passes each coach prop as null, so the
     queue can never hold more than one card and the cycle chip — the control
     that reaches suggestions 2..N — has never been visible here at all. That
     is how it shipped aria-hidden and pointer-only (audit 2026-08-05). This
     mode holds three: two with actions and a dismiss, and the one card in
     the app that is informational only. */
  'coach-queue': () => ({
    plan: generatePlan(base()), moves: {},
    props: {
      weekly: { kind: 'trim-week', week: 3, targets: ['bike'], headline: 'Trim this week', why: 'Fatigue is running ahead of fitness.' },
      retest: { sig: 'retest:swim:1', headline: 'Time to retest your CSS', why: 'Your last one is six weeks old.' },
      startShortfall: { sig: 'start-shortfall:bike20', text: 'Your bike starts about 20% under where this race usually peaks.' },
    },
  }),
  'week-logged': () => {
    const plan = generatePlan(base());
    const days = weekRange(todayISO);
    const log = {};
    plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline !== 'rest' && w.date >= days[0] && w.date < todayISO)
      .forEach((w, i) => { if (i % 3 !== 1) log[w.id] = { done: true, at: w.date }; });
    return { plan, moves: {}, log };
  },
};

/* Readiness fixtures. Three mornings that exercise the receipts block: one
   where every signal is fine, one where several are against you, and one whose
   deviations the MODEL GIVES NO CREDIT FOR (sleep above the 7h need, resting
   HR below baseline) — the ghost-fill case, which is the whole reason the bars
   distinguish shown-from-scored. 21 days of history so the baseline is real. */
const rdHistory = (mut = () => ({})) => Array.from({ length: 21 }, (_, i) => ({
  date: iso(addDays(today, -(21 - i))),
  hrv: 60 + ((i * 7) % 9) - 4, rhr: 50 + ((i * 3) % 5) - 2, sleepH: 7.2,
  /* ctl/atl as well as tsb: without them hasLoad is false and the Details
     drawer renders only the readiness trend, so the Fitness & Fatigue, Form
     and Ramp charts cannot be checked at all. A fixture that cannot show a
     regression is not a fixture. */
  ctl: 52 + i * 0.6, atl: 56 + ((i * 5) % 11) - 5, tsb: -4,
  ...mut(i),
}));
const RD = {
  none: [],
  good: [...rdHistory(), { date: todayISO, hrv: 70, rhr: 47, sleepH: 8.2, tsb: 6, feel: 'fresh' }],
  rough: [...rdHistory(), { date: todayISO, hrv: 44, rhr: 57, sleepH: 5.1, tsb: -18, feel: 'rough' }],
  // every deviation here is real and none of it moves the score
  uncredited: [...rdHistory(), { date: todayISO, hrv: 61, rhr: 44, sleepH: 9.4, tsb: 1, feel: 'okay' }],
};

const noop = () => {};
function Harness() {
  const [mode, setMode] = useState('double');
  const [proven, setProven] = useState(false);
  const [rd, setRd] = useState('good');
  const { plan, moves, log, props } = MODES[mode]();
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
        {Object.keys(RD).map(k => (
          <button key={k} className={'btn sm ' + (rd === k ? 'primary' : 'ghost')} style={{ width: 'auto' }}
            onClick={() => setRd(k)}>rd:{k}</button>
        ))}
      </div>
      <TodayView key={mode + proven + rd} plan={plan} log={log || {}} moves={moves} open={noop} onTune={noop}
        wellness={RD[rd]} onFeel={noop} onEditWellness={noop} easedOf={w => w} onEaseToday={noop}
        onRestoreToday={noop} weekly={null} onWeekly={noop} spotted={null} onLogSpotted={noop}
        onAddWorkout={noop} eftp={null} onEftp={noop} onToggleWorkout={noop} planEdge={null}
        onSupport={noop} activities={[]} displayActivities={[]}
        onOpenRecording={noop} onEditPlan={noop} onEnterTracker={noop} offerTracker={false}
        adjust={{}} adjustLog={[]} coachLog={{}} blockReviewed={null} onBlockReviewed={noop}
        onFocus={noop} storage={memStorage()} retest={null} onRetest={noop} cssFail={null} onFixCss={noop}
        runFail={null} onFixRun={noop} ftpRetest={null} onFtpRetest={noop} startShortfall={null}
        onDecision={noop} fuelLog={fuelLog} {...(props || {})} />
    </div>
  );
}
initHarnessTheme();
createRoot(document.getElementById('root')).render(<Harness />);
