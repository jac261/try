/* Try — the weekly digest: a backward look at the week that just finished.
 * Load banked, what the engine changed and why, and the week ahead — the
 * Sunday-evening wrap (Jon, 2026-07-15).
 *
 * Pure assembly, same discipline as recap.js: every number traces to a
 * derivation that already exists (effDate for membership, estimateTss for
 * load, formZone/rampZone words verbatim), rows only exist when their data
 * does, and missing data is dropped rather than guessed. The digest is
 * BACKWARD-looking only: it reports engine adjustments that were accepted,
 * and points at — never re-authors — the forward-looking weekly proposal.
 */
import { iso, addDays, startOfWeekMonday } from './date.js';
import { effDate } from './schedule.js';
import { estimateTss } from './adapt.js';
import { wellness as W } from './wellness.js';

// The week under review. A week only wraps once it is genuinely over: from
// Sunday 17:00 local the current week counts as finished (the athlete-panel
// hour gate — narrating an unfinished Sunday as a completed week reads
// wrong); before that, and Monday through Saturday, the previous full
// Monday-to-Sunday week is the subject.
export function reviewedWeekMonday(todayISO, hour) {
  const monday = iso(startOfWeekMonday(todayISO));
  const isSunday = new Date(todayISO + 'T12:00:00').getDay() === 0;
  if (isSunday && hour >= 17) return monday;
  return iso(addDays(monday, -7));
}

// The card lapses on its own schedule: visible through the Wednesday after
// the reviewed week's Sunday, gone Thursday — by then the new week owns the
// athlete's attention and stale praise reads as clutter.
export function digestWindowOpen(weekMonday, todayISO) {
  return todayISO <= iso(addDays(weekMonday, 9));
}

const inRange = (d, a, b) => d >= a && d <= b;

