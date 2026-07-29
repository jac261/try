/* B-race ease window hitting the Peak race-pace long: rebuild drops the block. */
import { generatePlan } from './src/lib/plan.js';

const base = { name: 'R', startDate: '2026-06-01', fivekSec: 1500, fivekMeta: { source: 'try-test' } };
const mk = extra => generatePlan({
  ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5,
  trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04', ...extra,
});
const noB = mk({});
const long = noB.weeks.flatMap(w => w.workouts).find(x => x.type === 'Long' && x.racePaceMin);
console.log('race-pace long without B race:', long.date, 'dur', long.durationMin, 'racePaceMin', long.racePaceMin,
  long.segments.map(s => `${s.label}:${Math.round(s.min)}`));
const withB = mk({ bRaces: [{ date: '2026-08-29', kind: 'run5k' }] });
const long2 = withB.weeks.flatMap(w => w.workouts).find(x => x.date === long.date);
console.log('same slot with parkrun the day before:', long2.type, 'dur', long2.durationMin, 'racePaceMin', long2.racePaceMin,
  long2.segments.map(s => `${s.label}:${Math.round(s.min)}`));
