/* Try — the run's load model and durability cautions. (run phase 6)
 *
 * Two things live here.
 *
 * FIRST, the volume model §2 asks for. runLoadFromActivities already tracked
 * one dimension, acute minutes against a baseline, and weeklyRunKm tracked
 * another, kilometres. Neither could answer how OFTEN the athlete ran, how
 * much of the week the long run was, or how much of it was quality. Those are
 * the dimensions a ramp is actually made of: a week can hold its minutes and
 * still change completely by adding a fourth run or moving ten minutes from
 * easy into threshold.
 *
 * SECOND, the long run's objective, classified rather than generated. This
 * mirrors bike-long.js exactly: the builder decides what a long run IS, and
 * this reads the built session back. One implementation, so the card and the
 * caution cannot disagree.
 *
 * WHAT THESE ARE NOT. Every output here is a coaching caution with a stated
 * cause, never a score and never a diagnosis (§3, §6). There is deliberately
 * no runDurabilityScore: a single number invites an athlete to read an injury
 * probability into arithmetic that carries nothing of the sort, and the bike
 * readiness module made the same choice for the same reason. Each signal
 * names the recent change that triggered it, because a caution the athlete
 * cannot act on is just an alarm (§5, §6 "plan changes are explainable").
 *
 * INDOOR RUNS COUNT (§2, and it was already true). A treadmill run is real
 * training load even though its DERIVED pace says nothing; the bike pass
 * suppressed rate for indoor recordings, never raw distance or duration. The
 * split is reported so a surface can say what it is looking at, not so
 * anything can be excluded.
 */

import { iso, addDays, startOfWeekMonday, daysBetween } from './date.js';
import { DISCIPLINE, isIndoor } from './autolog.js';
import { RUN_QUALITY_TYPES } from './runschema.js';

export const RUN_VOLUME_RULES = {
  weeks: 8,              // the window every run trend in the app already uses
  // A frequency step of this many runs a week, against the recent norm, is
  // worth mentioning. Adding a run changes the week's mechanical exposure
  // even when the minutes are unchanged.
  frequencyStep: 2,
  // Quality minutes as a share of the week. A jump of this much is a density
  // change rather than a volume change, and §5 treats the two differently.
  qualityShareStep: 0.10,
  // Below this the week is too thin to judge, matching RUN_RAMP_RULES.
  minWeeklyMin: 60,
  minBaselineWeeks: 2,
};

/* Per-week run load across the window, oldest first. Every dimension §2 asks
   for that the data can actually support. Surface and terrain are absent
   because the activity feed carries neither; §2 says "where available", and
   inventing them would be worse than their absence. */
export function runVolumeModel({ activities, log, plan, todayISO, weeks }) {
  const n = weeks || RUN_VOLUME_RULES.weeks;
  const today = todayISO || iso(new Date());
  const monday = iso(startOfWeekMonday(today));
  const starts = Array.from({ length: n }, (_, i) => iso(addDays(monday, -7 * (n - 1 - i))));
  const runs = (Array.isArray(activities) ? activities : [])
    .filter(a => a && a.date && DISCIPLINE[a.type] === 'run' && a.movingTimeSec);

  // planned type by date, so a recorded run can be told easy from quality.
  // Reads the plan rather than guessing from pace: a hard session run badly
  // is still a hard session, and pace-based classification would drop it.
  const plannedType = {};
  (plan && plan.weeks ? plan.weeks : []).forEach(w => (w.workouts || []).forEach(x => {
    if (x && x.discipline === 'run' && !x.race) plannedType[x.date] = x.type;
  }));

  return starts.map(start => {
    const end = iso(addDays(start, 7));
    const wk = runs.filter(a => a.date >= start && a.date < end);
    const min = a => a.movingTimeSec / 60;
    const totalMin = wk.reduce((t, a) => t + min(a), 0);
    const qualityMin = wk.reduce((t, a) => t + (RUN_QUALITY_TYPES.includes(plannedType[a.date]) ? min(a) : 0), 0);
    const longestMin = wk.reduce((m, a) => Math.max(m, min(a)), 0);
    const indoorMin = wk.filter(isIndoor).reduce((t, a) => t + min(a), 0);
    return {
      start,
      runs: wk.length,
      km: Math.round(wk.reduce((t, a) => t + (a.distance || 0), 0) / 1000 * 10) / 10,
      minutes: Math.round(totalMin),
      longestMin: Math.round(longestMin),
      // The long run's share of the week: the dimension §6 wants visible, and
      // the one that moves when a plan grows its long run without growing
      // anything else.
      longShare: totalMin > 0 ? Math.round(longestMin / totalMin * 100) / 100 : null,
      qualityMin: Math.round(qualityMin),
      qualityShare: totalMin > 0 ? Math.round(qualityMin / totalMin * 100) / 100 : null,
      indoorMin: Math.round(indoorMin),
      outdoorMin: Math.round(totalMin - indoorMin),
    };
  });
}

/* The weeks that count as the athlete's recent normal: complete, non-empty,
   and excluding the current in-progress week. Empty weeks are skipped rather
   than averaged in, so a holiday does not make the next week look like a
   spike (the same uncoupled baseline runLoadSignal uses). */
function baselineOf(model) {
  const past = model.slice(0, -1).filter(w => w.minutes > 0);
  if (past.length < RUN_VOLUME_RULES.minBaselineWeeks) return null;
  const mean = k => past.reduce((t, w) => t + (w[k] || 0), 0) / past.length;
  return { weeks: past.length, minutes: mean('minutes'), runs: mean('runs'), qualityShare: mean('qualityShare'), longestMin: mean('longestMin') };
}

