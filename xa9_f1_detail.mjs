/* xa9: F1 detail — weekly-hours rebuild vs racePaceMin, and the trim flip-flop. */
import { generatePlan, trimWorkout } from './src/lib/plan.js';
import { runLongObjective } from './src/lib/run-durability.js';

const p = generatePlan({
  name: 'R', startDate: '2026-06-01', raceDate: '2026-10-03', weightKg: 70,
  fivekSec: 1500, fivekMeta: { source: 'try-test' },
  raceType: 'runhalf', fitness: 'intermediate', daysPerWeek: 4, trainingDays: [1, 3, 5, 6], longDay: 5,
  weeklyHours: 2,
});
const runs = p.weeks.flatMap(w => w.workouts).filter(x => x.racePaceMin);
for (const x of runs) {
  console.log(x.id, x.type, 'dur=' + x.durationMin, 'racePaceMin=' + x.racePaceMin,
    'objective=' + runLongObjective(x));
  x.segments.forEach(s => console.log('   seg:', s.label, '|', s.min, 'min |', s.detail || ''));
  if (x.type === 'Long') {
    const t = trimWorkout(x, p, 0.95);
    console.log('  -> after a 5% adaptive trim (same builder, racePaceMin passed):');
    t.segments.forEach(s => console.log('   seg:', s.label, '|', Math.round(s.min * 10) / 10, 'min'));
  }
  console.log();
}
