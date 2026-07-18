/* Try — post-session review: what the recording says about the plan.
 *
 * Pairs a completed session with its matched intervals.icu activity and
 * renders honest verdicts: was an easy day kept easy, did a steady session
 * sit in its band, did the load match the plan. Analysis only uses what can
 * be judged fairly from an activity AVERAGE — interval sessions blur their
 * reps into the recovery, so they get stats and a pointer, never a pace
 * verdict. Fields the backend passthrough doesn't carry yet (avg HR, avg
 * power) simply produce no verdict: missing data stays quiet, same principle
 * as the readiness model.
 */
import { fmtPace } from './units.js';
import { estimateTss } from './adapt.js';
import { isIndoor } from './autolog.js';

// Session types whose whole intent is one steady band — the only ones an
// average can judge. Everything else (reps, drills, bricks) is mixed.
const STEADY = {
  run: { 'Easy': 'easy', 'Long': 'long' },
  swim: { 'Endurance': 'steady', 'Race Pace': 'css' },
};
const EASY_INTENT = { 'Easy': 1, 'Endurance': 1, 'Long': 1, 'Technique': 1, 'Recovery': 1 };

const secPerKm = a => a.movingTimeSec / (a.distance / 1000);
const secPer100 = a => a.movingTimeSec / (a.distance / 100);

// The review: { stats: [[label, value]], verdicts: [{ tone, text }] } or null.
// tone: 'good' | 'warn' | 'info'.
export function reviewActivity({ workout, activity, paces, log }) {
  if (!workout || !activity || !activity.movingTimeSec) return null;
  const w = workout, a = activity, pc = paces || {};
  const stats = [];
  const verdicts = [];
  const actualMin = a.movingTimeSec / 60;

  stats.push(['Time', fmtDur(a.movingTimeSec)]);
  if (a.distance) stats.push(['Distance', (a.distance / 1000).toFixed(a.distance >= 10000 ? 0 : 1) + ' km']);
  // Indoor recordings carry a virtual distance, so a derived pace or speed
  // would be a fabricated number. The recorded rows already suppress it; this
  // review sits one screen deeper and must agree (gauntlet catch 2026-07-18).
  const derived = a.distance && !isIndoor(a);
  if (derived && w.discipline === 'run') stats.push(['Avg pace', fmtPace(secPerKm(a)) + ' /km']);
  if (derived && w.discipline === 'swim') stats.push(['Avg pace', fmtPace(secPer100(a)) + ' /100m']);
  if (derived && w.discipline === 'bike') stats.push(['Avg speed', (a.distance / 1000 / (a.movingTimeSec / 3600)).toFixed(1) + ' km/h']);
  if (a.averageWatts) stats.push(['Avg power', Math.round(a.averageWatts) + ' W']);
  if (a.averageHeartrate) stats.push(['Avg HR', Math.round(a.averageHeartrate) + ' bpm']);
  if (a.trainingLoad != null) stats.push(['Load', (a.estimated ? '~' : '') + Math.round(a.trainingLoad)]);
  if (a.rpe != null) stats.push(['RPE', Math.round(a.rpe) + '/10']);

  // Duration vs plan (the plan's number, after any ease/trim the athlete saw).
  const planned = w.durationMin || 0;
  if (planned) {
    const r = actualMin / planned;
    if (r < 0.8) verdicts.push({ tone: 'info', text: 'Cut short: ' + fmtDur(a.movingTimeSec) + ' of a planned ' + planned + ' min. Fine occasionally — the load model counts what you did.' });
    else if (r > 1.25) verdicts.push({ tone: 'info', text: 'Ran long: ' + fmtDur(a.movingTimeSec) + ' against a planned ' + planned + ' min. Extra volume adds up — make sure it was deliberate.' });
  }

  // Steady sessions: judge the average against its band.
  const steadyKey = (STEADY[w.discipline] || {})[w.type];
  if (steadyKey && a.distance && pc[w.discipline === 'run' ? 'run' : 'swim']) {
    if (w.discipline === 'run' && pc.run[steadyKey]) {
      const actual = secPerKm(a), target = pc.run[steadyKey];
      if (actual < target - 20) verdicts.push({ tone: 'warn', text: 'Averaged ' + fmtPace(actual) + ' /km against an easy-day target around ' + fmtPace(target) + ' /km. Quicker than this session is meant to be — easy days do their job when they stay easy.' });
      else if (actual > target + 45) verdicts.push({ tone: 'info', text: 'Averaged ' + fmtPace(actual) + ' /km, well below the ' + fmtPace(target) + ' /km guide. If you felt fine, no problem; if it was a struggle, the readiness card may explain why.' });
      else verdicts.push({ tone: 'good', text: 'Right in the band: ' + fmtPace(actual) + ' /km against a ' + fmtPace(target) + ' /km guide. Exactly the discipline that makes the hard days count.' });
    }
    if (w.discipline === 'swim' && pc.swim[steadyKey]) {
      const actual = secPer100(a), target = pc.swim[steadyKey];
      if (actual < target - 5) verdicts.push({ tone: 'good', text: 'Averaged ' + fmtPace(actual) + ' /100m, quicker than the ' + fmtPace(target) + ' /100m guide — strong swimming.' });
      else if (actual > target + 8) verdicts.push({ tone: 'info', text: 'Averaged ' + fmtPace(actual) + ' /100m against a ' + fmtPace(target) + ' /100m guide. Open water, drills or a busy lane can all explain it.' });
      else verdicts.push({ tone: 'good', text: 'On target: ' + fmtPace(actual) + ' /100m against ' + fmtPace(target) + ' /100m.' });
    }
  }

  // Easy-intent bike with power: intensity vs FTP is the honest check — but
  // only against a real FTP. A level-and-weight estimate is too weak a basis
  // for a pass/fail verdict, so it stays quiet, the same principle as the
  // missing threshold HR below (design panel 2026-07-18).
  if (w.discipline === 'bike' && EASY_INTENT[w.type] && a.averageWatts && pc.ftp && !pc.ftpEstimated) {
    const pct = a.averageWatts / pc.ftp;
    if (pct > 0.78) verdicts.push({ tone: 'warn', text: 'Averaged ' + Math.round(pct * 100) + '% of FTP on a ride meant to be easy. Keeping easy rides genuinely easy is what lets the quality days be quality.' });
    else verdicts.push({ tone: 'good', text: 'Kept it easy: ' + Math.round(pct * 100) + '% of FTP on average. Textbook.' });
  }
  // Easy-intent with HR (needs the backend to pass averageHeartrate + a threshold HR to
  // judge against — until then this stays silent rather than guessing).

  // Interval sessions: an average cannot see the reps. (Ad-hoc recordings have
  // no planned intent to speak of, so this note would be noise — skip it.)
  // No promise of a rep table either: that view loads separately and can
  // legitimately be absent (no WORK laps, fetch failure), so this verdict
  // must stand alone without pointing at numbers that may never render.
  if (!w.adhoc && !steadyKey && !EASY_INTENT[w.type] && (w.discipline === 'run' || w.discipline === 'bike' || w.discipline === 'swim')) {
    verdicts.push({ tone: 'info', text: 'Interval session — the average blurs work and recovery together, so no pace verdict here.' });
  }

  // Load vs plan (meaningless for an unplanned session — there is no plan dose).
  if (!w.adhoc && a.trainingLoad != null) {
    const plannedTss = estimateTss(w, undefined, log && log.actualMin);
    if (plannedTss > 10 && a.trainingLoad / plannedTss > 1.4) {
      verdicts.push({ tone: 'warn', text: 'Training load came in well above the plan’s estimate for this session — a much bigger dose than intended.' });
    }
  }

  // Perceived effort vs intent.
  if (EASY_INTENT[w.type] && a.rpe != null && a.rpe >= 7) {
    verdicts.push({ tone: 'warn', text: 'You rated this ' + Math.round(a.rpe) + '/10 — an easy session that felt hard. One-off is nothing; a pattern is worth a look at recovery.' });
  }

  return { stats, verdicts };
}

