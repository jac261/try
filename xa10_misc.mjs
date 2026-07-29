/* xa10: determinism, closed-set types on tri plans, Fartlek card wording. */
import { generatePlan } from './src/lib/plan.js';
import { RUN_TYPES } from './src/lib/runschema.js';

const tri = { name: 'R', startDate: '2026-06-01', raceDate: '2026-10-03', weightKg: 70, css100Sec: 110, ftp: 250, fivekSec: 1500, raceType: 'olympic', fitness: 'intermediate', daysPerWeek: 5 };
const a = generatePlan(tri), b = generatePlan(tri);
const strip = p => JSON.stringify(p.weeks);
console.log('tri deterministic:', strip(a) === strip(b));
const triRuns = a.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && !x.race);
console.log('tri run types outside closed set:', triRuns.filter(x => !RUN_TYPES.includes(x.type) && x.type !== 'RACE').map(x => x.type));
console.log('tri runs carrying racePaceMin:', triRuns.filter(x => x.racePaceMin).length);

// Fartlek card: what the surge segment actually prints
const solo = generatePlan({ ...tri, raceType: 'run5k', fitness: 'beginner', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5, fivekMeta: { source: 'try-test' } });
const f = solo.weeks.flatMap(w => w.workouts).find(x => x.type === 'Fartlek' && x.segments.some(s => s.blocks));
if (f) {
  console.log('\nFartlek card (id ' + f.id + '):');
  f.segments.forEach(s => console.log('  ', s.label, '|', s.detail || ''));
}
