/* xa4: the steady-average judge (reviewActivity) vs Long/Easy cards executed exactly as printed. */
import { generatePlan } from './src/lib/plan.js';
import { reviewActivity } from './src/lib/review.js';
import { runLongObjective } from './src/lib/run-durability.js';

const DAYSETS = { 3: [1, 3, 5], 5: [0, 1, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const base = { name: 'R', startDate: '2026-06-01', raceDate: '2026-10-03', weightKg: 70 };
const REAL = { fivekSec: 1500, fivekMeta: { source: 'try-test' } };
const ZONE_KEY = { Z1: 'recovery', Z2: 'easy', Z3: 'tempo', Z4: 'threshold', Z5: 'interval' };

function printedPace(detail) {
  const m = /(~?)(\d+):(\d\d) \/km/.exec(detail || '');
  return m ? Number(m[2]) * 60 + Number(m[3]) : null;
}

let warns = {}, infos = {}, count = 0;
for (const rt of ['run5k', 'run10k', 'runhalf', 'runmarathon']) for (const fit of ['beginner', 'intermediate', 'advanced', 'elite']) for (const d of [3, 5, 7]) {
  const plan = generatePlan({ ...base, ...REAL, raceType: rt, fitness: fit, daysPerWeek: d, trainingDays: DAYSETS[d], longDay: 5 });
  const pc = plan.paces;
  const runs = plan.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && !x.race && !x.test && (x.type === 'Long' || x.type === 'Easy'));
  for (const w of runs) {
    // exact execution: each block at its printed (or zone) pace
    let km = 0, sec = 0;
    for (const s of w.segments || []) {
      const segPace = printedPace(s.detail) || pc.run[ZONE_KEY[s.zone]] || pc.run.easy;
      const blocks = s.blocks || [{ min: s.min, zone: s.zone }];
      for (const b of blocks) {
        const pace = (s.blocks ? (pc.run[ZONE_KEY[b.zone]] || segPace) : segPace);
        sec += b.min * 60;
        km += b.min * 60 / pace;
      }
    }
    const activity = { movingTimeSec: sec, distance: km * 1000 };
    const out = reviewActivity({ workout: w, activity, paces: pc });
    count++;
    (out.verdicts || []).forEach(v => {
      if (v.tone === 'warn') {
        const key = w.type + '/' + runLongObjective(w) + ': ' + v.text.slice(0, 60);
        if (!warns[key]) warns[key] = { n: 0, ex: rt + '/' + fit + '/' + d + ' ' + w.id + ' dur=' + w.durationMin + ' labels=' + JSON.stringify(w.segments.map(s => s.label)) + ' | ' + v.text };
        warns[key].n++;
      }
    });
  }
}
console.log('sessions checked:', count);
for (const [k, v] of Object.entries(warns)) console.log('\nWARN x' + v.n + ' ' + k + '\n  e.g. ' + v.ex);
