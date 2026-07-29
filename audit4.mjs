import { weeklyRunKm } from './src/lib/runstats.js';
import { runVolumeModel, runDurabilitySignals, longRunMix, runLongObjective } from './src/lib/run-durability.js';
import { runLoadFromActivities, runLoadSignal, longRunJumpSignal } from './src/lib/runload.js';
import { runReview, runReviewEvidence } from './src/lib/run-review.js';
import { runFuellingPlan, runFuellingOutcome } from './src/lib/run-fuelling.js';
import { runReadiness } from './src/lib/run-readiness.js';
import { runDashboard } from './src/lib/run-dashboard.js';
import { runWorkoutDistance, distanceForMinutes, repDistanceLabel } from './src/lib/run-units.js';
import { predictRaceTimes } from './src/lib/runstats.js';
import { runBenchmark, runBenchmarkHistory, runProposalDetails, run5kTestActivityFor, fivekFromTestIntervals, fivekTestIssues } from './src/lib/run-benchmark.js';
import { generatePlan } from './src/lib/plan.js';

const TODAY = '2026-07-29';

console.log('--- E: weeklyRunKm vs runVolumeModel on identical activities ---');
const acts = [
  { id: 1, type: 'Run', date: '2026-07-27', distance: 10000, movingTimeSec: 3000 },
  // manual diary entry: distance but no recorded moving time
  { id: 2, type: 'Run', date: '2026-07-28', distance: 8000 },
  // recording with time but GPS-less (no distance)
  { id: 3, type: 'Run', date: '2026-07-28', movingTimeSec: 1800 },
];
console.log('weeklyRunKm current week:', weeklyRunKm({ activities: acts, todayISO: TODAY, weeks: 2 }));
console.log('runVolumeModel current week:', runVolumeModel({ activities: acts, todayISO: TODAY, weeks: 2 }).map(w => ({ start: w.start, km: w.km, minutes: w.minutes, runs: w.runs })));

console.log('--- F: null/NaN propagation ---');
const p0 = {}; // empty profile
console.log('predictRaceTimes({}):', predictRaceTimes(p0));
console.log('runBenchmark({}):', runBenchmark(p0));
console.log('runBenchmarkHistory({}):', runBenchmarkHistory(p0).length);
console.log('runFuellingPlan no durationMin:', runFuellingPlan({ workout: { discipline: 'run' } }));
console.log('runFuellingOutcome level junk:', runFuellingOutcome({ plan: { carbPerHour: 40 }, level: 'nonsense' }));
console.log('runReview activity no movingTimeSec:', JSON.stringify(runReview({ workout: { discipline: 'run', type: 'Tempo', durationMin: 40, segments: [] }, activity: { date: TODAY }, rows: null, profile: {} })));
console.log('runLoadFromActivities missing fields:', runLoadFromActivities({ activities: [{ type: 'Run', date: '2026-07-20' }, null, { type: 'Run', date: '2026-07-21', movingTimeSec: 3600 }], todayISO: TODAY }));
console.log('longRunJumpSignal null plan:', longRunJumpSignal({ plan: null }));
console.log('runVolumeModel null activities:', runVolumeModel({ activities: null, todayISO: TODAY, weeks: 2 }).map(w => w.km));
console.log('runDurabilitySignals empty:', runDurabilitySignals({ activities: [], todayISO: TODAY }));
console.log('distanceForMinutes(40, null):', distanceForMinutes(40, null));
console.log('repDistanceLabel no pace:', repDistanceLabel({ reps: 3, perMin: 8, secPerKm: null, unit: 'km' }));
console.log('runWorkoutDistance minutes unit:', runWorkoutDistance({ workout: { discipline: 'run', distance: 10 }, unit: 'minutes', profile: {} }));
const dash = runDashboard({ profile: {}, plan: null, activities: [], log: {}, reviews: [], fuelLogs: [], todayISO: TODAY });
console.log('runDashboard empty ok, benchmark:', JSON.stringify(dash.currentPerformance.benchmark));

// profile with weightKg missing on a solo plan
const noW = generatePlan({ name: 'x', raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5, startDate: '2026-06-01', raceDate: '2026-10-04' });
const bad = [];
for (const wk of noW.weeks) for (const w of wk.workouts) {
  if (w.discipline === 'run' && !w.race) {
    if (Number.isNaN(w.durationMin) || (w.distance != null && Number.isNaN(w.distance))) bad.push(w.id);
    for (const s of w.segments || []) if (Number.isNaN(s.min) || /NaN/.test(s.detail || '') || /NaN/.test(s.label || '')) bad.push(w.id + ':' + s.label);
  }
}
console.log('solo plan no weight/fivek: NaN sites:', bad.length);

console.log('--- G: determinism / byte identity ---');
const prof = { name: 'x', raceType: 'runhalf', fitness: 'advanced', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 6, startDate: '2026-06-01', raceDate: '2026-10-04', fivekSec: 1500, fivekMeta: { source: 'try-test' } };
const a1 = generatePlan(prof), a2 = generatePlan(prof);
console.log('weeks identical:', JSON.stringify(a1.weeks) === JSON.stringify(a2.weeks));

console.log('--- H: runLongObjective on the weekly-hours-rebuilt long ---');
const p = generatePlan({ name: 'R', startDate: '2026-06-01', fivekSec: 1500, fivekMeta: { source: 'try-test' }, raceType: 'runmarathon', fitness: 'elite', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04', weeklyHours: 2 });
const l = p.weeks.flatMap(k => k.workouts).find(x => x.type === 'Long' && x.racePaceMin === 50);
console.log('wk13 long objective:', runLongObjective(l), 'racePaceMin:', l.racePaceMin, 'labels:', l.segments.map(s => s.label));
const mix = longRunMix(p.weeks.flatMap(k => k.workouts).filter(x => x.type === 'Long'));
console.log('mix:', JSON.stringify(mix));
