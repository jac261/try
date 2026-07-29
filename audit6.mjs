/* Race-week and post-race-week byte-identical duplicates (soloPlanIssues skips these weeks). */
import { generatePlan } from './src/lib/plan.js';

const DAYSETS = { 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const base = { name: 'R', css100Sec: 110, startDate: '2026-06-01', fivekSec: 1500, fivekMeta: { source: 'try-test' } };
let dups = 0, checked = 0;
for (const rt of ['run5k', 'run10k', 'runhalf', 'runmarathon'])
  for (const lvl of ['beginner', 'intermediate', 'advanced', 'elite'])
    for (const d of [3, 4, 5, 6, 7])
      for (const rd of ['2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09']) {
        const p = generatePlan({ ...base, raceType: rt, fitness: lvl, daysPerWeek: d, trainingDays: DAYSETS[d], longDay: 5, raceDate: rd });
        const rw = p.weeks.findIndex(w => w.workouts.some(x => x.race));
        for (const wk of p.weeks.slice(rw)) {
          checked++;
          const runs = wk.workouts.filter(x => x.discipline === 'run' && !x.race);
          const sigs = runs.map(x => JSON.stringify([x.type, x.durationMin, (x.segments || []).map(s => s.label)]));
          if (new Set(sigs).size !== sigs.length) {
            dups++;
            if (dups < 8) console.log(`${rt}/${lvl}/${d}d/${rd} wk${wk.index}${wk.index === rw ? '(race)' : '(post)'}: ` + runs.map(x => `${x.date.slice(5)} ${x.type} ${x.durationMin}m`).join(' | '));
          }
        }
      }
console.log('race/post weeks checked:', checked, 'weeks with byte-identical runs:', dups);