function fmtDur(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + ' min';
}

/* ---- the rep table: per-interval rows with verdicts ----
   Judged only where a rep target genuinely exists for the session type: runs
   and swims by pace (never by average_watts, which is running power on runs),
   rides by watts against an FTP band. Unstructured sessions arrive as auto
   laps, which render as plain splits with no verdicts — a split has no target
   to fail. Sub-30-second slivers (lap-button stubs) are dropped. */
const REP_BANDS = {
  run: { 'Threshold': ['threshold', 10], 'Tempo': ['tempo', 12], 'VO2 Intervals': ['interval', 10] },
  // The Long swim stays OUT of the STEADY map on purpose: its broken and
  // pyramid variants bake planned rest into the recording, so the whole-
  // session average would read slow against a flat steady target. Every rep
  // in every Long variant targets steady, so the rep table judges it fairly.
  swim: { 'CSS Intervals': ['css', 4], 'Race Pace': ['css', 4], 'Long': ['steady', 8] },
  bike: { 'Threshold': [0.95, 1.05], 'Sweet Spot': [0.84, 0.90], 'VO2 Intervals': [1.05, 1.25], 'Tempo': [0.83, 0.90] },
};

export function intervalRows({ workout, intervals, paces }) {
  if (!workout || !Array.isArray(intervals)) return null;
  const disc = workout.discipline;
  const pc = paces || {};
  const work = intervals.filter(i => i && i.type === 'WORK' && i.movingTimeSec >= 30);
  if (!work.length) return null;
  const band = (REP_BANDS[disc] || {})[workout.type] || null;
  let judged = 0, onTarget = 0;
  const rows = work.map((i, idx) => {
    const row = {
      n: idx + 1,
      label: i.label || null,
      timeSec: Math.round(i.movingTimeSec),
      distance: i.distance || null,
      hr: i.averageHeartrate != null ? Math.round(i.averageHeartrate) : null,
      watts: disc === 'bike' && i.averageWatts != null ? Math.round(i.averageWatts) : null,
      paceSec: disc !== 'bike' && i.averageSpeed ? (disc === 'swim' ? 100 : 1000) / i.averageSpeed : null,
    };
    // Watts still show on every row; only the on-target JUDGEMENT needs a real
    // FTP to mean anything (design panel 2026-07-18).
    if (band && disc === 'bike' && row.watts != null && pc.ftp && !pc.ftpEstimated) {
      judged++;
      const p = row.watts / pc.ftp;
      row.tone = p > band[1] + 0.03 ? 'warn' : p < band[0] - 0.03 ? 'info' : 'good';
    } else if (band && disc !== 'bike' && row.paceSec && pc[disc] && pc[disc][band[0]]) {
      judged++;
      const target = pc[disc][band[0]], tol = band[1];
      row.tone = row.paceSec < target - tol ? 'warn' : row.paceSec > target + tol ? 'info' : 'good';
    }
    if (row.tone === 'good') onTarget++;
    return row;
  });
  const summary = judged
    ? onTarget + ' of ' + judged + ' rep' + (judged === 1 ? '' : 's') + ' on target'
    : rows.length + ' split' + (rows.length === 1 ? '' : 's');
  return { rows, summary, judged };
}
