/* Dev harness (committed like its siblings): mounts DetailSheet Clerk-free
   on the session shapes phase 6 changes. The adhoc mode is a live crash
   canary: it mirrors the openRecording SSR fixture (no type, no week, no
   segments) and must render without a why-not-harder fold or a kit line. */
import '@/styles.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DetailSheet } from '@/components/DetailSheet.jsx';
import { generatePlan } from '@/lib/plan.js';
import { swimKit } from '@/lib/swim-kit.js';
import { RUN_QUALITY_TYPES } from '@/lib/runschema.js';

const base = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 72,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03', ...over,
});

const tri = generatePlan(base());
const solo = generatePlan(base({ raceType: 'runhalf' }));
// OW sessions need a swim quality slot, which the 5-day template lacks
const ow = generatePlan(base({ openWaterRace: true, fitness: 'advanced', trainingDays: [0, 1, 2, 3, 4, 5, 6], daysPerWeek: 7 }));
const find = (plan, pred) => plan.weeks.flatMap(w => w.workouts).find(pred);

const MODES = {
  recovery: { plan: tri, w: find(tri, w => tri.weeks[w.week] && tri.weeks[w.week].isRecovery && w.discipline !== 'rest' && !w.race && w.type) },
  // a genuine quality-TYPE run in a two-quality week (role alone can pick a
  // ladder-demoted Easy jog, which correctly gets no fold)
  'solo-quality': { plan: solo, w: find(solo, w => w.discipline === 'run' && RUN_QUALITY_TYPES.includes(w.type) && !w.race && !w.test && solo.weeks[w.week] && !solo.weeks[w.week].isRecovery && solo.weeks[w.week].workouts.filter(x => x.discipline === 'run' && !x.test && RUN_QUALITY_TYPES.includes(x.type)).length >= 2) },
  'race-week': { plan: tri, w: find(tri, w => w.raceWeek && w.raceWeekFrom) },
  'easy-tri': { plan: tri, w: find(tri, w => w.role === 'easy' && !w.race && !w.raceWeek && tri.weeks[w.week] && !tri.weeks[w.week].isRecovery) },
  'gear-swim': { plan: tri, w: find(tri, w => w.discipline === 'swim' && swimKit(w)) },
  'ow-swim': { plan: ow, w: find(ow, w => w.discipline === 'swim' && (w.segments || []).some(s => s.ow)) },
  adhoc: { plan: tri, w: { id: 'adhoc-1', adhoc: true, title: 'Lunch run', discipline: 'run', durationMin: 40, date: tri.weeks[0].workouts[0].date } },
};

const noop = () => {};
function Harness() {
  const [mode, setMode] = useState('recovery');
  const m = MODES[mode];
  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 8, padding: '10px 0', flexWrap: 'wrap' }}>
        {Object.keys(MODES).map(k => (
          <button key={k} className={'btn sm ' + (mode === k ? 'primary' : 'ghost')} style={{ width: 'auto' }}
            onClick={() => setMode(k)}>{k}{MODES[k].w ? '' : ' (none)'}</button>
        ))}
      </div>
      {m.w ? <DetailSheet key={mode} w={m.w} plan={m.plan} done={false} eff={m.w.date}
        onClose={noop} onToggle={noop} onMove={noop} onResetMove={noop} onLogResult={noop}
        feel={null} onFeel={noop} onRestore={noop} onRemove={noop} activity={null}
        onLoadIntervals={null} onSupport={noop} onWhatIf={null} onReplayRecap={noop}
        fuelLog={{}} onFuel={noop} positionLog={{}} onPosition={noop} brick={null}
        onCue={null} cueAnswer={null} onReview={noop} />
        : <div className="card">No session of this shape in the generated plan.</div>}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Harness />);
