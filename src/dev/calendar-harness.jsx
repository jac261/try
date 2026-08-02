/* Dev harness (committed like its siblings): mounts CalendarView Clerk-free
   on the shapes the two 2026-08-01 bug fixes touch. Dates are relative to the
   real clock, because both bugs are about how a plan meets today. */
import '@/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

const today = new Date();
const todayISO = iso(today);
const base = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: todayISO, raceDate: iso(addDays(today, 112)), ...over,
});

// A plan that starts TODAY, whatever weekday that is: the bug-1 shape.
const startsToday = generatePlan(base());
// A plan started on the Thursday of this week, so the trim is always visible
// even when the harness is opened on a Monday.
const thursday = iso(addDays(startOfWeekMonday(today), 3));
const startsThursday = generatePlan(base({ startDate: thursday, raceDate: iso(addDays(thursday, 112)) }));

const firstBike = p => p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'bike' && w.durationMin > 0 && !w.race);
const bike = firstBike(startsToday);
const rideOn = (d, min, id) => ({ id, type: 'Ride', date: d, movingTimeSec: min * 60, distance: 30000 });

/* A block with no race. It had no mode here, which is how the gold race ring
   survived on the horizon day of every maintenance plan: the bug was only
   visible in a shape the harness could not make. */
const mondayOf = startOfWeekMonday(today);
const maintenance = generatePlan(base({
  raceType: 'maintenance', horizonWeeks: 12,
  startDate: iso(mondayOf), raceDate: iso(addDays(mondayOf, 12 * 7 - 1)),
}));

/* Every cell state the grid can be in, in one month where possible: days
   before the plan began (off, and still tappable — that is the pre-plan
   diary), today, the day you have selected, and race day. */
const shortStart = iso(addDays(today, -28));
const states = generatePlan(base({ startDate: shortStart, raceDate: iso(addDays(today, 12)) }));

/* Ten weeks in with eight to go: the shape the season range needs and none of
   the other modes has. Every other plan here starts at or near today, so the
   ramp would be one solid point and seventeen dashed ones — a chart whose
   whole point is the join between done and planned, with nothing to join. */
const midSeason = generatePlan(base({
  startDate: iso(addDays(mondayOf, -10 * 7)), raceDate: iso(addDays(mondayOf, 8 * 7 + 2)),
}));

/* No plan at all, which is where the week range would be at its most wrong:
   plan.weeks is [] in tracker mode, so seven days of nothing must not come
   back as seven rest days for an athlete whose training is all recordings. */
const trackerPlan = buildTrackerPlan(generatePlan(base()), todayISO);
const trackerActs = [-1, -3, -4].map((n, i) => ({
  id: 'tr' + i, type: i === 1 ? 'Run' : 'Ride', name: i === 1 ? 'Evening run' : 'Commute',
  date: iso(addDays(today, n)), movingTimeSec: (40 + i * 15) * 60, distance: 15000 + i * 5000,
}));

const MODES = {
  'starts-today': { plan: startsToday, activities: [], log: {} },
  'starts-thursday': { plan: startsThursday, activities: [], log: {} },
  // a ticked bike session plus its matching recording: ONE dot
  matched: { plan: startsToday, activities: [rideOn(bike.date, bike.durationMin, 'r-match')], log: { [bike.id]: { done: true } } },
  // the same recording with nothing ticked: the recording is its own fact
  unmatched: { plan: startsToday, activities: [rideOn(bike.date, bike.durationMin, 'r-unmatched')], log: {} },
  // two rides, one ticked session: the second must not be swallowed
  'two-rides': {
    plan: startsToday, log: { [bike.id]: { done: true } },
    activities: [rideOn(bike.date, bike.durationMin, 'r-a'), rideOn(bike.date, bike.durationMin, 'r-b')],
  },
  // no race: no gold ring anywhere, and no pin
  maintenance: { plan: maintenance, activities: [], log: {} },
  // off-plan, today, selected and race day together
  states: { plan: states, activities: [], log: {} },
  // no plan, recordings only: the week range must say "Nothing recorded."
  tracker: { plan: trackerPlan, activities: trackerActs, log: {} },
  // ten weeks done, eight to go: the season's solid half meeting its dashed one
  'mid-season': { plan: midSeason, activities: [], log: {} },
};

/* A fitness history for the season ramp: a rising CTL from the plan's start to
   today, so the solid half has a shape and the dashed half has somewhere to
   start from. Deliberately NOT flat — a flat line hides a projection that
   fails to join the measured one. */
const historyFor = plan => {
  if (!plan.weeks.length) return [];
  const out = [];
  let ctl = 38;
  for (let d = plan.weeks[0].start; d <= todayISO; d = iso(addDays(d, 1))) {
    ctl += 0.16;
    out.push({ date: d, ctl: Math.round(ctl * 10) / 10, atl: Math.round((ctl + 4) * 10) / 10, tsb: -4 });
  }
  return out;
};

const noop = () => {};
function Harness() {
  const [mode, setMode] = useState('starts-thursday');
  const m = MODES[mode];
  // A tracker plan has no weeks at all, which is the whole point of that mode
  // and is what this panel used to crash on.
  const wk0 = m.plan.weeks[0];
  const early = !wk0 ? [] : m.plan.weeks.flatMap(w => w.workouts)
    .filter(w => w.discipline !== 'rest' && w.date < (m.plan.firstWeekFrom || wk0.start));
  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 8, padding: '10px 0', flexWrap: 'wrap' }}>
        {Object.keys(MODES).map(k => (
          <button key={k} className={'btn sm ' + (mode === k ? 'primary' : 'ghost')} style={{ width: 'auto' }}
            onClick={() => setMode(k)}>{k}</button>
        ))}
      </div>
      {/* Deliberately NOT a .card. It used to be, and it blurred, so it
          counted itself into the app's measured blur total and the style
          guide carried a Calendar figure one too high. The instrument must
          not show up in the reading. */}
      <div style={{
        fontSize: 12, padding: 14, marginBottom: 14, borderRadius: 14,
        background: 'rgba(0,0,0,.3)', border: '1px dashed rgba(255,255,255,.2)',
      }}>
        plan starts <b>{wk0 ? wk0.start : 'no plan (tracker)'}</b> · trimmed from <b>{m.plan.firstWeekFrom || 'not trimmed'}</b> ·
        week 1 sessions <b>{wk0 ? wk0.workouts.filter(w => w.discipline !== 'rest').length : 0}</b> ·
        sessions before the start: <b style={{ color: early.length ? 'var(--danger)' : 'var(--run)' }}>{early.length}</b>
      </div>
      <CalendarView key={mode} plan={m.plan} log={m.log} moves={{}} open={noop} easedOf={w => w}
        onToggleWorkout={noop} onMove={noop} activities={m.activities}
        onOpenRecording={noop} onAddWorkout={noop}
        wellness={m.wellness || historyFor(m.plan)} adjust={{}} />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
