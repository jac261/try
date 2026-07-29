/* xa3: card vs judge — execute every generated quality run exactly as printed,
   feed the laps to intervalRows + runReview, and check the verdicts. */
import { generatePlan } from './src/lib/plan.js';
import { intervalRows, reviewActivity } from './src/lib/review.js';
import { runReview } from './src/lib/run-review.js';
import { RUN_PACE_TYPES, isEffortPrescribed } from './src/lib/runschema.js';

const DAYSETS = { 3: [1, 3, 5], 5: [0, 1, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const base = { name: 'R', startDate: '2026-06-01', raceDate: '2026-10-03', weightKg: 70 };
const REAL = { fivekSec: 1500, fivekMeta: { source: 'try-test' } };

// The pace each zone's card detail prints, mirroring runDetail's key mapping.
const ZONE_KEY = { Z1: 'recovery', Z2: 'easy', Z3: 'tempo', Z4: 'threshold', Z5: 'interval' };

// Extract the pace a work block was PRINTED at: parse the segment detail line.
function printedPace(detail) {
  const m = /(~?)(\d+):(\d\d) \/km/.exec(detail || '');
  if (!m) return null;
  return Number(m[2]) * 60 + Number(m[3]);
}

let bad = [];
let hills = 0, judgedHills = 0, checked = 0;

for (const rt of ['run5k', 'run10k', 'runhalf', 'runmarathon']) for (const fit of ['beginner', 'intermediate', 'advanced', 'elite']) for (const d of [3, 5, 7]) {
  const profile = { ...base, ...REAL, raceType: rt, fitness: fit, daysPerWeek: d, trainingDays: DAYSETS[d], longDay: 5 };
  const plan = generatePlan(profile);
  const pc = plan.paces;
  const runs = plan.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'run' && !x.race && !x.test);
  for (const w of runs) {
    if (!RUN_PACE_TYPES.includes(w.type)) continue;
    const hill = (w.segments || []).some(isEffortPrescribed);
    // Build WORK intervals exactly as printed: one lap per work block, at the
    // pace the card's own detail line quotes for that segment.
    const intervals = [];
    for (const s of w.segments || []) {
      if (!s.blocks) continue;
      const segPace = printedPace(s.detail);
      for (const b of s.blocks) {
        if (b.zone === 'Z1' || b.zone === 'Z2') continue; // recoveries
        const pace = segPace != null ? segPace : pc.run[ZONE_KEY[b.zone]];
        const sec = b.min * 60;
        intervals.push({ type: 'WORK', movingTimeSec: sec, averageSpeed: 1000 / pace, distance: sec * (1000 / pace) });
      }
    }
    if (!intervals.length) continue;
    checked++;
    const rows = intervalRows({ workout: w, intervals, paces: pc, activity: { movingTimeSec: w.durationMin * 60 } });
    const rv = runReview({ workout: w, activity: { movingTimeSec: w.durationMin * 60, distance: 1 }, rows, profile });
    if (hill) {
      hills++;
      if (rows && rows.judged > 0) { judgedHills++; bad.push('HILL JUDGED: ' + rt + '/' + fit + '/' + d + ' ' + w.id + ' ' + w.type + ' judged=' + rows.judged); }
      continue;
    }
    const offRows = (rows.rows || []).filter(r => r.tone && r.tone !== 'good');
    if (offRows.length) {
      bad.push('OFF-TARGET AS PRINTED: ' + rt + '/' + fit + '/' + d + ' ' + w.id + ' ' + w.type
        + ' ' + offRows.length + '/' + rows.judged + ' reps off; card=' + (w.segments.find(s => s.blocks) || {}).detail
        + ' target=' + JSON.stringify(offRows[0]));
    }
    if (rv && rv.outcome !== 'progress') {
      bad.push('BAD OUTCOME: ' + rt + '/' + fit + '/' + d + ' ' + w.id + ' ' + w.type + ' outcome=' + rv.outcome
        + ' completion=' + rv.completion + ' adherence=' + rv.paceAdherence + ' fade=' + rv.intervalFadePercent + ' conf=' + rv.confidence);
    }
  }
}
console.log('checked', checked, 'sessions; hills', hills, 'judgedHills', judgedHills);
console.log('problems (' + bad.length + '):');
bad.slice(0, 30).forEach(s => console.log(' ', s));
