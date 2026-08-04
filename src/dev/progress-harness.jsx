/* Dev harness (untracked pattern → committed like its siblings): mounts
   ProgressView in the three modes phase 3 changes, Clerk-free. */
import '@/styles.css';
import { initHarnessTheme } from '@/dev/harness-theme.js';
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
/* The shapes behind the design's three charts. Deterministic and hand-set
   rather than generated: these are the numbers a reviewer checks the chart
   against, so they have to be readable in the source.

   Only the NEWEST session of each sport carries a shape. That is deliberate
   and it is the real state of the store — shapes are backfilled two sessions
   per app load and older cached reads predate the field entirely, so the
   harness shows a card whose chart comes from one session and whose rows go
   back further. */
const bikeShape = {
  sport: 'bike', axis: 'kJ',
  points: [
    { kJ: 700, watts: 258, laps: 4 }, { kJ: 1400, watts: 253, laps: 4 },
    { kJ: 2100, watts: 243, laps: 4 }, { kJ: 2800, watts: 227, laps: 4 },
  ],
  totalKJ: 2800, dropPct: 12, holdPct: [100, 98, 94, 88],
};
const runShape = {
  sport: 'run', axis: 'm',
  points: [
    { metres: 5000, pace: 292, hr: 142, laps: 5 }, { metres: 10000, pace: 295, hr: 146, laps: 5 },
    { metres: 15000, pace: 298, hr: 151, laps: 5 }, { metres: 21000, pace: 306, hr: 155, laps: 6 },
  ],
  totalM: 21000, decouplingPct: 4.8, hrDriftPct: 9.2,
};
const swimShape = {
  sport: 'swim', axis: 'm',
  points: [
    { metres: 750, pace100: 96, strokesPerLength: 16, laps: 8 },
    { metres: 1500, pace100: 98, strokesPerLength: 16, laps: 8 },
    { metres: 2250, pace100: 99, strokesPerLength: 15, laps: 7 },
    { metres: 3000, pace100: 101, strokesPerLength: 14.5, laps: 7 },
  ],
  totalM: 3000, paceDriftSec: 5, strokeDrift: -1.5, deviceCounted: true,
};
const storyDurability = [
  ...[2, 9, 13].map(n => ({
    activityId: 'sd' + n, date: ago(n), discipline: 'run', durationMin: 95,
    read: { band: 'held-strong', outputDropPct: 1.2, hrDriftPct: 2.5, efDropPct: null, hrMissing: false },
    ...(n === 2 ? { shape: runShape } : {}),
  })),
  ...[3, 10].map(n => ({
    activityId: 'sdb' + n, date: ago(n), discipline: 'bike', durationMin: 165,
    read: { band: 'faded-a-little', outputDropPct: 5.4, hrDriftPct: 6.1, efDropPct: 4.2, hrMissing: false },
    ...(n === 3 ? { shape: bikeShape } : {}),
  })),
  ...[4, 11].map(n => ({
    activityId: 'sds' + n, date: ago(n), discipline: 'swim', durationMin: 55,
    read: { band: 'held-strong', outputDropPct: 0, hrDriftPct: null, efDropPct: null, hrMissing: true },
    ...(n === 4 ? { shape: swimShape } : {}),
  })),
];
/* The refusal, made visible. A swim whose stroke derivations disagreed gets
   NO shape at all, so its card must fall back to rows — the same path every
   pre-backfill session takes. Without a mode that produces this, the refusal
   is a branch nobody can look at. */
const refusedDurability = storyDurability.map(e => (e.discipline === 'swim' ? { ...e, shape: null } : e));
const storyDecisions = [{
  id: 'dev-d1', at: new Date(Date.now() - 2 * 864e5).toISOString(), status: 'accepted',
  headline: 'Retarget your FTP to the tested number', why: 'accepted from the sheet', confidence: 'high',
}];
const storyRunLoad = { acute7d: 150, baselineWeekly: 140, rampPct: 0.07 };
/* Two curves, because one of them cannot show the thing the chart is for.
   RATIO is the shape table itself, so that rider sits exactly on the expected
   line: the right fixture for proving the two coincide, and useless for
   seeing a shape. REAL is a real 365-day curve (Jon's, via intervals.icu),
   which diverges. The 3, 12 and 40 minute bests are interpolated because the
   intervals summary endpoint does not carry them; they are marked medium
   quality so nothing reads them as measured bests. */
