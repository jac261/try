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
   a first-class answer rather than a zero pretending to be data. Phase 2
   hoisted the vocabulary to coaching/evidence.js (the spec's §2 kinds are
   these, verbatim); re-exported here so every existing consumer is
   byte-unchanged. */
import { SOURCE_KINDS, SOURCE_WORDS, metric } from './coaching/evidence.js';
export { SOURCE_KINDS, SOURCE_WORDS, metric };

export const DASH_RULES = {
  weeks: 6,              // the window every rolling figure uses
  completionFloor: 0.7,  // below this, consistency is the limiter
  fadeConcern: 3,        // percent slower in the closing reps
  minSessions: 4,        // below this there is no completion rate worth naming
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
    // Today is not yet a miss: a session still ahead of the athlete must not
    // be counted against them (review catch 2026-07-27, which had day one of
    // every new plan announcing 0% completion).
    if (date >= todayISO) return;
    const bucket = weeks.find(x => date >= x.start && date <= x.end);
    // EVERY figure in this card is the six-week window the card is headed
    // with. Counting completion all-time let one missed swim months ago pin
    // the limiter forever, under six green weeks (review catch 2026-07-27).
    if (!bucket) return;
    const isDone = !!(log && log[w.id]);
    planned++;
    bucket.planned++;
    if (!isDone) return;
    done++;
    bucket.done++;
    bucket.minutes += w.durationMin || 0;
    bucket.metres += Math.round((w.distance || 0) * 1000);
    if (!w.test) mix[w.type] = (mix[w.type] || 0) + 1;
  });
  // The current week is still in progress, so averaging it in as a whole
  // week deflates every per-week figure every Monday.
  const thisWeek = weeks[weeks.length - 1];
  const recent = weeks.filter(w => w.planned > 0 && w !== thisWeek);
  const perWeek = recent.length ? recent.reduce((t, w) => t + w.done, 0) / recent.length : null;
  return {
    weeks,
    mix,
    sessionsPerWeek: metric(perWeek == null ? null : Math.round(perWeek * 10) / 10, 'derived'),
    minutesPerWeek: metric(recent.length ? Math.round(recent.reduce((t, w) => t + w.minutes, 0) / recent.length) : null, 'derived'),
    metresPerWeek: metric(recent.length ? Math.round(recent.reduce((t, w) => t + w.metres, 0) / recent.length) : null, 'derived'),
    // A handful of sessions is not a completion rate. Below the floor the
    // metric reports itself as missing rather than letting one skipped swim
    // in a new plan read as a consistency problem.
    completion: metric(planned >= DASH_RULES.minSessions ? Math.round(done / planned * 100) / 100 : null, 'derived',
      planned ? done + ' of ' + planned + ' planned swims in the last ' + DASH_RULES.weeks + ' weeks' : null),
  };
}

/* §6 quality execution, from the phase 4 review engine. Stored reviews are
   the only honest source here: without them the dashboard says so rather
   than guessing from whole-session averages. */
