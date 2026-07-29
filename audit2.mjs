/* Probe A: weekly-hours anchor rebuild vs racePaceMin.
   Probe B: runLongestMin anchor vs race-pace long block share.
   Probe C: race date shortly after start -> training after the race. */
import { generatePlan } from './src/lib/plan.js';
import { runWorkoutIssues } from './src/lib/runschema.js';

const base = { name: 'R', startDate: '2026-06-01', fivekSec: 1500, fivekMeta: { source: 'try-test' } };

console.log('--- A: weeklyHours anchor + midweek Race Pace / race-pace Long ---');
for (const wh of [4, 5, 6]) {
  const p = generatePlan({
    ...base, raceType: 'runmarathon', fitness: 'elite', daysPerWeek: 5,
    trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04', weeklyHours: wh,
  });
  for (const wk of p.weeks) for (const w of wk.workouts) {
    if (w.discipline !== 'run') continue;
    if (w.type === 'Race Pace' || (w.type === 'Long' && w.racePaceMin)) {
      const rpSeg = (w.segments || []).find(s => /effort/.test(s.label) && s.zone === 'Z3');
      const workMin = rpSeg && rpSeg.blocks
        ? rpSeg.blocks.filter(b => b.zone === 'Z3').reduce((a, b) => a + b.min, 0)
        : rpSeg ? rpSeg.min : 0;
      console.log(`wh=${wh}h wk${wk.index} ${w.type} dur=${w.durationMin} racePaceMin=${w.racePaceMin} label="${rpSeg ? rpSeg.label : 'NO RACE-PACE SEGMENT'}" rpWork=${Math.round(workMin)} segs=[${(w.segments || []).map(s => s.label + ':' + Math.round(s.min)).join(', ')}]`);
    }
  }
}

console.log('--- B: longestRunMin anchor vs race-pace long ---');
for (const lr of [40, 50, 60]) {
  const p = generatePlan({
    ...base, raceType: 'runmarathon', fitness: 'intermediate', daysPerWeek: 5,
    trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04', longestRunMin: lr,
  });
  for (const wk of p.weeks) for (const w of wk.workouts) {
    if (w.discipline === 'run' && w.type === 'Long' && w.racePaceMin) {
      const shares = (w.segments || []).map(s => `${s.label}:${Math.round(s.min)}`);
      console.log(`longest=${lr} wk${wk.index} Long dur=${w.durationMin} racePaceMin=${w.racePaceMin} [${shares.join(', ')}] issues=${runWorkoutIssues(w)}`);
    }
  }
}

console.log('--- C: race 10 days after plan start ---');
const p3 = generatePlan({ ...base, raceType: 'run5k', fitness: 'intermediate', daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-06-11' });
console.log('totalWeeks', p3.totalWeeks, 'shortRunway', p3.shortRunway);
for (const wk of p3.weeks) {
  const summ = wk.workouts.filter(w => w.discipline !== 'rest').map(w => `${w.date.slice(5)} ${w.race ? 'RACE' : w.type}${w.key ? '*' : ''} ${w.durationMin}m`);
  console.log(`wk${wk.index} ${wk.phase}${wk.isRecovery ? '/rec' : ''}: ${summ.join(' | ')}`);
}
