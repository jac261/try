import { generatePlan, boostWorkout, trimWorkout } from './src/lib/plan.js';

// runhalf quality-type census by phase/level
const base = { name: 'R', startDate: '2026-06-01', fivekSec: 1500, fivekMeta: { source: 'try-test' } };
for (const lvl of ['beginner', 'intermediate', 'advanced', 'elite']) {
  const p = generatePlan({ ...base, raceType: 'runhalf', fitness: lvl, daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04' });
  const seen = {};
  for (const wk of p.weeks) {
    if (wk.isRecovery) continue;
    const qs = wk.workouts.filter(w => w.discipline === 'run' && w.role === 'quality' && !w.test && !w.race);
    qs.forEach((w, i) => { const k = wk.phase + '/q' + (i + 1); (seen[k] = seen[k] || new Set()).add(w.type); });
  }
  console.log(lvl, Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v].join(',')])));
}

// flip-flop: eased/anchored long without block, then boost reinstates it
const p = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'elite', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04', weeklyHours: 2 });
const l = p.weeks.flatMap(k => k.workouts).find(x => x.type === 'Long' && x.racePaceMin === 50);
console.log('stored:', l.durationMin, 'racePaceMin', l.racePaceMin, l.segments.map(s => s.label));
const b = boostWorkout(l, p, 1.1);
console.log('after boost 1.1:', b.durationMin, b.segments.map(s => `${s.label}:${Math.round(s.min)}`));
const t = trimWorkout(l, p, 0.9);
console.log('after trim 0.9:', t.durationMin, t.segments.map(s => `${s.label}:${Math.round(s.min)}`));