export function buildWeeklyDigest({ plan, log, moves, adjust, adjustLog, wellness, activities, todayISO, weekMonday }) {
  if (!weekMonday) return null;
  const weekEnd = iso(addDays(weekMonday, 6));
  const range = { start: weekMonday, end: weekEnd };
  const tracker = !plan || plan.race === 'tracker' || !Array.isArray(plan.weeks) || !plan.weeks.length;

  if (tracker) {
    // Tracker mode: no plan to compare against, so the week is exactly what
    // was recorded — counts and minutes from the feed, and load only when
    // the recordings carry it; manual diary entries carry an ESTIMATED load,
  // so any of them in the week puts the tilde on the total.
    const acts = (activities || []).filter(a => a && a.date && inRange(a.date, weekMonday, weekEnd) && a.movingTimeSec);
    if (!acts.length) return null;
    const totalMin = Math.round(acts.reduce((s, a) => s + a.movingTimeSec / 60, 0));
    const loads = acts.map(a => a.trainingLoad).filter(v => v != null);
    return {
      tracker: true, range,
      done: acts.length, planned: null, totalMin,
      load: loads.length ? Math.round(loads.reduce((s, v) => s + v, 0)) : null,
      loadEstimated: acts.some(a => a.estimated),
      fitness: fitnessLine(wellness, weekMonday, weekEnd),
      missed: [], engine: [], ahead: null,
    };
  }

  const all = plan.weeks.flatMap(wk => wk.workouts);
  const eff = w => effDate(w, moves);
  const sessions = all.filter(w => w.discipline !== 'rest' && !w.race && inRange(eff(w), weekMonday, weekEnd));
  const doneOnes = sessions.filter(w => (log || {})[w.id]);
  const races = all.filter(w => w.race && inRange(eff(w), weekMonday, weekEnd));

  const totalMin = Math.round(doneOnes.reduce((s, w) => {
    const e = log[w.id];
    return s + (e && e.actualMin != null ? e.actualMin : (w.durationMin || 0));
  }, 0));
  // Load banked = what was actually absorbed: done sessions only, through the
  // same estimator the load model uses, races excluded exactly as the load
  // model excludes them. Always an estimate — the component wears the tilde.
  const load = Math.round(doneOnes.reduce((s, w) =>
    s + estimateTss(w, (adjust || {})[w.id], log[w.id] && log[w.id].actualMin), 0));

  // Missed = strictly past sessions with no log entry. A session sitting on
  // today is not missed yet — the digest can be read before an evening swim.
  const missed = sessions.filter(w => eff(w) < todayISO && !(log || {})[w.id])
    .map(w => ({ title: w.title || w.type, day: eff(w) }))
    // a race that passed without a recording is the most important miss of
    // all; it lives outside `sessions` (load math excludes races) so it is
    // appended here explicitly
    .concat(races.filter(w => eff(w) < todayISO && !(log || {})[w.id])
      .map(w => ({ title: w.title || 'Race', day: eff(w) })));

  // Engine rows: the accepted weekly proposals quoted VERBATIM from the
  // accept-time log (one source of truth for "why" — never re-derived), plus
  // a generic line per overlay kind for adjustments the log does not cover
  // (daily eases, entries predating the log). The overlay is current-state,
  // so an ease that was later restored survives only through the log.
  const engine = [];
  (adjustLog || []).forEach(e => {
    if (e && e.at && inRange(e.at.slice(0, 10), weekMonday, weekEnd) && e.headline) {
      engine.push({ headline: e.headline, why: e.why || null });
    }
  });
  const GENERIC = {
    ease: 'eased to easy aerobic. Readiness called for it that day.',
    trim: 'trimmed back to protect you from overload.',
    boost: 'extended. Your form showed room to absorb more.',
  };
  sessions.forEach(w => {
    const a = (adjust || {})[w.id];
    if (!a || !GENERIC[a.kind]) return;
    // covered by a quoted proposal from the same week? then don't repeat it
    if (a.at && (adjustLog || []).some(e => e && e.at === a.at && e.headline)) return;
    engine.push({ headline: (w.title || w.type) + ' ' + GENERIC[a.kind], why: null });
  });

  // The week ahead, descriptive only: counts, minutes, phase, the standout
  // days. If the overlay already touched it, say so as a fact — the pending
  // proposal banner keeps sole authority over suggesting anything new.
  const nextStart = iso(addDays(weekMonday, 7));
  const nextEnd = iso(addDays(weekMonday, 13));
  const nextOnes = all.filter(w => w.discipline !== 'rest' && inRange(eff(w), nextStart, nextEnd));
  // Week identity (phase, number) resolves by the plan's NATIVE dates, not by
  // which moved workouts happen to sit in the range: a week whose sessions
  // all moved out must still report as itself, not as the week that lent it
  // a session (gauntlet finding, 2026-07-15).
  const weekAt = (a, b) => plan.weeks.find(w2 => w2.workouts.some(x => inRange(x.date, a, b)));
  const ahead = nextOnes.length ? {
    phase: (weekAt(nextStart, nextEnd) || {}).phase || null,
    sessions: nextOnes.length,
    totalMin: Math.round(nextOnes.reduce((s, w) => s + (w.durationMin || 0), 0)),
    keys: nextOnes.filter(w => w.race || w.test).map(w => w.title || w.type),
    adjusted: nextOnes.some(w => (adjust || {})[w.id]),
  } : null;

  // Nothing planned, nothing done, nothing changed: there is no week to wrap.
  if (!sessions.length && !races.length && !engine.length) return null;

  const wk = weekAt(weekMonday, weekEnd);
  return {
    tracker: false, range,
    phase: wk ? wk.phase : null,
    weekNo: wk ? wk.index + 1 : null,
    totalWeeks: plan.totalWeeks || plan.weeks.length,
    done: doneOnes.length, planned: sessions.length, totalMin,
    load: doneOnes.length ? load : null,
    loadEstimated: true,
    raceDone: races.filter(w => (log || {})[w.id]).map(w => w.title || 'Race'),
    fitness: fitnessLine(wellness, weekMonday, weekEnd),
    missed, engine, ahead,
  };
}

// Fitness over the week, in the app's established words: the CTL change
// across the week through rampZone, and the closing form through formZone —
// both labels verbatim so the digest matches the charts. Both endpoints must
// exist; a gap in the data drops the line rather than guessing (and never
// relabels an older reading as this week's).
function fitnessLine(wellness, weekMonday, weekEnd) {
  const recs = (wellness || []).filter(r => r && r.ctl != null && r.date);
  const before = iso(addDays(weekMonday, -1));
  const startRec = [...recs].reverse().find(r => r.date <= before);
  const endRec = [...recs].reverse().find(r => r.date <= weekEnd);
  if (!startRec || !endRec || endRec.date < weekMonday) return null;
  const delta = Math.round((endRec.ctl - startRec.ctl) * 10) / 10;
  const rz = W.rampZone(delta);
  const tsb = endRec.tsb != null ? endRec.tsb : (endRec.atl != null ? endRec.ctl - endRec.atl : null);
  const fz = tsb != null ? W.formZone(tsb) : null;
  return {
    delta,
    word: rz ? rz.label : null,
    formWord: fz ? fz.label : null,
  };
}
