/* Dev harness (untracked pattern → committed like its siblings): mounts
   ProgressView in the three modes phase 3 changes, Clerk-free. */
import '@/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProgressView } from '@/features/progress/ProgressView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { powerCurve, CURVE_DURATIONS } from '@/lib/bike-power-curve.js';
import { iso, addDays } from '@/lib/date.js';

const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const runs = [
  { id: 'r1', type: 'Run', date: '2026-07-21', movingTimeSec: 3000, distance: 9000 },
  { id: 'r2', type: 'Run', date: '2026-07-14', movingTimeSec: 3200, distance: 10000 },
];
/* Phase 6: relative-dated fixtures so every progress story renders in the
   walk (the stories window off the real clock). */
const ago = n => iso(addDays(new Date(), -n));
const storyActs = [
  // longest recorded run, set three days ago with two priors
  { id: 's1', type: 'Run', date: ago(30), movingTimeSec: 3600, distance: 10000 },
  { id: 's2', type: 'Run', date: ago(20), movingTimeSec: 4500, distance: 12000 },
  { id: 's3', type: 'Run', date: ago(3), movingTimeSec: 5700, distance: 15000 },
  // rising complete run-volume weeks behind them
  { id: 's4', type: 'Run', date: ago(21), movingTimeSec: 2400, distance: 8000 },
  { id: 's5', type: 'Run', date: ago(14), movingTimeSec: 2400, distance: 11000 },
  { id: 's6', type: 'Run', date: ago(7), movingTimeSec: 2400, distance: 18000 },
];
/* One discipline per card since the durability split: the harness has to
   cover all three or it cannot show the thing it exists to show. Swim
   carries hrMissing because pool heart rate usually is. */
const storyDurability = [
  ...[2, 9, 13].map(n => ({
    activityId: 'sd' + n, date: ago(n), discipline: 'run', durationMin: 95,
    read: { band: 'held-strong', outputDropPct: 1.2, hrDriftPct: 2.5, efDropPct: null, hrMissing: false },
  })),
  ...[3, 10].map(n => ({
    activityId: 'sdb' + n, date: ago(n), discipline: 'bike', durationMin: 165,
    read: { band: 'faded-a-little', outputDropPct: 5.4, hrDriftPct: 6.1, efDropPct: 4.2, hrMissing: false },
  })),
  ...[4, 11].map(n => ({
    activityId: 'sds' + n, date: ago(n), discipline: 'swim', durationMin: 55,
    read: { band: 'held-strong', outputDropPct: 0, hrDriftPct: null, efDropPct: null, hrMissing: true },
  })),
];
const storyDecisions = [{
  id: 'dev-d1', at: new Date(Date.now() - 2 * 864e5).toISOString(), status: 'accepted',
  headline: 'Retarget your FTP to the tested number', why: 'accepted from the sheet', confidence: 'high',
}];
const storyRunLoad = { acute7d: 150, baselineWeekly: 140, rampPct: 0.07 };
// a populated curve so the Bike tab and its no-tab Overview fallback both show
const RATIO = { 5: 4.0, 15: 3.0, 30: 2.4, 60: 1.8, 180: 1.38, 300: 1.25, 720: 1.10, 1200: 1 / 0.95, 2400: 1.0, 3600: 0.97 };
const curve = powerCurve(CURVE_DURATIONS.map(d => ({
  durationSec: d, watts: Math.round(250 * RATIO[d]),
  date: '2026-07-01', source: 'Assioma', bike: 'road', indoor: false, quality: 'high',
})));
const coach = {
  weekMonday: '2026-07-27', ruleVersion: 2, tracker: false,
  overall: { decision: 'hold', headline: 'Hold steady. This workload is doing its job', evidence: [{ signal: 'the week', reading: 'Two of five sessions in so far.' }], conflicting: [] },
  disciplines: { run: { decision: 'hold', headline: 'Doing its job', evidence: [], clean: true } },
  progression: null,
};
const MODES = {
  // durability rides on tri too: it is the only mode with all three tabs,
  // so it is the one that can show the per-discipline split at all
  tri: { plan: generatePlan(profile), coach, durability: storyDurability },
  solo: { plan: generatePlan({ ...profile, raceType: 'runhalf' }), coach },
  // tracker has no tabs at all, so it is the mode that exercises the
  // Overview fallback: all three cards must appear there or they vanish
  tracker: { plan: buildTrackerPlan(generatePlan(profile), '2026-07-27T10:00:00.000Z'), coach: null, durability: storyDurability },
  stories: {
    plan: generatePlan(profile), coach,
    activities: storyActs, durability: storyDurability,
    decisionLog: storyDecisions, runLoad: storyRunLoad,
  },
};

function Harness() {
  const [mode, setMode] = useState('tri');
  const m = MODES[mode];
  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 8, padding: '10px 0' }}>
        {Object.keys(MODES).map(k => (
          <button key={k} className={'btn sm ' + (mode === k ? 'primary' : 'ghost')} style={{ width: 'auto' }}
            onClick={() => setMode(k)}>{k}</button>
        ))}
      </div>
      <ProgressView key={mode} plan={m.plan} log={{}} moves={{}} activities={m.activities || runs} coach={m.coach}
        durability={m.durability || null} fuelLog={{}} wellness={[]} runLoad={m.runLoad || null} recovery={null}
        onSupport={() => {}} onWhatIf={null} retest={null} ftpRetest={null}
        powerCurve={curve} previousPowerCurve={null} positionLog={{}} decisionLog={m.decisionLog || []} />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
