/* Try — the run dashboard. (run phase 9 §1, §2)
 *
 * Five questions, in the order a runner asks them (§1):
 *   Is my running improving?   -> currentPerformance
 *   Is volume progressing safely?  -> trainingVolume
 *   Is my long run keeping pace?   -> durability
 *   What is limiting me?           -> nextAction.limiter
 *   What is Try changing next?     -> nextAction.response
 *
 * IT COMPUTES NOTHING OF ITS OWN. Every number here comes from the module
 * that owns it: the benchmark from run-benchmark, projections from runstats,
 * volume and cautions from run-durability, the long-run mix from the same,
 * readiness from run-readiness, and evidence from run-review. A dashboard
 * that re-derives a figure is a second opinion with a bigger font, and the
 * swim dashboard shipped exactly that bug — a trend that ended on the number
 * the athlete had just beaten, because it recomputed history its own way.
 *
 * REAL AND ESTIMATED ARE NEVER MIXED (§6). The benchmark section reports the
 * anchor's kind alongside its value, and projections are absent rather than
 * approximate when the anchor is not real. An athlete looking at this must be
 * able to tell, without reading a caption, which numbers they earned.
 *
 * IT DOES NOT REDRAW INTERVALS.ICU (§6). No pace curves, no HR distributions,
 * no training-load graph. Every section exists to support a decision the plan
 * is about to make; anything that is merely interesting belongs in the tool
 * the athlete already has open.
 */

import { runBenchmark, runBenchmarkHistory } from './run-benchmark.js';
import { predictRaceTimes } from './runstats.js';
import { runAnchor } from './domain.js';
import { runVolumeModel, runDurabilitySignals, longRunMix } from './run-durability.js';
import { runReadiness, runReadinessGaps } from './run-readiness.js';
import { runReviewEvidence } from './run-review.js';
import { RUN_QUALITY_TYPES } from './runschema.js';

// A value with its provenance attached, so no caller has to remember which
// numbers are measured. `kind` is 'real' | 'estimated' | 'none'.
const metric = (value, kind, note) => ({ value: value == null ? null : value, kind, note: note || null });

/* Is my running improving? */
export function currentPerformance(profile) {
  const anchor = runAnchor(profile);
  const bench = runBenchmark(profile);
  const history = runBenchmarkHistory(profile);
  const projections = predictRaceTimes(profile);
  return {
    benchmark: bench
      ? metric(bench.timeSeconds, 'real', bench.source)
      : metric(anchor.timeSec, 'estimated', anchor.source),
    measuredAt: bench ? bench.measuredAt : null,
    confidence: bench ? bench.confidence : null,
    history,
    // Absent, not approximate. A projection from a level guess is a finish
    // time derived from nothing the athlete has ever done.
    projections: projections || null,
    projectionConfidence: projections ? (bench && bench.confidence) || 'medium' : null,
    improving: history.length >= 2
      ? history[history.length - 1].timeSeconds < history[0].timeSeconds : null,
  };
}

/* Is volume progressing safely? */
export function trainingVolume({ activities, log, plan, todayISO }) {
  const weeks = runVolumeModel({ activities, log, plan, todayISO });
  const signals = runDurabilitySignals({ activities, log, plan, todayISO });
  const complete = weeks.slice(0, -1).filter(w => w.minutes > 0);
  return {
    weeks,                                  // the eight-week chart §2 asks for
    signals,
    frequency: complete.length ? Math.round(complete.reduce((t, w) => t + w.runs, 0) / complete.length * 10) / 10 : null,
    indoorShare: (() => {
      const tot = complete.reduce((t, w) => t + w.minutes, 0);
      return tot ? Math.round(complete.reduce((t, w) => t + w.indoorMin, 0) / tot * 100) / 100 : null;
    })(),
    longShare: complete.length ? Math.round(complete.reduce((t, w) => t + (w.longShare || 0), 0) / complete.length * 100) / 100 : null,
  };
}

/* What quality work has actually happened, and did it land? */
export function qualityProgression({ reviews, plan, todayISO }) {
  const rv = (reviews || []).filter(r => r && r.discipline === 'run');
  const byType = {};
  RUN_QUALITY_TYPES.forEach(t => {
    const hits = rv.filter(r => r.type === t);
    byType[t] = {
      sessions: hits.length,
      completed: hits.filter(r => r.completion != null && r.completion >= 0.9).length,
      // Fade and adherence only where they were actually measurable: a hill
      // session contributes neither, and averaging around that would invent
      // a trend out of the sessions that happen to be flat.
      fade: (() => {
        const f = hits.map(r => r.intervalFadePercent).filter(x => x != null);
        return f.length ? Math.round(f.reduce((a, b) => a + b, 0) / f.length * 10) / 10 : null;
      })(),
    };
  });
  const upcoming = (plan && plan.weeks ? plan.weeks : []).flatMap(w => w.workouts || [])
    .filter(w => w.discipline === 'run' && w.type === 'Race Pace' && !w.race && (!todayISO || w.date >= todayISO));
  return { byType, racePaceUpcoming: upcoming.length };
}

