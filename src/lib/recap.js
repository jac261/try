/* Try — session recap: the slide deck shown when a session completes with a
 * matched recording. Pure assembly (component renders the descriptors):
 * headline → splits/reps → heart rate → effort → the takeaway. Slides only
 * exist when their data does — no filler, no fake precision. The closing
 * slide is the point: celebration plus consequence, what this session means
 * for tomorrow (decisions over dashboards, even in confetti form).
 */
import { fmtPace } from './units.js';
import { effDate } from './schedule.js';
import { reviewActivity, intervalRows } from './review.js';

const fmtMin = sec => {
  const m = Math.round(sec / 60);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + ' min';
};

export function buildRecap({ workout, activity, intervals, paces, plan, log, moves, todayISO }) {
  if (!workout || !activity || !activity.movingTimeSec) return null;
  const rv = reviewActivity({ workout, activity, paces }) || { stats: [], verdicts: [] };
  const it = intervalRows({ workout, intervals, paces });
  const slides = [];

  // 1 — headline: what you did, and the sharpest verdict available.
  const lead = rv.verdicts.find(v => v.tone === 'good') || rv.verdicts.find(v => v.tone === 'warn') || rv.verdicts[0] || null;
  slides.push({
    kind: 'headline', title: workout.title || 'Session complete',
    big: fmtMin(activity.movingTimeSec),
    lines: [
      activity.distance ? (activity.distance / 1000).toFixed(activity.distance >= 10000 ? 0 : 1) + ' km' : null,
      lead ? lead.text : 'In the bank.',
    ].filter(Boolean),
  });

  // 2 — reps or splits, with the summary as the headline number.
  if (it && it.rows.length >= 2) {
    slides.push({
      kind: 'splits', title: it.judged ? 'The reps' : 'The splits', big: it.summary,
      rows: it.rows.map(r => ({
        label: r.label || '#' + r.n,
        value: r.paceSec ? fmtPace(r.paceSec) + (workout.discipline === 'swim' ? ' /100m' : ' /km')
          : r.watts != null ? r.watts + ' W' : fmtMin(r.timeSec),
        tone: r.tone || null,
        // Bar length: relative effort within the set (pace inverted: faster = longer).
        frac: r.paceSec ? Math.min(...it.rows.filter(x => x.paceSec).map(x => x.paceSec)) / r.paceSec
          : r.watts != null ? r.watts / Math.max(...it.rows.filter(x => x.watts != null).map(x => x.watts)) : 0.6,
      })),
    });
  }

  // 3 — heart rate (only once the backend passes averages through).
  if (activity.averageHeartrate) {
    slides.push({
      kind: 'hr', title: 'Heart rate', big: Math.round(activity.averageHeartrate) + ' bpm',
      lines: ['average across the session' + (activity.maxHeartrate ? ', peaking at ' + Math.round(activity.maxHeartrate) : '')],
    });
  }

  // 4 — effort and load.
  const effortLines = [];
  if (activity.rpe != null) effortLines.push('You rated it ' + Math.round(activity.rpe) + '/10.');
  const warn = rv.verdicts.find(v => v.tone === 'warn');
  if (warn && warn !== lead) effortLines.push(warn.text);
  if (activity.trainingLoad != null) {
    slides.push({
      kind: 'effort', title: 'The dose', big: 'Load ' + Math.round(activity.trainingLoad),
      lines: effortLines.length ? effortLines : ['Banked into your fitness — the curve remembers.'],
    });
  }

  // 5 — the takeaway: what tomorrow holds because of today.
  const tomorrow = todayISO ? iso(addDaysISO(todayISO, 1)) : null;
  const next = plan && tomorrow
    ? plan.weeks.flatMap(w => w.workouts).filter(w =>
      w.discipline !== 'rest' && !(log || {})[w.id] && effDate(w, moves) === tomorrow)
    : [];
  slides.push({
    kind: 'takeaway', title: 'Tomorrow',
    big: next.length ? (next[0].title || next[0].type) : 'Rest day',
    lines: [next.length
      ? 'Today is banked; tomorrow asks for ' + fmtMin((next[0].durationMin || 0) * 60) + '. Your morning readiness gets the final say.'
      : 'Nothing planned — recovery is where today’s work becomes fitness.'],
  });

  return slides;
}

// Local date helpers (avoid importing Date-heavy utils into the pure builder).
function addDaysISO(isoStr, n) {
  const d = new Date(isoStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d;
}
function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
