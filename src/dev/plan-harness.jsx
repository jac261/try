/* Dev harness (committed like its siblings): mounts PlanView Clerk-free on
   the shapes the Plan-page review named. Plan was the last tab without one,
   which is how its states (leadIn, short runway, the recovery-week pill, the
   focus chooser) had never been LOOKED at outside the live app. Dates are
   relative to the real clock, because a plan is always a relationship
   between its weeks and today. */
import '@/styles.css';
import { initHarnessTheme } from '@/dev/harness-theme.js';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanView } from '@/features/plan/PlanView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

const today = new Date();
const todayISO = iso(today);
const mondayOf = startOfWeekMonday(today);
const base = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: todayISO, raceDate: iso(addDays(today, 112)), ...over,
});

// The ordinary shape: a 16-week Olympic build inside the ideal window.
const standard = generatePlan(base());

/* Ticked sessions for the progress bars, deliberately including one entry
   that is NOT done — a feel-only server row (meaningfulLog admits feel or
   notes alone with done: false). The review flagged that the progress bar
   counts entries by EXISTENCE, so this fixture makes the discrepancy
   visible: the bar should read one session, not two. */
const firstTwo = standard.weeks[0].workouts.filter(w => w.discipline !== 'rest').slice(0, 2);
const logDoneAndFeel = firstTwo.length === 2
  ? { [firstTwo[0].id]: { done: true }, [firstTwo[1].id]: { done: false, feel: 'ok' } }
  : {};

// One session moved to another day and one eased, so the fold-out shows the
// Moved tag and the eased row exactly as the app would.
const movable = standard.weeks[1] ? standard.weeks[1].workouts.filter(w => w.discipline !== 'rest') : [];
const movedMap = movable.length ? { [movable[0].id]: iso(addDays(movable[0].date, 1)) } : {};
const easedId = movable.length > 1 ? movable[1].id : null;
const easeIt = w => (w.id === easedId
  ? { ...w, eased: true, durationMin: Math.round(w.durationMin * 0.7) } : w);

// Below the minimum build window: shortRunway true, the amber note.
const shortRunway = generatePlan(base({ raceDate: iso(addDays(today, 6 * 7)) }));
// Beyond the maximum: leadIn Maintain weeks before the real build, the blue note.
const leadIn = generatePlan(base({ raceDate: iso(addDays(today, 28 * 7)) }));
// A standalone run race: solo, so the focus chooser and clauses must hide.
const soloRun = generatePlan(base({ raceType: 'runhalf', raceDate: iso(addDays(today, 12 * 7)) }));
// A rolling keep-fit block: noRace, "Maintenance block" heading, no race day.
const maintenance = generatePlan(base({
  raceType: 'maintenance', horizonWeeks: 12,
  startDate: iso(mondayOf), raceDate: iso(addDays(mondayOf, 12 * 7 - 1)),
}));
// No plan at all: the two tracker CTAs.
const tracker = buildTrackerPlan(generatePlan(base()), todayISO);

const MODES = {
  standard: { plan: standard, log: logDoneAndFeel },
  'eased-moved': { plan: standard, log: {}, moves: movedMap, eased: true },
  'short-runway': { plan: shortRunway, log: {} },
  'lead-in': { plan: leadIn, log: {} },
  'solo-run': { plan: soloRun, log: {} },
  maintenance: { plan: maintenance, log: {} },
  tracker: { plan: tracker, log: {} },
};

const noop = () => {};
function Harness() {
  const [mode, setMode] = useState('standard');
  /* The focus chooser writes through onFocus in the real app (a label-only
     plan patch). Here it lands in local state and is injected into the
     profile, so choosing a focus shows the phase clauses and — when it
     disagrees with the derived limiter — the diverges note, without a sync
     layer behind it. */
  const [focus, setFocus] = useState(null);
  const m = MODES[mode];
  const plan = focus && m.plan.race !== 'tracker'
    ? { ...m.plan, profile: { ...m.plan.profile, blockFocus: focus } }
    : m.plan;
  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 8, padding: '10px 0', flexWrap: 'wrap' }}>
        {Object.keys(MODES).map(k => (
          <button key={k} className={'btn sm ' + (mode === k ? 'primary' : 'ghost')} style={{ width: 'auto' }}
            onClick={() => { setMode(k); setFocus(null); }}>{k}</button>
        ))}
      </div>
      {/* Not a .card, same reason as the calendar harness: the instrument
          must not count itself into the app's measured blur total. */}
      <div style={{
        fontSize: 12, padding: 14, marginBottom: 14, borderRadius: 14,
        background: 'rgba(0,0,0,.3)', border: '1px dashed rgba(255,255,255,.2)',
      }}>
        race <b>{plan.race}</b> · weeks <b>{plan.weeks.length}</b> ·
        leadIn <b>{plan.leadIn || 0}</b> · shortRunway <b>{plan.shortRunway ? 'yes' : 'no'}</b> ·
        focus <b>{focus || 'derived'}</b>
      </div>
      <PlanView key={mode} plan={plan} log={m.log || {}} moves={m.moves || {}}
        open={noop} easedOf={m.eased ? easeIt : (w => w)}
        onToggleWorkout={noop} onSupport={noop}
        onEditPlan={noop} onStartMaintenance={noop}
        onFocus={setFocus} />
    </div>
  );
}
initHarnessTheme();
createRoot(document.getElementById('root')).render(<Harness />);
