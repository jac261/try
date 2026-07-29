/* Sweep: full solo matrix, structural checks on every run workout, incl. rebuilds. */
import { generatePlan, easeWorkout, trimWorkout, boostWorkout, segMinutes } from './src/lib/plan.js';
import { runWorkoutIssues, RUN_TYPES } from './src/lib/runschema.js';
import { soloPlanIssues } from './src/lib/run-plans.js';

const DAYSETS = { 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const base = { name: 'R', css100Sec: 110, ftp: 250, weightKg: 70, startDate: '2026-06-01' };
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
const REAL = { fivekSec: 1500, fivekMeta: { source: 'try-test' } };
const RACE_DATES = ['2026-10-03', '2026-10-05', '2026-10-07']; // Sat, Mon, Wed
const LONGDAYS = [5, 6, 3];

let problems = [];
const labelRepCheck = (w, ctx) => {
  for (const s of w.segments || []) {
    if (!s.blocks) continue;
    const m = /^(\d+) × /.exec(s.label || '');
    if (!m) continue;
    const n = Number(m[1]);
    // count work blocks: blocks alternate on/off; count blocks in non-Z1... too fragile.
    // instead: count blocks whose zone matches the segment zone
    const work = s.blocks.filter(b => b.zone === s.zone).length;
    if (s.zone && work && work !== n && !/×\s*\d+\s*×/.test(s.label)) {
      problems.push(`${ctx}: label says ${n} reps but ${work} work blocks: "${s.label}"`);
    }
  }
};
const checkW = (w, ctx) => {
  if (w.discipline !== 'run' || w.race) return;
  const iss = runWorkoutIssues(w);
  if (iss.length) problems.push(`${ctx}: ${iss.join('; ')} [type=${w.type} dur=${w.durationMin}]`);
  labelRepCheck(w, ctx);
};

for (const rt of SOLO) for (const lvl of LEVELS) for (const d of [3, 4, 5, 6, 7]) for (const rd of RACE_DATES) for (const ld of LONGDAYS) {
  const profile = { ...base, ...REAL, raceType: rt, fitness: lvl, daysPerWeek: d, trainingDays: DAYSETS[d], longDay: ld, raceDate: rd };
  const plan = generatePlan(profile);
  const ctx0 = `${rt}/${lvl}/${d}d/race${rd}/ld${ld}`;
  for (const wk of plan.weeks) for (const w of wk.workouts) {
    const ctx = `${ctx0} wk${wk.index} ${w.id}`;
    checkW(w, ctx);
    if (rt === 'runhalf' && w.discipline === 'run' && w.type === 'VO2 Intervals') problems.push(`${ctx}: runhalf emitted VO2`);
    if (w.discipline === 'run' && !w.race && RUN_TYPES.indexOf(w.type) < 0 && w.type !== 'Test') problems.push(`${ctx}: unknown type ${w.type}`);
    // rebuilds
    if (w.discipline === 'run' && !w.race && !w.test && w.durationMin > 0) {
      for (const [nm, fn] of [['ease', x => easeWorkout(x, plan)], ['trim.6', x => trimWorkout(x, plan, 0.6)], ['trim.85', x => trimWorkout(x, plan, 0.85)], ['boost1.2', x => boostWorkout(x, plan, 1.2)]]) {
        const r = fn(w);
        checkW(r, `${ctx} ${nm}`);
        if (rt === 'runhalf' && r.type === 'VO2 Intervals') problems.push(`${ctx} ${nm}: runhalf VO2 after rebuild`);
        if (w.racePaceMin && r.type === w.type && r.racePaceMin !== w.racePaceMin) problems.push(`${ctx} ${nm}: racePaceMin lost`);
      }
    }
  }
  const pi = soloPlanIssues(plan, d);
  if (pi.length) problems.push(`${ctx0} plan issues: ${pi.slice(0, 6).join(' | ')}${pi.length > 6 ? ' …+' + (pi.length - 6) : ''}`);
}
console.log('checked matrix; problems:', problems.length);
for (const p of problems.slice(0, 60)) console.log(' -', p);
