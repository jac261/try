/* Try — phase 7: the swim progression dashboard.
 *
 * One question: what is limiting my swim, and what is the plan doing about
 * it? Everything here is a pure read over what phases 1 to 6 already built
 * (the threshold model, the review engine, the retest recommendation, the
 * technique profile, open-water exposure). Nothing generates, nothing
 * writes, and nothing is stored.
 *
 * Two rules run through it. Every number says where it came from (§7), so a
 * derived figure can never be read as a measured one. And a number with no
 * evidence behind it is not shown at all: the dashboard says what is
 * missing instead of inventing precision (§3).
 */
import { swimThreshold } from './domain.js';
import { daysBetween, iso, startOfWeekMonday, addDays } from './date.js';
import { segMinutes } from './plan.js';
import { openWaterExposure } from './swim-open-water.js';
import { swimReviewEvidence } from './swim-review.js';
import { TECHNIQUE_FOCUS, saneTechnique } from './swim-drills.js';

/* §7: where a number came from. Every metric carries one, and 'missing' is
   a first-class answer rather than a zero pretending to be data. */
export const SOURCE_KINDS = ['recorded', 'derived', 'reported', 'estimated', 'missing'];
export const SOURCE_WORDS = {
  recorded: 'from your recordings',
  derived: 'worked out from your plan and logs',
  reported: 'your own answer',
  estimated: 'an estimate',
  missing: 'not enough data yet',
};
export function metric(value, kind, note) {
  const k = SOURCE_KINDS.includes(kind) ? kind : 'missing';
  return { value: value == null ? null : value, kind: value == null ? 'missing' : k, note: note || null };
}

export const DASH_RULES = {
  weeks: 6,              // the window every rolling figure uses
  completionFloor: 0.7,  // below this, consistency is the limiter
  fadeConcern: 3,        // percent slower in the closing reps
  owRecentDays: 42,
  owRaceSoonDays: 56,    // an open-water race this close wants exposure
};

const swimsOf = plan => (plan && plan.weeks ? plan.weeks.flatMap(w => w.workouts) : [])
  .filter(w => w.discipline === 'swim' && !w.race);

/* §2/§6: what the athlete has actually been doing, week by week. Planned
   against completed, because a plan nobody swims is the most important
   thing a swim dashboard can tell you. */
function distribution({ plan, log, moves, todayISO }) {
  const weeks = [];
  const monday = startOfWeekMonday(todayISO);
  for (let i = DASH_RULES.weeks - 1; i >= 0; i--) {
    const start = iso(addDays(monday, -7 * i));
    const end = iso(addDays(start, 6));
    weeks.push({ start, end, planned: 0, done: 0, minutes: 0, metres: 0 });
  }
  const mix = {};
  let planned = 0, done = 0;
  swimsOf(plan).forEach(w => {
    const date = (moves && moves[w.id]) || w.date;
    if (date > todayISO) return;             // the future is not a completion record
    const bucket = weeks.find(x => date >= x.start && date <= x.end);
    const isDone = !!(log && log[w.id]);
    planned++;
    if (isDone) done++;
    if (!bucket) return;
    bucket.planned++;
    if (!isDone) return;
    bucket.done++;
    bucket.minutes += w.durationMin || 0;
    bucket.metres += Math.round((w.distance || 0) * 1000);
    if (!w.test) mix[w.type] = (mix[w.type] || 0) + 1;
  });
  const recent = weeks.filter(w => w.planned > 0);
  const perWeek = recent.length ? recent.reduce((t, w) => t + w.done, 0) / recent.length : null;
  return {
    weeks,
    mix,
    sessionsPerWeek: metric(perWeek == null ? null : Math.round(perWeek * 10) / 10, 'derived'),
    minutesPerWeek: metric(recent.length ? Math.round(recent.reduce((t, w) => t + w.minutes, 0) / recent.length) : null, 'derived'),
    metresPerWeek: metric(recent.length ? Math.round(recent.reduce((t, w) => t + w.metres, 0) / recent.length) : null, 'derived'),
    completion: metric(planned ? Math.round(done / planned * 100) / 100 : null, 'derived',
      planned ? done + ' of ' + planned + ' planned swims' : null),
  };
}

/* §6 quality execution, from the phase 4 review engine. Stored reviews are
   the only honest source here: without them the dashboard says so rather
   than guessing from whole-session averages. */
