/* xa1: matrix generation — spacing contract, classifier, race-pace contract. */
import { generatePlan } from './src/lib/plan.js';
import { soloPlanIssues } from './src/lib/run-plans.js';
import { runLongObjective, longRunMix } from './src/lib/run-durability.js';
import { runWorkoutIssues } from './src/lib/runschema.js';

const DAYSETS = { 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const base = { name: 'R', startDate: '2026-06-01', raceDate: '2026-10-03', weightKg: 70 };
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
const REAL = { fivekSec: 1500, fivekMeta: { source: 'try-test' } };

let spacingIssues = [], structIssues = [], otherLongs = [], mixViol = [], rpMismatch = [];
let plans = 0;

for (const rt of SOLO) for (const fit of LEVELS) for (const d of [3, 4, 5, 6, 7]) for (const anchorReal of [true, false]) {
  const profile = { ...base, ...(anchorReal ? REAL : {}), raceType: rt, fitness: fit, daysPerWeek: d, trainingDays: DAYSETS[d], longDay: 5 };
  const p = generatePlan(profile);
  plans++;
  const tag = rt + '/' + fit + '/' + d + 'd/' + (anchorReal ? 'real' : 'est');
  soloPlanIssues(p, d).forEach(i => spacingIssues.push(tag + ': ' + i));
  const runs = p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && !x.race && !x.test);
  runs.forEach(x => {
    runWorkoutIssues(x).forEach(i => structIssues.push(tag + ' ' + x.id + ' ' + x.type + ': ' + i));
  });
  const longs = runs.filter(x => x.type === 'Long');
  longs.forEach(x => {
    const o = runLongObjective(x);
    if (o === 'other') otherLongs.push(tag + ' ' + x.id + ' labels=' + JSON.stringify(x.segments.map(s => s.label)));
  });
  const mix = longRunMix(longs);
  if (!mix.withinGuidance) mixViol.push(tag + ' hardShare=' + mix.hardShare.toFixed(2));
  // race-pace contract: stored racePaceMin vs the card's actual race-pace work minutes
  runs.filter(x => x.racePaceMin).forEach(x => {
    if (x.type === 'Long') {
      const seg = (x.segments || []).find(s => /effort/.test(s.label || ''));
      if (!seg) { rpMismatch.push(tag + ' ' + x.id + ' Long racePaceMin=' + x.racePaceMin + ' but NO race-pace segment; labels=' + JSON.stringify(x.segments.map(s => s.label))); return; }
      if (Math.abs(seg.min - x.racePaceMin) > 1) rpMismatch.push(tag + ' ' + x.id + ' Long racePaceMin=' + x.racePaceMin + ' seg.min=' + seg.min);
    } else if (x.type === 'Race Pace') {
      const rp = (x.segments || []).find(s => s.blocks && /effort/.test(s.label || ''));
      if (!rp) { rpMismatch.push(tag + ' ' + x.id + ' RacePace no rep segment; labels=' + JSON.stringify((x.segments||[]).map(s => s.label))); return; }
      const work = rp.blocks.filter(b => b.zone === 'Z3').reduce((t, b) => t + b.min, 0);
      if (work - x.racePaceMin > 2) rpMismatch.push(tag + ' ' + x.id + ' RacePace racePaceMin=' + x.racePaceMin + ' but Z3 work=' + work + ' label=' + rp.label);
    }
  });
}

console.log('plans generated:', plans);
console.log('\nSPACING/CONTRACT ISSUES (' + spacingIssues.length + '):');
spacingIssues.slice(0, 30).forEach(s => console.log(' ', s));
console.log('\nSTRUCTURAL ISSUES (' + structIssues.length + '):');
structIssues.slice(0, 20).forEach(s => console.log(' ', s));
console.log('\nLONGS CLASSIFIED other (' + otherLongs.length + '):');
otherLongs.slice(0, 10).forEach(s => console.log(' ', s));
console.log('\nHARD-SHARE VIOLATIONS (' + mixViol.length + '):');
mixViol.slice(0, 10).forEach(s => console.log(' ', s));
console.log('\nRACE-PACE CONTRACT MISMATCHES (' + rpMismatch.length + '):');
rpMismatch.slice(0, 20).forEach(s => console.log(' ', s));