/* Coaching cautions, each naming the change that caused it. Never a score,
   never a diagnosis, and silent when the history is too thin to mean
   anything — an athlete two weeks into using the app must not be told their
   training is escalating (§3). */
export function runDurabilitySignals({ activities, log, plan, todayISO, weeks }) {
  const model = runVolumeModel({ activities, log, plan, todayISO, weeks });
  const current = model[model.length - 1];
  const base = baselineOf(model);
  if (!base || base.minutes < RUN_VOLUME_RULES.minWeeklyMin) return [];
  const out = [];

  const freqStep = current.runs - base.runs;
  if (freqStep >= RUN_VOLUME_RULES.frequencyStep) {
    out.push({
      key: 'frequency-jump',
      caution: 'You are running more often than usual this week.',
      // §5: state WHICH recent change triggered this.
      why: 'You have run ' + current.runs + ' times this week against a recent average of '
        + Math.round(base.runs * 10) / 10 + '. Extra sessions add mechanical load even when the hours do not change.',
      change: { dimension: 'frequency', from: Math.round(base.runs * 10) / 10, to: current.runs },
    });
  }

  if (current.qualityShare != null && base.qualityShare != null
    && current.qualityShare - base.qualityShare >= RUN_VOLUME_RULES.qualityShareStep) {
    out.push({
      key: 'quality-density',
      caution: 'More of your running is hard than usual.',
      why: 'Hard running is ' + Math.round(current.qualityShare * 100) + '% of this week against '
        + Math.round(base.qualityShare * 100) + '% recently. The hours can hold steady while the week gets harder.',
      change: { dimension: 'quality-density', from: base.qualityShare, to: current.qualityShare },
    });
  }

  if (base.longestMin > 0 && current.longestMin > base.longestMin) {
    const jump = current.longestMin / base.longestMin - 1;
    if (jump >= 0.4) {
      out.push({
        key: 'long-run-jump',
        caution: 'Your longest run this week is a big step up.',
        why: 'It is ' + current.longestMin + ' minutes against a recent longest of '
          + Math.round(base.longestMin) + '. Large single steps are the classic overuse vector, more than gentle weekly drift.',
        change: { dimension: 'long-run', from: Math.round(base.longestMin), to: current.longestMin },
      });
    }
  }

  return out;
}

/* ---- the long run's objective (§4) ------------------------------------- */

export const RUN_LONG_OBJECTIVES = {
  'easy-endurance': {
    label: 'Easy endurance',
    why: 'Time on your feet and nothing else. This is the run that builds the base everything else sits on, and it is meant to feel unremarkable.',
  },
  'fast-finish': {
    label: 'Fast finish',
    why: 'Steady for most of it, then a controlled lift at the end. It teaches you to change gear on legs that are already tired.',
  },
  'late-run-stability': {
    label: 'Late-run stability',
    why: 'Harder efforts placed deliberately late. Race day asks for your best running when you are no longer fresh, and this is the session that rehearses it.',
  },
  'race-pace': {
    label: 'Race-pace blocks',
    why: 'A block at the effort you intend to hold on race day, inside a run long enough to make it honest.',
  },
};

/* Long runs that are HARD. Kept as a named set rather than an inline test so
   the "do not make every long run harder" rule and the classifier cannot
   drift apart. */
export const HARD_LONG_OBJECTIVES = ['late-run-stability', 'race-pace'];

/* No more than this share of an athlete's long runs should be hard ones.
   §4 states the rule in words; this is the number, matching the bike's
   MAX_HARD_LONG_SHARE. Measured across every solo plan in the matrix the
   engine sits at 12.5%, so this is a ceiling the engine already respects
   rather than a target it has to be moved towards. */
export const MAX_HARD_LONG_SHARE = 0.25;

/* What a built long run is FOR. Reads the session the builder produced, the
   way bike-long.js does, rather than re-deciding it: one implementation means
   the card and any surface describing it always agree.

   Order matters. The tired-legs variant also contains race-pace-ish work, so
   the most specific intent is tested first. */
export function runLongObjective(workout) {
  if (!workout || workout.discipline !== 'run' || workout.race) return null;
  const isLong = workout.type === 'Long' || workout.easedFrom === 'Long';
  if (!isLong) return null;
  const segs = workout.segments || [];
  const label = s => s.label || '';
  // the builder writes this one's intent into the label, and it is the only
  // variant that puts hard efforts deliberately late
  if (segs.some(s => /tired legs/i.test(label(s)))) return 'late-run-stability';
  if (segs.some(s => /marathon effort|half marathon effort|race pace/i.test(label(s)))) return 'race-pace';
  if (segs.some(s => /fast finish/i.test(label(s)))) return 'fast-finish';
  const quality = segs.filter(s => s.zone && s.zone !== 'Z1' && s.zone !== 'Z2');
  if (!quality.length) return 'easy-endurance';
  // A long run with quality this module cannot name is not silently called
  // easy: that would under-report the hard share the rule above depends on.
  return 'other';
}

/* The mix of objectives across a set of long runs, and whether it honours
   "do not make every long run harder". */
export function longRunMix(workouts) {
  const objectives = (workouts || []).map(runLongObjective).filter(Boolean);
  const hard = objectives.filter(o => HARD_LONG_OBJECTIVES.includes(o)).length;
  const counts = {};
  objectives.forEach(o => { counts[o] = (counts[o] || 0) + 1; });
  return {
    total: objectives.length,
    counts,
    hard,
    hardShare: objectives.length ? hard / objectives.length : 0,
    withinGuidance: !objectives.length || hard / objectives.length <= MAX_HARD_LONG_SHARE,
    // Rotation, not repetition: how many distinct objectives the block used.
    distinct: Object.keys(counts).length,
  };
}
