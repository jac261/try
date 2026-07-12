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
    count: { to: activity.movingTimeSec, fmt: 'dur' }, // count the clock up
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

  // 3 — heart rate (only once the backend passes averages through). When the
  // interval/lap breakdown is available, each segment's average HR is plotted
  // in time order as an honest rise-and-fall profile across the session — this
  // is segment-average resolution, not a raw beat stream (we do not fetch one).
  if (activity.averageHeartrate) {
    // Anchor each point to real elapsed time (startTimeSec) so paused gaps and
    // array order can't distort the trace; fall back to cumulative moving time
    // when the feed omits start times, then sort so it always reads left to
    // right in clock order.
    let cum = 0;
    const series = [];
    (intervals || []).forEach(iv => {
      const dur = iv && iv.movingTimeSec ? iv.movingTimeSec : 0;
      const t = iv && iv.startTimeSec != null ? iv.startTimeSec + dur / 2 : cum + dur / 2;
      cum += dur;
      if (iv && iv.averageHeartrate != null && dur) series.push({ t, hr: Math.round(iv.averageHeartrate) });
    });
    series.sort((a, b) => a.t - b.t);
    slides.push({
      kind: 'hr', title: 'Heart rate', big: Math.round(activity.averageHeartrate) + ' bpm',
      count: { to: Math.round(activity.averageHeartrate), fmt: 'bpm' },
      lines: ['average across the session' + (activity.maxHeartrate ? ', peaking at ' + Math.round(activity.maxHeartrate) : '')],
      hr: series.length >= 2 ? {
        series,
        avg: Math.round(activity.averageHeartrate),
        max: activity.maxHeartrate ? Math.round(activity.maxHeartrate) : Math.max(...series.map(p => p.hr)),
      } : null,
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
      count: { to: Math.round(activity.trainingLoad), fmt: 'load' },
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
