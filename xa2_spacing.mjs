/* xa2: spacing violations — which day configurations produce them, incl. legacy path. */
import { generatePlan } from './src/lib/plan.js';
import { soloPlanIssues } from './src/lib/run-plans.js';

const base = { name: 'R', startDate: '2026-06-01', raceDate: '2026-10-03', weightKg: 70, fivekSec: 1500, fivekMeta: { source: 'try-test' } };
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];

// Several plausible day sets per count, plus the legacy (no trainingDays) path.
const DAYSETS = {
  3: [[1, 3, 5], [0, 1, 2]],
  4: [[1, 3, 5, 6], [1, 2, 4, 5], [0, 1, 2, 3]],
  5: [[0, 1, 3, 5, 6], [0, 1, 2, 3, 4]],
  6: [[0, 1, 2, 3, 5, 6], [0, 1, 2, 3, 4, 5]],
  7: [[0, 1, 2, 3, 4, 5, 6]],
};

const counts = {};
for (const rt of SOLO) for (const fit of ['beginner', 'intermediate', 'advanced', 'elite']) {
  for (const d of [3, 4, 5, 6, 7]) {
    for (const days of DAYSETS[d]) {
      const p = generatePlan({ ...base, raceType: rt, fitness: fit, daysPerWeek: d, trainingDays: days, longDay: days.includes(5) ? 5 : days[days.length - 1] });
      const issues = soloPlanIssues(p, d).filter(s => /apart|sits/.test(s));
      const key = d + 'd:[' + days + ']';
      if (issues.length) { counts[key] = (counts[key] || 0) + issues.length; if (!counts[key + ':ex']) counts[key + ':ex'] = rt + '/' + fit + ' ' + issues[0]; }
    }
    // legacy path: no trainingDays
    const p2 = generatePlan({ ...base, raceType: rt, fitness: fit, daysPerWeek: d });
    const issues2 = soloPlanIssues(p2, d).filter(s => /apart|sits/.test(s));
    const key2 = d + 'd:legacy';
    if (issues2.length) { counts[key2] = (counts[key2] || 0) + issues2.length; if (!counts[key2 + ':ex']) counts[key2 + ':ex'] = rt + '/' + fit + ' ' + issues2[0]; }
  }
}
console.log(JSON.stringify(counts, null, 1));
