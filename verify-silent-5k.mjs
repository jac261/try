import { fivekFromTestIntervals, fivekTestIssues } from './src/lib/run-benchmark.js';
import { eftpProposal } from './src/lib/eftp.js';

// A partial 5k test: longest WORK effort only 3.2 km
const rows = [{ type: 'WORK', movingTimeSec: 1000, distance: 3200 }];
const act = { id: 'a9', type: 'Run', trainer: false };

const test = fivekFromTestIntervals(rows);
console.log('fivekFromTestIntervals =>', test);

let issue;
try { issue = fivekTestIssues(rows, act); } catch (e) { issue = fivekTestIssues(rows); }
console.log('fivekTestIssues =>', JSON.stringify(issue));

// The exact runTest state App.jsx:498 would store for this failure
const runTest = { actId: 'a9', date: '2026-07-28', test, issue };
console.log('stored runTest =>', JSON.stringify(runTest));

// The only consumer of runTest: eftpProposal
const prop = eftpProposal({
  activities: [], thresholds: { run: { eftpPaceSecPerKm: 300 } },
  plan: { disciplines: ['run'], paces: {} }, todayISO: '2026-07-29',
  cssTest: null, runTest,
});
console.log('eftpProposal =>', prop);