function quality({ plan, log, moves, todayISO }) {
  // Windowed and dated by when the swim was COMPLETED: the limiter copy
  // speaks in the present tense, so a bad block months ago must not keep
  // naming endurance (review catch 2026-07-27).
  const reviews = swimsOf(plan)
    .filter(w => log && log[w.id] && log[w.id].swimReview)
    .map(w => ({
      ...log[w.id].swimReview,
      date: (log[w.id].at || '').slice(0, 10) || (moves && moves[w.id]) || w.date,
    }))
    .filter(r => {
      const age = daysBetween(r.date, todayISO);
      return age >= 0 && age <= DASH_RULES.weeks * 7;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!reviews.length) {
    return {
      reviews: [],
      adherence: metric(null, 'missing'),
      fade: metric(null, 'missing'),
      consistency: metric(null, 'missing'),
      note: 'Reviews are kept from each swim you open with its laps, and this rolling view builds as they accrue. Nothing here is guessed from averages in the meantime.',
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
  // Same window as everything else on the card: a swim from five months ago
  // is not "recent" evidence, and it must not be trusted further back than a
  // real recording is (review catch 2026-07-27).
  const inWindow = w => {
    const date = (moves && moves[w.id]) || w.date;
    const age = daysBetween(date, todayISO);
    return age >= 0 && age <= DASH_RULES.weeks * 7;
  };
  const completedRecently = swimsOf(plan).filter(w => log && log[w.id] && inWindow(w));
  const longs = completedRecently.filter(w => w.type === 'Long');
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
  const longestPrescribed = completedRecently
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
// CSS is the pace a swimmer can hold for roughly this far, so it is the
// anchor: shorter than this is swum FASTER than CSS, longer is slower. The
// first cut anchored at 400 m, which made every 400 estimate slower than
// the athlete's own measured 400 (CSS is defined as (t400-t200)/2 per 100,
// which is always slower than t400/4) — the dashboard contradicting a
// number the app itself prints (review catch 2026-07-27).
export const CSS_ANCHOR_M = 1500;
export function swimEstimates({ css, longestM, completion, owSessions }) {
  return EST_DISTANCES.map(d => {
    if (!css) return { ...d, range: null, why: 'Set or test your CSS and these appear.' };
    // Evidence gate: you have to have swum something within reach of it.
    // Nothing is exempt — a 400 quoted beside four withheld rows read as the
    // best-evidenced number when it had none at all.
    const reach = d.m * 0.6;
    if (longestM < reach) {
      return { ...d, range: null, why: 'Swim continuously past ' + Math.round(reach) + ' m and this appears.' };
    }
    const over = Math.log(d.m / CSS_ANCHOR_M) / Math.log(2);
    const drift = Math.pow(2, 0.04 * over);   // 4% per doubling either side
    // Uncertainty means the swim could go SLOWER than the middle estimate,
    // never faster, so only the upside carries it. The downside is fixed:
    // otherwise inconsistent training bought a faster best case, which is
    // exactly backwards (review catch 2026-07-27).
    const spread = 0.02 + 0.02 * Math.abs(over) * (completion != null && completion >= 0.8 ? 0.6 : 1);
    const downSpread = 0.02 + 0.02 * Math.abs(over) * 0.6;
    const mid = (d.m / 100) * css * drift;
    // The band widens UPWARD. Widening it symmetrically made the fast end
    // quicker per 100 than CSS over 3.8 km, and worse, handed the LEAST
    // consistent athlete the fastest best case, because low completion
    // widened the band downward too.
    let low = Math.round(mid * (1 - downSpread * 0.35));
    const high = Math.round(mid * (1 + spread));
    // and past the anchor, no best case is faster per 100 than CSS itself
    if (d.m > CSS_ANCHOR_M) low = Math.max(low, Math.round((d.m / 100) * css));
    return {
      ...d,
      range: [low, high],
      why: null,
      openWater: d.m >= 750 && owSessions === 0 ? 'Pool estimate: no open-water swims recorded.' : null,
    };
  });
}

/* §4/§5: one limiter, its evidence, and what the plan is already doing.
   Ordered so the most actionable thing wins: a plan that is not being
   completed cannot be out-trained, and a missing threshold cannot be
   coached around. */
export function swimLimiter(d, today) {
  const out = (id, headline, evidence, response) => ({ id, headline, evidence, response });
  const t = d.status.threshold;
  const comp = d.distribution.completion.value;
  const owRaceSoon = d.openWater.raceSoon;

  if (comp != null && comp < DASH_RULES.completionFloor) {
    return out('consistency', 'Consistency is limiting your swim',
      ['You have completed ' + Math.round(comp * 100) + '% of your planned swims.',
        'Progression needs the sessions to happen before it can ask for more.'],
      ['Missed sessions are never made up: the week moves on rather than piling up behind you.',
        'Nothing else on this page can mean much until the sessions are happening.']);
  }
  if (d.quality.evidence && d.quality.evidence.direction === 'under') {
    return out('threshold', 'Threshold is limiting your swim',
      ['Recent quality sessions are coming in slower than their targets.',
        'That usually means the paces are set too hot rather than that you are unfit.'],
      /* Describes the mechanism, not the current nudge state: the actual
         retest recommendation is silenced for a month after a swum test, and
         this card asserting "a retest is recommended" rendered on the same
         page as the retest row correctly saying none was due. */
      ['When several swims agree like this, the app recommends a fresh CSS test rather than moving your paces on its own.',
        'Your paces are all built from that one number, so it is the thing worth getting right.']);
  }
  if (d.quality.fade && d.quality.fade.value != null && d.quality.fade.value > DASH_RULES.fadeConcern) {
    return out('endurance', 'Endurance is limiting your swim',
      ['Your pace fades by about ' + d.quality.fade.value + '% in the closing efforts.',
        d.endurance.longestM.value ? 'Longest continuous swim: ' + d.endurance.longestM.value + ' m.' : 'No long continuous swim recorded yet.'],
      ['Your Long Swims build the continuous distance the fade is asking for.',
        'If it deepens, ease the closing reps rather than chasing the target through them.']);
  }
  /* MISSING DATA RANKS BELOW EVERYTHING MEASURED. This branch used to sit
     second, so a swimmer with recorded fades on every reviewed swim, or an
     open-water race a month away and zero exposure, was told only that their
     paces were guesses — the bike limiter was reordered for exactly this in
     its gauntlet ("absence yields to presence") and the swim sibling never
     was. And the response now checks whether a CSS test actually remains
     ahead rather than promising one that has already gone past. */
  if (!t.cssSecondsPer100m && !(owRaceSoon && d.openWater.exposure.sessions === 0)
    && !(d.quality.fade && d.quality.fade.value != null && d.quality.fade.value > DASH_RULES.fadeConcern)) {
    return out('threshold-unknown', 'Your swim paces are guesses',
      ['No CSS has been measured, so every swim target is derived from your level.'],
      [d.testAhead
        ? 'Your plan has a CSS test on ' + d.testAhead + '. Once you swim it, every swim pace re-targets to you.'
        : 'Your plan’s CSS test has already passed. You can swim the 400/200 test any time and enter the result under Update fitness.']);
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
  // Only claim what there is evidence for: with no stored reviews the
  // quality half of this sentence would be manufactured from absence
  // (review catch 2026-07-27).
  const hasQuality = !!(d.quality.adherence && d.quality.adherence.value != null);
  /* An all-clear and an absence of data are different answers, and this
     branch used to give both the same headline: a day-one athlete read
     "Nothing is obviously holding your swim back" in the largest text on the
     card, directly above its own evidence line saying there was not enough
     data to name a limiter. The bike dashboard fixed this in its gauntlet;
     the fix is now on both sides. */
  if (!(d.distribution.completion && d.distribution.completion.value != null)) {
    return out('too-early', 'Not enough swimming yet to name a limiter',
      ['Your plan has not been running long enough for the figures below to mean much.',
        'They fill in as sessions are completed.'],
      ['The plan progresses as written in the meantime.']);
  }
  return out('none', 'Nothing is obviously holding your swim back',
    ['You are completing your planned swims.',
      ...(hasQuality ? ['Your quality sessions are landing on target.'] : [])],
    ['The plan continues to progress as written.']);
}

/* The whole dashboard model. One call, one pure object. */
export function swimDashboard({ plan, log, moves, activities, thresholds, todayISO, retest }) {
  const today = todayISO || iso(new Date());
  const profile = (plan && plan.profile) || {};
  const t = swimThreshold(profile);
  const tech = saneTechnique(profile.technique);
  const dist = distribution({ plan, log, moves, todayISO: today });
  const qual = quality({ plan, log, moves, todayISO: today });
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
      // A fitnessHistory entry holds the value that was SUPERSEDED on that
      // date, which is why fitnessSeries.js appends the live value as the
      // final point. Without that the chart ends on the number the athlete
      // has just beaten, and a fresh test never shows (review catch
      // 2026-07-27).
      history: (() => {
        const past = (profile.fitnessHistory || []).filter(h => h && h.css100Sec)
          .map(h => ({ date: h.date, css: h.css100Sec }));
        return t.cssSecondsPer100m ? past.concat([{ date: t.measuredAt || today, css: t.cssSecondsPer100m }]) : past;
      })(),
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
  const cssTests = (plan.weeks || []).flatMap(w => w.workouts)
    .filter(w => w.test && w.testKind === 'swimCss' && !(log && log[w.id]))
    .map(w => (moves && moves[w.id]) || w.date)
    .filter(dt => dt >= today).sort();
  d.testAhead = cssTests.length ? cssTests[0] : null;
  d.limiter = swimLimiter(d, today);
  return d;
}
