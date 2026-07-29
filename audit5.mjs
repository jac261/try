import { generatePlan } from './src/lib/plan.js';
import { runWorkoutIssues } from './src/lib/runschema.js';
import { soloPlanIssues } from './src/lib/run-plans.js';

const base = { name: 'R', startDate: '2026-06-01', fivekSec: 1500, fivekMeta: { source: 'try-test' } };

console.log('--- B-races inside a solo half plan ---');
for (const kind of ['run5k', 'runhalf']) {
  for (const bdate of ['2026-07-11', '2026-07-13', '2026-07-14']) { // Sat, Mon, Tue
    const p = generatePlan({
      ...base, raceType: 'runhalf', fitness: 'advanced', daysPerWeek: 5,
      trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04',
      bRaces: [{ date: bdate, kind }],
    });
    const probs = [];
    for (const wk of p.weeks) for (const w of wk.workouts) {
      if (w.discipline === 'run' && !w.race && !w.bRace) {
        const iss = runWorkoutIssues(w);
        if (iss.length) probs.push(`wk${wk.index} ${w.id} ${w.type}/${w.durationMin}: ${iss.join(';')}`);
        if (w.type === 'VO2 Intervals') probs.push(`wk${wk.index} ${w.id}: VO2 on runhalf`);
      }
    }
    const pi = soloPlanIssues(p, 5).filter(s => !/sits 1 day|are 1 day/.test(s));
    console.log(kind, bdate, 'workout issues:', probs.length, 'plan issues:', pi.slice(0, 8));
    if (probs.length) console.log(probs.slice(0, 5));
  }
}

console.log('--- B-race week detail (runhalf tune-up Mon 07-13) ---');
{
  const p = generatePlan({
    ...base, raceType: 'runhalf', fitness: 'advanced', daysPerWeek: 5,
    trainingDays: [0, 1, 3, 5, 6], longDay: 6, raceDate: '2026-10-04',
    bRaces: [{ date: '2026-07-13', kind: 'runhalf' }],
  });
  for (const wk of p.weeks) {
    if (wk.workouts.some(w => w.bRace || (w.date >= '2026-07-11' && w.date <= '2026-07-15'))) {
      console.log(`wk${wk.index} ${wk.phase}${wk.isRecovery ? '/rec' : ''}: ` + wk.workouts.filter(w => w.discipline !== 'rest').map(w => `${w.date.slice(5)} ${w.bRace ? 'TUNEUP' : w.type} ${w.durationMin}m${w.second ? '(2nd)' : ''}`).join(' | '));
    }
  }
}

console.log('--- shortest plans: minWeeks and below for each race ---');
for (const [rt, rd] of [['run5k', '2026-07-04'], ['run10k', '2026-07-04'], ['runhalf', '2026-07-25'], ['runmarathon', '2026-08-22']]) {
  const p = generatePlan({ ...base, raceType: rt, fitness: 'beginner', daysPerWeek: 4, trainingDays: [0, 2, 4, 5], longDay: 5, raceDate: rd });
  const probs = [];
  for (const wk of p.weeks) for (const w of wk.workouts) {
    if (w.discipline === 'run' && !w.race) {
      const iss = runWorkoutIssues(w);
      if (iss.length) probs.push(`wk${wk.index} ${w.id}: ${iss.join(';')}`);
    }
  }
  const post = p.weeks.filter(wk => wk.workouts.some(w => !w.race && w.key && w.date > rd)).map(wk => wk.index);
  console.log(rt, rd, 'totalWeeks', p.totalWeeks, 'shortRunway', p.shortRunway, 'struct issues', probs.length, 'weeks with key sessions after race:', post);
}
