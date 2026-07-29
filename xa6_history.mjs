/* xa6: can a level-table guess enter the 5 km benchmark history?
   Flow: blank-5k athlete -> feel nudge (tuneFields, source 'estimated') applied
   via the app's own fitness-update path -> later a real test is accepted.
   Then read every history/evidence surface. */
import { buildTrackerProfilePlan, applyTrackerFitness } from './src/lib/plan.js';
import { paceSuggestions, tuneFields } from './src/lib/tuning.js';
import { runBenchmarkHistory, runBenchmark } from './src/lib/run-benchmark.js';
import { currentPerformance } from './src/lib/run-dashboard.js';
import { runAnchor } from './src/lib/domain.js';
import { generatePlan, retargetPlan } from './src/lib/plan.js';

// A solo half plan with NO 5 km time: the anchor is the level table.
const profile0 = { name: 'R', startDate: '2026-06-01', raceDate: '2026-10-03', weightKg: 70, raceType: 'runhalf', fitness: 'intermediate', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5 };
let plan = generatePlan(profile0);
console.log('start anchor:', JSON.stringify(runAnchor(plan.profile)));

// The athlete taps "felt easy" three times -> the tuner proposes a run nudge.
const fields = tuneFields(plan.profile, [{ discipline: 'run', direction: 'faster' }]);
console.log('nudge fields:', JSON.stringify(fields));

// Applied through the app's own retarget/fitness-update path (snapshots old baselines).
const retarget = typeof retargetPlan === 'function' ? retargetPlan : null;
console.log('retargetPlan exists:', !!retarget);
plan = applyTrackerFitness(plan, fields, '2026-07-01T10:00:00Z');
console.log('after nudge anchor:', JSON.stringify(runAnchor(plan.profile)));

// Weeks later the athlete runs a real 5 km test; it is accepted.
plan = applyTrackerFitness(plan, { fivekSec: 1540, fivekMeta: { source: 'try-test', measuredAt: '2026-08-01', confidence: 'high' } }, '2026-08-01T10:00:00Z');
console.log('final anchor:', JSON.stringify(runAnchor(plan.profile)));

console.log('\nrunBenchmarkHistory (doc: "Accepted real 5 km results over time"):');
console.log(JSON.stringify(runBenchmarkHistory(plan.profile), null, 1));

const cp = currentPerformance(plan.profile);
console.log('\ndashboard currentPerformance.history:', JSON.stringify(cp.history));
console.log('dashboard improving flag:', cp.improving,
  '(compares the real 1540 against the nudged level-table guess', cp.history[0] && cp.history[0].timeSeconds + ')');
console.log('runBenchmark (real only):', JSON.stringify(runBenchmark(plan.profile)));
