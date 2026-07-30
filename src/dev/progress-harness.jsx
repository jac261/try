/* Dev harness (untracked pattern → committed like its siblings): mounts
   ProgressView in the three modes phase 3 changes, Clerk-free. */
import '@/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProgressView } from '@/features/progress/ProgressView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';

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
const coach = {
  weekMonday: '2026-07-27', ruleVersion: 2, tracker: false,
  overall: { decision: 'hold', headline: 'Hold steady. This workload is doing its job', evidence: [{ signal: 'the week', reading: 'Two of five sessions in so far.' }], conflicting: [] },
  disciplines: { run: { decision: 'hold', headline: 'Doing its job', evidence: [], clean: true } },
  progression: null,
};
const MODES = {
  tri: { plan: generatePlan(profile), coach },
  solo: { plan: generatePlan({ ...profile, raceType: 'runhalf' }), coach },
  tracker: { plan: buildTrackerPlan(generatePlan(profile), '2026-07-27T10:00:00.000Z'), coach: null },
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
      <ProgressView key={mode} plan={m.plan} log={{}} moves={{}} activities={runs} coach={m.coach}
        durability={null} fuelLog={{}} wellness={[]} runLoad={null} recovery={null}
        onSupport={() => {}} onWhatIf={null} retest={null} ftpRetest={null}
        powerCurve={null} previousPowerCurve={null} positionLog={{}} decisionLog={[]} />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
