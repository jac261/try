/* xa7: race week stops at the race, across five race weekdays. */
import { generatePlan } from './src/lib/plan.js';
import { RUN_QUALITY_TYPES } from './src/lib/runschema.js';

const base = { name: 'R', startDate: '2026-06-01', weightKg: 70, fivekSec: 1500, fivekMeta: { source: 'try-test' } };
const dayNum = d => Math.round(new Date(d) / 864e5);

let bad = [];
// race dates 2026-09-28 (Mon) .. 2026-10-04 (Sun)
const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
for (const rt of ['run5k', 'run10k', 'runhalf', 'runmarathon']) for (const fit of ['beginner', 'intermediate', 'advanced', 'elite']) for (const raceDate of dates) {
  const p = generatePlan({ ...base, raceType: rt, fitness: fit, daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5, raceDate });
  const tag = rt + '/' + fit + '/' + raceDate;
  const all = p.weeks.flatMap(w => w.workouts);
  const race = all.find(x => x.race);
  if (!race) { bad.push(tag + ': NO RACE DAY'); continue; }
  const rd = dayNum(race.date);
  for (const x of all) {
    if (x.race || x.discipline !== 'run') continue;
    const gap = dayNum(x.date) - rd; // positive = after race
    if (gap >= -2 && gap !== 0) {
      if (RUN_QUALITY_TYPES.includes(x.type) || x.type === 'Long' || x.type === 'Test') {
        bad.push(tag + ': ' + x.type + ' ' + x.durationMin + 'min at gap ' + gap + ' (id ' + x.id + ')');
      }
      const cap = gap < 0 ? 40 : gap === 1 ? 30 : 45;
      // dedupe can nudge +5s upward; allow 10 of slack before calling it out
      if (x.durationMin > cap + 10) bad.push(tag + ': ' + x.type + ' ' + x.durationMin + 'min exceeds cap ' + cap + ' at gap ' + gap);
    }
  }
}
console.log('violations (' + bad.length + '):');
bad.slice(0, 30).forEach(s => console.log(' ', s));
