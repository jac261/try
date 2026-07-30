import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { intervalRows } from './review.js';
import {
  RUN_REVIEW_RULES, RUN_REVIEW_PRIORITIES, RUN_OUTCOMES, RUN_EVIDENCE_RULES,
  runReview, runOutcome, repFade, runReviewEvidence,
} from './run-review.js';
import {
  RUN_FUEL_LEVEL_GRAMS, RUN_FUELLING_RULES,
  runCarbTarget, provenTolerance, runFuellingPlan, runFuellingOutcome,
} from './run-fuelling.js';
import { RUN_READINESS_COMPONENTS, RUN_READINESS_STATES, runReadiness, runReadinessGaps } from './run-readiness.js';
import { runStoredReviews } from './run-dashboard.js';

/* Run phase 8 — review, fuelling and race readiness.
 *
 * Three modules that each inherit a hazard the bike arc already paid for:
 * the inverted gut cap, readiness that reads 'ready' from missing data, and
 * a single session being allowed to retarget a plan.
 */

const base = {
  name: 'R', fivekSec: 1500, fivekMeta: { source: 'try-test' }, css100Sec: 110, ftp: 250, weightKg: 70,
  daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const rows = (n, tone) => ({ judged: n, rows: Array.from({ length: n }, () => ({ tone, paceSec: 300 })) });
const wo = (type, extra) => ({ discipline: 'run', type, durationMin: 60, segments: [{ label: 'x', min: 60, zone: 'Z4' }], ...extra });
const act = (min, date) => ({ movingTimeSec: min * 60, date: date || '2026-07-20' });

describe('the review is session specific and always states confidence', () => {
  it('every built type has priorities, and they differ by type', () => {
    ['Easy', 'Fartlek', 'Tempo', 'Threshold', 'VO2 Intervals', 'Long', 'Race Pace']
      .forEach(t => expect(RUN_REVIEW_PRIORITIES[t], t + ' has no priorities').toBeTruthy());
    expect(RUN_REVIEW_PRIORITIES.Easy).not.toEqual(RUN_REVIEW_PRIORITIES.Threshold);
    // the Long's priorities cover what §2 asks of it
    expect(RUN_REVIEW_PRIORITIES.Long).toContain('fuelling');
    expect(RUN_REVIEW_PRIORITIES.Long).toContain('late-stability');
  });

  it('names its discipline so it cannot be mistaken for a swim or bike review', () => {
    // The bike arc shipped a swim CSS retest card under a bike heading
    // because two modules returned structurally identical objects.
    const r = runReview({ workout: wo('Threshold'), activity: act(60), rows: rows(4, 'good'), profile: base });
    expect(r.discipline).toBe('run');
    expect(r.type).toBe('Threshold');
  });

  it('every verdict exposes a confidence, and it is never invented', () => {
    const r = runReview({ workout: wo('Threshold'), activity: act(60), rows: rows(4, 'good'), profile: base });
    expect(['low', 'medium', 'high']).toContain(r.confidence);
    // no activity at all: nothing is known, and it says so
    const none = runReview({ workout: wo('Threshold'), activity: null, rows: null, profile: base });
    expect(none.confidence).toBe('low');
    expect(none.outcome).toBe('insufficient-data');
  });

  it('a hill session is terrain adjusted and never pace graded', () => {
    const hill = wo('Threshold', { segments: [{ label: 'climbs', min: 60, zone: 'Z4', terrain: 'hill' }] });
    const r = runReview({ workout: hill, activity: act(60), rows: rows(4, 'warn'), profile: base });
    expect(r.terrainAdjusted).toBe(true);
    expect(r.paceAdherence).toBe(null);   // there is no flat-pace truth to use
    expect(r.confidence).toBe('low');     // and the reading is weaker for it
  });

  it('an estimated anchor lowers confidence rather than being ignored', () => {
    const est = { ...base, fivekSec: null, fivekMeta: null };
    const r = runReview({ workout: wo('Threshold'), activity: act(60), rows: rows(4, 'good'), profile: est });
    expect(r.confidence).toBe('medium');
    const real = runReview({ workout: wo('Threshold'), activity: act(60), rows: rows(4, 'good'), profile: base });
    expect(real.confidence).toBe('high');
  });

  it('fade needs enough reps to split, and reads late against early', () => {
    expect(repFade([{ paceSec: 300 }, { paceSec: 310 }])).toBe(null); // two reps is not a split
    const faded = [{ paceSec: 300 }, { paceSec: 300 }, { paceSec: 330 }, { paceSec: 330 }];
    expect(repFade(faded)).toBeCloseTo(10, 0);
    const steady = [{ paceSec: 300 }, { paceSec: 300 }, { paceSec: 300 }, { paceSec: 300 }];
    expect(repFade(steady)).toBe(0);
  });

  it('outcomes are from the closed set, and a short session reduces', () => {
    RUN_OUTCOMES.forEach(o => expect(typeof o).toBe('string'));
    expect(runOutcome({ completion: 0.4, confidence: 'high' })).toBe('reduce');
    expect(runOutcome({ completion: 0.75, confidence: 'high' })).toBe('repeat');
    expect(runOutcome({ completion: 1, paceAdherence: 0, confidence: 'high' })).toBe('progress');
    expect(runOutcome({ completion: 1, paceAdherence: 50, confidence: 'high' })).toBe('repeat');
    expect(runOutcome({ completion: 1, fade: 12, confidence: 'high' })).toBe('repeat');
    expect(runOutcome({ completion: 1, confidence: 'low' })).toBe('insufficient-data');
  });
});

describe('a tune-up race is never graded as a workout', () => {
  it('runReview refuses a bRace slot: a race is not workout execution', () => {
    const tune = { discipline: 'run', type: 'RACE', bRace: true, durationMin: 30, segments: [] };
    // a 20-minute 5k against the 30-minute calendar slot must not become
    // low confidence "too little of it happened"
    expect(runReview({ workout: tune, activity: act(20), rows: null, profile: base })).toBe(null);
  });

  it('stale tune-up reviews persisted before the gate never reach the dashboard', () => {
    // the persistence layer never deletes (a null must not clear a stored
    // review), so the shared derivation filters them out instead
    const plan = { weeks: [{ workouts: [
      { id: 'a', date: '2026-07-01', discipline: 'run', type: 'Threshold' },
      { id: 'b', date: '2026-07-03', discipline: 'run', type: 'RACE', bRace: true },
    ] }] };
    const log = {
      a: { done: true, runReview: { discipline: 'run', type: 'Threshold', confidence: 'high' } },
      b: { done: true, runReview: { discipline: 'run', type: 'RACE', confidence: 'low' } },
    };
    expect(runStoredReviews(plan, log, {}).map(r => r.type)).toEqual(['Threshold']);
  });
});

describe('one run cannot retarget the plan', () => {
  const good = n => Array.from({ length: n }, (_, i) => ({
    discipline: 'run', type: 'Threshold', completion: 1, paceAdherence: 0,
    confidence: 'high', terrainAdjusted: false, date: '2026-07-0' + (i + 1),
  }));

  it('retest-5k is unreachable from a single review', () => {
    // The most consequential thing a review can propose needs a pattern.
    const single = runReview({ workout: wo('Threshold'), activity: act(60), rows: rows(6, 'good'), profile: base });
    expect(single.outcome).not.toBe('retest-5k');
    expect(runReviewEvidence([single])).toBe(null);
  });

  it('needs a full window of high-confidence sessions agreeing', () => {
    expect(runReviewEvidence(good(2))).toBe(null);                       // too few
    expect(runReviewEvidence(good(3)).outcome).toBe('retest-5k');        // enough
    // low confidence does not count toward the window
    const weak = good(3).map(r => ({ ...r, confidence: 'low' }));
    expect(runReviewEvidence(weak)).toBe(null);
    // nor do hill sessions, which carry no flat-pace truth
    const hills = good(3).map(r => ({ ...r, terrainAdjusted: true }));
    expect(runReviewEvidence(hills)).toBe(null);
  });

  it('requires a consistent direction, not an average', () => {
    const mixed = good(3);
    mixed[1].paceAdherence = 40;   // one session badly off
    expect(runReviewEvidence(mixed)).toBe(null);
  });

  it('the struggling arm can actually fire', () => {
    /* It could not. The threshold was read from RUN_EVIDENCE_RULES, which
       has no adherenceLoose, so the comparison ran against undefined and the
       branch was dead. A guard that cannot fire is a comment with a number
       in it. */
    const hard = good(3).map(r => ({ ...r, paceAdherence: 50 }));
    const ev = runReviewEvidence(hard);
    expect(ev).toBeTruthy();
    expect(ev.direction).toBe('struggling');
    expect(ev.outcome).toBe('reduce');
  });
});

describe('fuelling', () => {
  it('does not prescribe for a run short enough not to need it', () => {
    expect(runCarbTarget(45)).toBe(0);
    expect(runFuellingPlan({ workout: { discipline: 'run', durationMin: 45 }, profile: {} })).toBe(null);
    expect(runCarbTarget(120)).toBeGreaterThan(0);
  });

  it('rises smoothly with duration rather than in steps', () => {
    // Bands with hard edges meant a routine trim could cut fuelling by a
    // third for a six per cent cut in volume.
    const a = runCarbTarget(100), b = runCarbTarget(105), c = runCarbTarget(110);
    expect(b - a).toBeLessThanOrEqual(10);
    expect(c - b).toBeLessThanOrEqual(10);
    expect(c).toBeGreaterThanOrEqual(a);
  });

  it('THE ORDERING: no history is the most conservative case, never the most generous', () => {
    /* The exact inversion the bike shipped: with no history the cap was
       disabled, so a first-timer got the largest dose in the system while an
       athlete who had proven 45 g/h was held below them. Asserted as an
       ORDERING so it cannot come back in a different arithmetic. */
    const long = { discipline: 'run', durationMin: 180 };
    const novice = runFuellingPlan({ workout: long, profile: {}, fuelLog: [] });
    const proven45 = runFuellingPlan({ workout: long, profile: {}, fuelLog: [{ level: 'solid' }] });
    const provenRace = runFuellingPlan({ workout: long, profile: {}, fuelLog: [{ level: 'race' }] });
    expect(novice.carbPerHour).toBeLessThan(proven45.carbPerHour);
    expect(proven45.carbPerHour).toBeLessThanOrEqual(provenRace.carbPerHour);
    expect(novice.carbPerHour).toBe(RUN_FUELLING_RULES.novicePerHour);
    expect(novice.cappedBy).toBe('no-history');
  });

  it('never prescribes above the top of the scale the athlete can answer on', () => {
    // Prescribing beyond the highest answer the UI offers marks an athlete
    // short no matter what they actually took.
    const ceiling = Math.max(...Object.values(RUN_FUEL_LEVEL_GRAMS));
    expect(RUN_FUELLING_RULES.ceilingGrams).toBe(ceiling);
    for (const min of [80, 120, 180, 300, 600]) {
      const p = runFuellingPlan({ workout: { discipline: 'run', durationMin: min }, profile: {}, fuelLog: [{ level: 'race' }] });
      expect(p.carbPerHour, min + ' min').toBeLessThanOrEqual(RUN_FUELLING_RULES.ceilingGrams);
    }
  });

  it('a gut upset does not count as proven tolerance', () => {
    expect(provenTolerance([{ level: 'race', gutUpset: true }])).toBe(null);
    expect(provenTolerance([{ level: 'solid' }, { level: 'race', gutUpset: true }])).toBe(RUN_FUEL_LEVEL_GRAMS.solid);
    expect(provenTolerance([])).toBe(null);
  });

  it('sodium appears only when the athlete has configured it', () => {
    const long = { discipline: 'run', durationMin: 150 };
    expect(runFuellingPlan({ workout: long, profile: {} }).sodiumMgPerHour).toBe(null);
    expect(runFuellingPlan({ workout: long, profile: { sweatSodium: true } }).sodiumMgPerHour).toBeTruthy();
  });

  it('compares planned against consumed without judging the athlete', () => {
    const plan = runFuellingPlan({ workout: { discipline: 'run', durationMin: 180 }, profile: {}, fuelLog: [{ level: 'race' }] });
    expect(runFuellingOutcome({ plan, level: 'none' }).status).toBe('short');
    expect(runFuellingOutcome({ plan, level: 'race' }).status).toBe('on-plan');
    expect(runFuellingOutcome({ plan, level: 'race', gutUpset: true }).status).toBe('gut-limited');
    expect(runFuellingOutcome({ plan, level: undefined }).status).toBe('unlogged');
  });
});

describe('race readiness is components, never a score', () => {
  const plan = generatePlan({ ...base, raceType: 'runmarathon', fitness: 'intermediate' });
  const longs = plan.weeks.flatMap(w => w.workouts).filter(x => x.type === 'Long');

  it('exposes no score, ratio or index anywhere on its surface', async () => {
    // Asserted on the MODULE SURFACE so a score added later fails here rather
    // than slipping past a per-component check.
    const mod = await import('./run-readiness.js');
    Object.keys(mod).forEach(k =>
      expect(/score|index|percent|rating/i.test(k), k + ' looks like a score').toBe(false));
    const r = runReadiness({ profile: base, raceKey: 'runmarathon', longs });
    Object.values(r).forEach(v => {
      if (v && v.state) expect(RUN_READINESS_STATES).toContain(v.state);
    });
  });

  it('covers every component §5 lists', () => {
    const r = runReadiness({ profile: base, raceKey: 'runmarathon', longs });
    RUN_READINESS_COMPONENTS.forEach(k => expect(r[k], k + ' missing').toBeTruthy());
    expect(RUN_READINESS_COMPONENTS.length).toBe(8);
  });

  it('an athlete with no data reads UNKNOWN, never ready', () => {
    /* The bike's version read 'ready' from a missing FTP because the else arm
       claimed a fact it had never checked — and since no reviews were stored
       yet, that was every athlete. */
    const r = runReadiness({ profile: base, raceKey: 'runmarathon' });
    RUN_READINESS_COMPONENTS.forEach(k =>
      expect(r[k].state, k + ' claimed a state with no evidence').toBe('unknown'));
    expect(r.anchor).toBe('real');
  });

  it('every component explains itself', () => {
    const r = runReadiness({ profile: base, raceKey: 'runmarathon', longs });
    RUN_READINESS_COMPONENTS.forEach(k => {
      expect(typeof r[k].why, k + ' has no explanation').toBe('string');
      expect(r[k].why.length).toBeGreaterThan(0);
    });
  });

  it('a flagged load signal makes load stability at-risk, quoting the caution', () => {
    const r = runReadiness({
      profile: base, raceKey: 'runmarathon', longs,
      volume: [{ minutes: 200 }, { minutes: 210 }],
      signals: [{ key: 'frequency-jump', caution: 'You are running more often than usual this week.' }],
    });
    expect(r.loadStability.state).toBe('at-risk');
    expect(r.loadStability.why).toContain('more often');
  });

  it('gaps name the weak components rather than summarising them away', () => {
    const r = runReadiness({
      profile: base, raceKey: 'runmarathon', longs,
      volume: [{ minutes: 200 }, { minutes: 210 }],
      signals: [{ key: 'x', caution: 'ramping' }],
    });
    const gaps = runReadinessGaps(r);
    expect(gaps.length).toBeGreaterThan(0);
    gaps.forEach(g => {
      expect(RUN_READINESS_COMPONENTS).toContain(g.component);
      expect(g.why).toBeTruthy();
    });
    expect(runReadinessGaps(null)).toEqual([]);
  });

  it('race-pace and fuelling are not limiters at 5k and 10k', () => {
    const r = runReadiness({ profile: base, raceKey: 'run5k', longs });
    expect(r.racePaceExecution.state).toBe('unknown');
    expect(r.racePaceExecution.why).toMatch(/does not prescribe/);
    expect(r.fuelling.why).toMatch(/not a limiter/);
  });
});

describe('the review reads the same grading the card shows', () => {
  it('takes intervalRows output rather than re-deriving a second opinion', () => {
    // One grader. A review disagreeing with the splits table printed directly
    // above it is the failure this arrangement exists to prevent.
    const workout = { discipline: 'run', type: 'Threshold', durationMin: 50, segments: [{ label: '4 × 4 min', min: 28, zone: 'Z4' }] };
    const paces = { run: { threshold: 240 } };
    const intervals = Array.from({ length: 4 }, () => ({ type: 'WORK', movingTimeSec: 240, distance: 1000, averageSpeed: 1000 / 240 }));
    const graded = intervalRows({ workout, intervals, paces });
    const r = runReview({ workout, activity: act(50), rows: graded, profile: base });
    expect(graded.judged).toBe(4);
    expect(r.paceAdherence).toBe(0);      // every rep on target
    expect(r.outcome).toBe('progress');
  });
});

describe('the barrel exports all three modules', () => {
  it('run-review, run-fuelling and run-readiness are reachable', async () => {
    const barrel = await import('./index.js');
    ['runReview', 'runReviewEvidence', 'RUN_REVIEW_RULES', 'RUN_EVIDENCE_RULES',
      'runFuellingPlan', 'runFuellingOutcome', 'RUN_FUELLING_RULES',
      'runReadiness', 'runReadinessGaps', 'RUN_READINESS_COMPONENTS']
      .forEach(k => expect(barrel[k], k + ' missing from the barrel').toBeTruthy());
  });
});
