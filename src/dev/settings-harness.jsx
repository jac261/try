/* Dev harness (committed like its siblings): mounts SettingsView Clerk-free
   across the anchor archetypes phase 4's Assumption Center distinguishes.
   noAuth swaps the Clerk-dependent cards for placeholders. */
import '@/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsView } from '@/features/settings/SettingsView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';

const base = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const withMeta = p => {
  // clone: generatePlan keeps the profile reference, and stamping meta on a
  // shared base would leak recorded-race provenance into every other mode
  const plan = generatePlan({ ...p });
  plan.profile.fivekMeta = { source: 'recorded-race', measuredAt: '2026-07-01' };
  plan.profile.ftpMeta = { source: 'try-test', measuredAt: '2026-06-20', confidence: 'high' };
  return plan;
};
const MODES = {
  'all-real': { plan: withMeta(base) },
  'all-est': { plan: generatePlan({ ...base, fivekSec: null, css100Sec: null, ftp: null }) },
  'no-weight': { plan: generatePlan({ ...base, fivekSec: null, css100Sec: null, ftp: null, weightKg: null }) },
  solo: { plan: generatePlan({ ...base, raceType: 'runhalf' }) },
  tracker: { plan: buildTrackerPlan(generatePlan(base), '2026-07-27T10:00:00.000Z'), tracker: true },
};

const noop = () => {};
function Harness() {
  const [mode, setMode] = useState('all-real');
  const m = MODES[mode];
  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 8, padding: '10px 0', flexWrap: 'wrap' }}>
        {Object.keys(MODES).map(k => (
          <button key={k} className={'btn sm ' + (mode === k ? 'primary' : 'ghost')} style={{ width: 'auto' }}
            onClick={() => setMode(k)}>{k}</button>
        ))}
      </div>
      <SettingsView key={mode} plan={m.plan} tracker={!!m.tracker} noAuth
        onEnterTracker={noop} onRegenerate={noop} onReset={noop} onExport={noop}
        onEditFitness={noop} onEditTechnique={m.tracker || (m.plan.race || '').startsWith('run') ? null : noop}
        onEditPlan={noop}
        onStartMaintenance={m.tracker || m.plan.race === 'maintenance' || (m.plan.race || '').startsWith('run') ? null : noop}
        onReleaseWurm={noop} onWellnessSynced={noop} onExportCalibration={noop}
        calibrationCount={0} watchSync={false} onWatchSync={noop} watchPush={null} onSupportHub={noop} />
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
