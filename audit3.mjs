import { generatePlan, trimWorkout } from './src/lib/plan.js';

const base = { name: 'R', startDate: '2026-06-01', fivekSec: 1500, fivekMeta: { source: 'try-test' } };

console.log('--- A: weeklyHours=2 binding on race-pace weeks (elite marathon) ---');
{
  const p = generatePlan({
    ...base, raceType: 'runmarathon', fitness: 'elite', daysPerWeek: 5,
    trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04', weeklyHours: 2,
  });
  for (const wk of p.weeks) for (const w of wk.workouts) {
    if (w.discipline !== 'run') continue;
    if (w.type === 'Race Pace' || w.racePaceMin) {
      console.log(`wk${wk.index} ${w.type} dur=${w.durationMin} racePaceMin=${w.racePaceMin} segs=[${(w.segments || []).map(s => s.label + ':' + Math.round(s.min)).join(', ')}]`);
    }
  }
}

console.log('--- B: longestRunMin=20 and 25, intermediate marathon ---');
for (const lr of [20, 25]) {
  const p = generatePlan({
    ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5,
    trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04', longestRunMin: lr,
  });
  for (const wk of p.weeks) for (const w of wk.workouts) {
    if (w.discipline === 'run' && w.type === 'Long' && w.racePaceMin) {
      console.log(`longest=${lr} wk${wk.index} Long dur=${w.durationMin} racePaceMin=${w.racePaceMin} segs=[${(w.segments || []).map(s => s.label + ':' + Math.round(s.min)).join(', ')}]`);
    }
  }
}

console.log('--- B2: trimWorkout(0.6) on a Peak race-pace long, no anchors ---');
{
  const p = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04' });
  const w = p.weeks.flatMap(k => k.workouts).find(x => x.type === 'Long' && x.racePaceMin === 50);
  console.log('before:', w.durationMin, JSON.stringify(w.segments.map(s => [s.label, Math.round(s.min)])));
  const t = trimWorkout(w, p, 0.6);
  console.log('after trim 0.6:', t.durationMin, JSON.stringify(t.segments.map(s => [s.label, Math.round(s.min)])));
}

console.log('--- D: 5k race on Tue 2026-06-09, test demoted? ---');
{
  const p = generatePlan({ ...base, raceType: 'run5k', fitness: 'intermediate', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-06-09' });
  for (const wk of p.weeks) for (const w of wk.workouts) {
    if (w.test || w.testKind || w.race) {
      console.log(`wk${wk.index} ${w.date} type=${w.type} title="${w.title}" test=${w.test} testKind=${w.testKind} race=${w.race} raceWeek=${w.raceWeek} raceWeekFrom=${w.raceWeekFrom} dur=${w.durationMin} key=${w.key}`);
    }
  }
}