/* Is my long run keeping pace with the race? */
export function durability({ plan, longs, fuelLogs, todayISO }) {
  const built = longs || (plan && plan.weeks ? plan.weeks : [])
    .flatMap(w => w.workouts || []).filter(w => w.discipline === 'run' && w.type === 'Long');
  const done = todayISO ? built.filter(w => w.date <= todayISO) : built;
  const mix = longRunMix(done);
  const longest = done.reduce((m, w) => Math.max(m, w.durationMin || 0), 0);
  return {
    longestMin: longest || null,
    mix,
    // A trend, not a chart: is the long run still growing?
    trend: done.length >= 3
      ? (done[done.length - 1].durationMin || 0) - (done[0].durationMin || 0) : null,
    fuelledLongs: (fuelLogs || []).filter(f => f && f.level && f.level !== 'none').length,
  };
}

/* What is limiting me, and what is Try changing next? (§1, §2, §6)
 *
 * The limiter is chosen from readiness gaps, in the order the components are
 * listed, so an 'at-risk' component always outranks a 'building' one and the
 * answer is stable rather than whichever check ran last. The response names
 * its evidence, because a recommendation an athlete cannot audit is an
 * instruction, not coaching.
 */
/* The stored per-session run reviews, newest first — ONE derivation, used
   by the dashboard component and by the cross-discipline arbitration, so
   the two can never disagree about what the evidence is. */
export function runStoredReviews(plan, log, moves) {
  // !w.bRace: reviews persisted for tune-up races before run-review gated
  // them (2026-07-30) still live in stored entries — the persistence layer
  // never deletes (a null computation must not clear a stored review), so
  // the stale ones are filtered at this shared derivation and age out with
  // their plan.
  return (plan.weeks || []).flatMap(w => w.workouts || [])
    // bRace excluded: runReview no longer computes for tune-ups, but a
    // review persisted BEFORE that gate can never be diffed away
    // (reviewChanges skips nulls) — without this filter a stale "73%
    // completed" from a raced 5k drags the consistency read forever
    // (gauntlet catch 2026-07-30).
    .filter(w => w.discipline === 'run' && !w.bRace && log[w.id] && log[w.id].runReview)
    .map(w => ({ ...log[w.id].runReview, date: (log[w.id].at || '').slice(0, 10) || (moves && moves[w.id]) || w.date }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function nextAction({ profile, reviews, plan, longs, volume, signals, fuelLogs, raceKey }) {
  const readiness = runReadiness({ profile, reviews, longs, volume, signals, fuelLogs, raceKey });
  const gaps = runReadinessGaps(readiness);
  const atRisk = gaps.filter(g => g.state === 'at-risk');
  const limiter = atRisk[0] || gaps[0] || null;
  const evidence = runReviewEvidence(reviews);
  return {
    readiness,
    limiter: limiter ? { component: limiter.component, state: limiter.state, why: limiter.why } : null,
    /* THE PLAN RESPONSE. Only ever what several sessions agree on: a single
       run cannot retarget anything, and this surface must not be the place
       that quietly lets one. Null means "nothing is changing", which is a
       real and common answer. */
    response: evidence
      ? { action: evidence.outcome, because: evidence.sessions + ' recent sessions agree', direction: evidence.direction, since: evidence.latest }
      : null,
    nextBenchmark: runAnchor(profile).kind === 'real' ? null : 'A 5 km test would unlock race projections and exact race-pace targets.',
  };
}

/* The whole dashboard. Every section is independently null-safe, because an
   athlete opening this on day one has no activities, no reviews and no
   history, and the correct behaviour then is empty sections rather than a
   crash or a fabricated zero. */
export function runDashboard({ profile, plan, activities, log, reviews, fuelLogs, todayISO, raceKey }) {
  const volume = trainingVolume({ activities, log, plan, todayISO });
  return {
    discipline: 'run',
    currentPerformance: currentPerformance(profile),
    trainingVolume: volume,
    qualityProgression: qualityProgression({ reviews, plan, todayISO }),
    durability: durability({ plan, fuelLogs, todayISO }),
    nextAction: nextAction({
      profile, reviews, plan, volume: volume.weeks, signals: volume.signals,
      fuelLogs, raceKey: raceKey || (plan && plan.race),
      longs: (plan && plan.weeks ? plan.weeks : []).flatMap(w => w.workouts || [])
        .filter(w => w.discipline === 'run' && w.type === 'Long'),
    }),
  };
}
