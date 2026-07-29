/* xa5: does any rebuild path drop racePaceMin? Weekly-hours scaling passes no
   racePaceMin to buildWorkout (plan.js line ~2665); dedupeSoloWeek likewise. */
import { generatePlan } from './src/lib/plan.js';

const DAYSETS = { 4: [1, 3, 5, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const base = { name: 'R', startDate: '2026-06-01', raceDate: '2026-10-03', weightKg: 70, fivekSec: 1500, fivekMeta: { source: 'try-test' } };

function inspect(plan, tag) {
  const runs = plan.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && !x.race && !x.test && x.racePaceMin);
  const out = [];
  for (const x of runs) {
    if (x.type === 'Long') {
      const seg = (x.segments || []).find(s => /effort/.test(s.label || ''));
      if (!seg) out.push(tag + ' ' + x.id + ' LONG racePaceMin=' + x.racePaceMin + ' dur=' + x.durationMin + ' -> NO race-pace segment: ' + JSON.stringify(x.segments.map(s => s.label)));
      else if (Math.abs(seg.min - x.racePaceMin) > 1) out.push(tag + ' ' + x.id + ' LONG racePaceMin=' + x.racePaceMin + ' segMin=' + seg.min);
    } else if (x.type === 'Race Pace') {
      const rp = (x.segments || []).find(s => s.blocks && /effort/.test(s.label || ''));
      const work = rp ? rp.blocks.filter(b => b.zone === 'Z3').reduce((t, b) => t + b.min, 0) : null;
      if (rp && work - x.racePaceMin > 2) out.push(tag + ' ' + x.id + ' RACEPACE racePaceMin=' + x.racePaceMin + ' but Z3 work=' + work + ' dur=' + x.durationMin + ' label="' + rp.label + '"');
      if (!rp) out.push(tag + ' ' + x.id + ' RACEPACE fallback card dur=' + x.durationMin + ' labels=' + JSON.stringify(x.segments.map(s => s.label)));
    }
  }
  return out;
}

let problems = [];
for (const rt of ['runhalf', 'runmarathon']) for (const fit of ['beginner', 'intermediate', 'advanced', 'elite']) for (const d of [4, 5, 6, 7]) {
  for (const wh of [2, 3, 4, 5, 6]) {
    const p = generatePlan({ ...base, raceType: rt, fitness: fit, daysPerWeek: d, trainingDays: DAYSETS[d], longDay: 5, weeklyHours: wh });
    problems.push(...inspect(p, rt + '/' + fit + '/' + d + 'd/wh' + wh));
  }
}
console.log('problems (' + problems.length + '):');
problems.slice(0, 40).forEach(s => console.log(' ', s));
