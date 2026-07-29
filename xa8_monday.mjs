/* xa8: detail of the Monday-race hole. */
import { generatePlan } from './src/lib/plan.js';

const p = generatePlan({
  name: 'R', startDate: '2026-06-01', weightKg: 70, fivekSec: 1500, fivekMeta: { source: 'try-test' },
  raceType: 'runhalf', fitness: 'elite', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  raceDate: '2026-09-28',
});
for (const w of p.weeks.slice(-3)) {
  console.log('week', w.index, w.phase, 'isRecovery=' + !!w.isRecovery);
  for (const x of w.workouts) {
    console.log('  ', x.date, x.discipline.padEnd(5), (x.type || '').padEnd(10), (x.durationMin || 0) + 'min',
      x.race ? 'RACE' : '', x.raceWeek || '', x.key ? 'key' : '');
  }
}