const RATIO = { 5: 4.0, 15: 3.0, 30: 2.4, 60: 1.8, 180: 1.38, 300: 1.25, 720: 1.10, 1200: 1 / 0.95, 2400: 1.0, 3600: 0.97 };
const REAL = { 5: 682, 15: 617, 30: 483, 60: 372, 180: 300, 300: 265, 720: 218, 1200: 201, 2400: 188, 3600: 182 };
const INTERPOLATED = new Set([180, 720, 2400]);
const mkCurve = (watts, q = () => 'high') => powerCurve(CURVE_DURATIONS.map(d => ({
  durationSec: d, watts: watts(d),
  date: '2026-07-01', source: 'Assioma', bike: 'road', indoor: false, quality: q(d),
})));
const curve = mkCurve(d => Math.round(250 * RATIO[d]));
const withFtp = (plan, ftp) => ({ ...plan, profile: { ...plan.profile, ftp } });
const shapedCurve = mkCurve(d => REAL[d], d => (INTERPOLATED.has(d) ? 'medium' : 'high'));
const coach = {
  weekMonday: '2026-07-27', ruleVersion: 2, tracker: false,
  overall: { decision: 'hold', headline: 'Hold steady. This workload is doing its job', evidence: [{ signal: 'the week', reading: 'Two of five sessions in so far.' }], conflicting: [] },
  disciplines: { run: { decision: 'hold', headline: 'Doing its job', evidence: [], clean: true } },
  progression: null,
};
/* Wellness was `[]` here, so the whole "Fitness & recovery" section — four
   charts — could only ever render its empty state in this harness. That is the
   shape-the-harness-cannot-make problem again, and the readiness trend moving
   into that section (2026-08-04) is exactly when it starts to matter.

   Sixty days ending today, so the trend is always in range whenever this is
   opened: a slow fitness build with fatigue riding above it (form negative,
   the interesting case), and readiness inputs that wander across the bands
   rather than sitting flat. Deterministic — a sine, not a random walk, so two
   runs of the harness look the same and a screenshot means something. */
const WELLNESS = (() => {
  const today = iso(new Date());
  return Array.from({ length: 60 }, (_, i) => {
    const ctl = 42 + i * 0.42;                          // building
    const atl = ctl + 6 * Math.sin(i / 4.5) + 3;        // fatigue rides above it
    return {
      date: addDays(today, i - 59),                     // -59 .. 0
      ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl - atl).toFixed(1),
      hrv: Math.round(64 + 9 * Math.sin(i / 5.2)),
      rhr: Math.round(48 - 3 * Math.sin(i / 5.2)),
      sleepH: +(7.1 + 0.9 * Math.sin(i / 3.1)).toFixed(1),
    };
  });
})();
const MODES = {
  // durability rides on tri too: it is the only mode with all three tabs,
  // so it is the one that can show the per-discipline split at all
  tri: { plan: generatePlan(profile), coach, durability: storyDurability },
  // the swim's stroke reading refused: its card must show rows, not a chart
  refused: { plan: generatePlan(profile), coach, durability: refusedDurability },
  // a real rider's curve, so the expected-shape line has something to diverge
  // from and the profile reads something other than "even"
  /* FTP 191 is what this curve's own 20-minute best implies (0.95 x 201), so
     the shape reads against a threshold the rides support rather than a
     stale one. The profile is patched rather than regenerated: an ftp change
     would move plan generation too, and this mode exists to look at a chart. */
  shape: { plan: withFtp(generatePlan(profile), 191), coach, durability: storyDurability, powerCurve: shapedCurve },
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
        durability={m.durability || null} fuelLog={{}} wellness={WELLNESS} runLoad={m.runLoad || null} recovery={null}
        onSupport={() => {}} onWhatIf={null} retest={null} ftpRetest={null}
        powerCurve={m.powerCurve || curve} previousPowerCurve={m.previousPowerCurve || null} positionLog={{}} decisionLog={m.decisionLog || []} />
    </div>
  );
}
initHarnessTheme();
createRoot(document.getElementById('root')).render(<Harness />);
