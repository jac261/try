import * as T from './src/lib/index.js';

// Scenario: athlete logs the plan's run 5k test, but no run recording ever
// matched it (wrong sport on the watch / missed upload). Feed has a bike
// ride that day, nothing else.
const testDate = '2026-07-25';
const today = '2026-07-29';
const activities = [
  { id: 'a1', type: 'Ride', start_date_local: testDate + 'T08:00:00', moving_time: 3600, icu_distance: 30000 },
];

// 1) The finder for the run test finds nothing -> the auto-5k effect in
//    App.jsx returns early at `if (!a ...) return;` and setRunTest is never
//    called. runTest stays null.
const runMatch = T.run5kTestActivityFor({ activities, date: testDate });
console.log('run5kTestActivityFor (unmatched feed):', runMatch);

// 2) Replicate App.jsx's unmatchedTest IIFE (lines 1122-1133) verbatim for
//    BOTH test kinds, to show the filter is the only thing that differs.
function unmatchedTestFor(kind, finder) {
  const plan = { race: 'olympic', weeks: [{ workouts: [
    { id: 'w1', test: true, testKind: kind, date: testDate },
  ] }] };
  const log = { w1: { done: true } };
  const moves = {};
  const t = plan.weeks.flatMap(w => w.workouts)
    .filter(w => w.test && w.testKind === 'swimCss' && log[w.id])  // <-- App.jsx line 1126, hardcoded
    .map(w => ({ w, date: (moves && moves[w.id]) || w.date }))
    .filter(x => x.date < today && T.daysBetween(x.date, today) <= T.EFTP_RULES.freshDays)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!t) return null;
  return finder({ activities, date: t.date }) ? null
    : { sig: 'nomatch:' + t.w.id, issue: 'no recording on test day' };
}
console.log('unmatchedTest, swimCss test logged  :', JSON.stringify(unmatchedTestFor('swimCss', T.cssTestActivityFor)));
console.log('unmatchedTest, run5k  test logged  :', JSON.stringify(unmatchedTestFor('run5k', T.run5kTestActivityFor)));

// 3) runTest stays null (effect bailed), so the ONLY consumer, eftpProposal,
//    has nothing to say. Even in the matched-but-unparseable case where
//    runTest = { test: null, issue }, eftpProposal ignores it:
const plan = { race: 'olympic', disciplines: ['run'], profile: { fivekSec: 1500 }, weeks: [] };
const p1 = T.eftpProposal({ activities, thresholds: {}, plan, todayISO: today, cssTest: null, runTest: null });
const p2 = T.eftpProposal({ activities, thresholds: {}, plan, todayISO: today, cssTest: null,
  runTest: { actId: 'x', date: testDate, test: null, issue: 'That recording does not contain a 5 km test effort.' } });
console.log('eftpProposal(runTest=null)        :', p1);
console.log('eftpProposal(runTest.issue only)  :', p2);