function quality({ plan, log }) {
  const reviews = swimsOf(plan)
    .filter(w => log && log[w.id] && log[w.id].swimReview)
    .map(w => ({ ...log[w.id].swimReview, date: w.date }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!reviews.length) {
    return {
      reviews: [],
      adherence: metric(null, 'missing'),
      fade: metric(null, 'missing'),
      consistency: metric(null, 'missing'),
      note: 'Session reviews appear once your swims are matched to recordings.',
    };
  }
  const usable = reviews.filter(r => r.confidence !== 'low');
  const avg = (list, k) => {
    const v = list.map(r => r[k]).filter(x => x != null);
    return v.length ? Math.round(v.reduce((t, x) => t + x, 0) / v.length * 10) / 10 : null;
  };
  return {
    reviews,
    adherence: metric(avg(usable, 'paceAdherence'), 'derived', usable.length + ' judged sessions'),
    fade: metric(avg(usable, 'fadePercent'), 'derived'),
    consistency: metric(avg(usable, 'consistency'), 'derived'),
    evidence: swimReviewEvidence(reviews),
  };
}

/* §6 endurance readiness: the longest thing actually swum, not the longest
   thing planned. */
function endurance({ plan, log, moves, activities, todayISO }) {
  const longs = swimsOf(plan).filter(w => w.type === 'Long' && log && log[w.id]);
  const recorded = (activities || [])
    .filter(a => a && (a.type === 'Swim' || a.type === 'OpenWaterSwim') && a.distance
      && daysBetween(a.date, todayISO) >= 0 && daysBetween(a.date, todayISO) <= DASH_RULES.weeks * 7);
  const longestRecorded = recorded.reduce((m, a) => Math.max(m, a.distance || 0), 0);
  // the longest CONTINUOUS block prescribed in a completed swim, which is
  // the honest floor when no recording carries a distance
  //   Shoulders are not endurance evidence: a 500 m warm-up is not the
  // longest thing an athlete can swim, and letting one count would both
  // overstate the endurance card and unlock estimates it should not
  // (self-check 2026-07-27).
  const longestPrescribed = swimsOf(plan)
    .filter(w => log && log[w.id])
    .flatMap(w => w.segments || [])
    .filter(s => s.swim && s.swim.distM && !(s.swim.n > 1)
      && !/^(warm-up|cool-down)/i.test(s.label || ''))
    .reduce((m, s) => Math.max(m, s.swim.distM), 0);
  return {
    longestM: longestRecorded
      ? metric(Math.round(longestRecorded), 'recorded')
      : metric(longestPrescribed || null, 'derived', longestPrescribed ? 'longest continuous block you completed' : null),
    longSwims: metric(longs.length, 'derived', DASH_RULES.weeks + '-week window'),
  };
}

/* §3: performance estimates, and the refusal to make them up. CSS is
   measured over a few hundred metres; the further past that a distance
   sits, the more it depends on endurance the athlete has to have actually
   shown. Where they have not, the estimate is withheld and the dashboard
   says what would unlock it. Every answer is a RANGE: a single number here
   would be exactly the false precision the spec warns about. */
export const EST_DISTANCES = [
  { m: 400, label: '400 m' },
  { m: 750, label: '750 m' },
  { m: 1500, label: '1500 m' },
  { m: 1900, label: '1.9 km' },
  { m: 3800, label: '3.8 km' },
];
export function swimEstimates({ css, longestM, completion, owSessions }) {
  return EST_DISTANCES.map(d => {
    if (!css) return { ...d, range: null, why: 'Set or test your CSS and these appear.' };
    // evidence gate: you have to have swum something within reach of it
    const reach = d.m <= 500 ? 0 : d.m * 0.6;
    if (longestM < reach) {
      return { ...d, range: null, why: 'Swim continuously past ' + Math.round(reach) + ' m and this appears.' };
    }
    // pace drifts off CSS with distance; the band widens the further the
    // estimate reaches past the evidence, and narrows when training has
    // been consistent
    const over = Math.max(0, Math.log(Math.max(d.m, 400) / 400) / Math.log(2));
    const drift = 1 + 0.02 * over;
    const spread = 0.02 + 0.02 * over * (completion != null && completion >= 0.8 ? 0.6 : 1);
    const mid = (d.m / 100) * css * drift;
    return {
      ...d,
      range: [Math.round(mid * (1 - spread)), Math.round(mid * (1 + spread))],
      why: null,
      openWater: d.m >= 750 && owSessions === 0 ? 'Pool estimate: no open-water swims recorded.' : null,
    };
  });
}

/* §4/§5: one limiter, its evidence, and what the plan is already doing.
   Ordered so the most actionable thing wins: a plan that is not being
   completed cannot be out-trained, and a missing threshold cannot be
   coached around. */
export function swimLimiter(d) {
  const out = (id, headline, evidence, response) => ({ id, headline, evidence, response });
  const t = d.status.threshold;
  const comp = d.distribution.completion.value;
  const owRaceSoon = d.openWater.raceSoon;

  if (comp != null && comp < DASH_RULES.completionFloor) {
    return out('consistency', 'Consistency is limiting your swim',
      ['You have completed ' + Math.round(comp * 100) + '% of your planned swims.',
        'Progression needs the sessions to happen before it can ask for more.'],
      ['The plan holds its current progression rather than adding load.',
        'Missed sessions are never made up: the week moves on.']);
  }
  if (!t.cssSecondsPer100m) {
    return out('threshold-unknown', 'Your swim paces are guesses',
      ['No CSS has been measured, so every swim target is derived from your level.'],
      ['A CSS test is scheduled in your plan.', 'Once you swim it, every swim pace re-targets to you.']);
  }
  if (d.quality.evidence && d.quality.evidence.direction === 'under') {
    return out('threshold', 'Threshold is limiting your swim',
      ['Recent quality sessions are coming in slower than their targets.',
        'That usually means the paces are set too hot rather than that you are unfit.'],
      ['A CSS retest is recommended so the targets match you.',
        'Until then the plan repeats rather than progresses the CSS sets.']);
  }
  if (d.quality.fade.value != null && d.quality.fade.value > DASH_RULES.fadeConcern) {
    return out('endurance', 'Endurance is limiting your swim',
      ['Your pace fades by about ' + d.quality.fade.value + '% in the closing efforts.',
        d.endurance.longestM.value ? 'Longest continuous swim: ' + d.endurance.longestM.value + ' m.' : 'No long continuous swim recorded yet.'],
      ['The plan holds the current progression until the sets stop fading.',
        'Long Swims build the continuous distance the fade is asking for.']);
  }
  if (owRaceSoon && d.openWater.exposure.sessions === 0) {
    return out('open-water', 'Open-water exposure is limiting your race readiness',
      ['Your race swim is open water and you have no open-water sessions recorded.',
        'Pool fitness does not transfer on its own: sighting and starts have to be rehearsed.'],
      ['Open-water sessions appear in your peak weeks.',
        'Every one has a pool equivalent for when the water is not an option.']);
  }
  if (d.status.focus.length) {
    const names = d.status.focus.map(f => (TECHNIQUE_FOCUS.find(x => x.id === f) || {}).label).filter(Boolean);
    return out('technique', 'Technique is your chosen limiter',
      ['You are working on ' + names.join(' and ') + '.',
        'Your technique sessions are selecting drills for it.'],
      ['Drills are biased to your focus, hardest last so it reads as a progression.',
        'Your kit list keeps the selection to drills you can actually do.']);
  }
  return out('none', 'Nothing is obviously limiting your swim',
    ['Sessions are being completed and the quality work is landing on target.'],
    ['The plan continues to progress as written.']);
}

/* The whole dashboard model. One call, one pure object. */
export function swimDashboard({ plan, log, moves, activities, thresholds, todayISO, retest }) {
  const today = todayISO || iso(new Date());
  const profile = (plan && plan.profile) || {};
  const t = swimThreshold(profile);
  const tech = saneTechnique(profile.technique);
  const dist = distribution({ plan, log, moves, todayISO: today });
  const qual = quality({ plan, log });
  const end = endurance({ plan, log, moves, activities, todayISO: today });
  const exposure = openWaterExposure({
    activities, todayISO: today, workouts: swimsOf(plan), logged: log,
  });
  const raceDays = plan && plan.profile && plan.profile.raceDate
    ? daysBetween(today, plan.profile.raceDate) : null;
  const d = {
    status: {
      threshold: t,
      css: metric(t.cssSecondsPer100m, t.source === 'try-test' ? 'recorded' : t.source === 'estimated' ? 'estimated' : 'reported'),
      source: t.source,
      measuredAt: t.measuredAt,
      confidence: t.confidence,
      history: (profile.fitnessHistory || []).filter(h => h && h.css100Sec).map(h => ({ date: h.date, css: h.css100Sec })),
      focus: (tech && tech.focus) || [],
    },
    distribution: dist,
    quality: qual,
    endurance: end,
    openWater: {
      exposure,
      raceSoon: !!(profile.openWaterRace && raceDays != null && raceDays >= 0 && raceDays <= DASH_RULES.owRaceSoonDays),
    },
    nextAction: {
      retest: retest || null,
      nextKey: (swimsOf(plan).filter(w => w.date >= today && (w.key || w.test))
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0]) || null,
    },
  };
  d.estimates = swimEstimates({
    css: t.cssSecondsPer100m,
    longestM: end.longestM.value || 0,
    completion: dist.completion.value,
    owSessions: exposure.sessions,
  });
  d.limiter = swimLimiter(d);
  return d;
}
