import { describe, it, expect } from 'vitest';
import { iso, addDays } from './date.js';
import { generatePlan } from './plan.js';
import { prescribedSwim, cssRetestRecommendation } from './css-retest.js';
import {
  plannedSwimReps, matchSwimIntervals, swimReview, swimReviewEvidence, swimReviewVerdict,
  REVIEW_RULES, EVIDENCE_RULES,
} from './swim-review.js';
import { reviewActivity } from './review.js';

/* Phase 4: the swim review engine. Everything is a pure function, so every
   coaching outcome here is pinned against synthesized laps whose paces are
   controlled exactly — deterministic and testable is an acceptance
   criterion, not an aspiration. */

const base = {
  name: 'W', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 320, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
};
const plan = generatePlan(base);
const swims = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline === 'swim' && !w.test);
const ofType = t => swims.find(w => w.type === t);
const css = ofType('CSS Intervals');
const technique = ofType('Technique');

// laps swum exactly at each planned rep's target, scaled per-rep by factor(i, n)
const lapsFor = (w, factor = () => 1) => {
  const reps = plannedSwimReps(w, plan.paces);
  return reps.map((r, i) => ({
    type: 'WORK', distance: r.repM, startTimeSec: i * 600,
    movingTimeSec: r.targetSec * (r.repM / 100) * factor(i, reps.length),
  }));
};
const activityFor2 = w => {
  const p = prescribedSwim(w);
  return { id: 'a', distance: p.distM, movingTimeSec: p.sec };
};

describe('matchSwimIntervals (§2)', () => {
  it('an exact recording of the planned set matches with high confidence', () => {
    const m = matchSwimIntervals({ workout: css, intervals: lapsFor(css), paces: plan.paces });
    expect(m.confidence).toBe('high');
    expect(m.pairs.length).toBe(plannedSwimReps(css, plan.paces).length);
  });
  it('one missing lap drops to medium; rubbish drops to low; nothing recorded is low', () => {
    const laps = lapsFor(css);
    expect(matchSwimIntervals({ workout: css, intervals: laps.slice(0, -1), paces: plan.paces }).confidence).toBe('medium');
    const rubbish = laps.map(l => ({ ...l, distance: l.distance * 3 }));
    expect(matchSwimIntervals({ workout: css, intervals: rubbish, paces: plan.paces }).confidence).toBe('low');
    expect(matchSwimIntervals({ workout: css, intervals: [], paces: plan.paces }).confidence).toBe('low');
  });
  it('pairs in order and never re-matches backwards', () => {
    const laps = lapsFor(css);
    const m = matchSwimIntervals({ workout: css, intervals: laps, paces: plan.paces });
    const starts = m.pairs.map(p => p.lap.startTimeSec);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('swimReview outcomes (§3, §4)', () => {
  const review = (w, laps, extra = {}) =>
    swimReview({ workout: w, activity: activityFor2(w), intervals: laps, paces: plan.paces, ...extra });

  it('all reps on target, completed, feeling right: progress', () => {
    const r = review(css, lapsFor(css));
    expect(r.outcome).toBe('progress');
    expect(r.confidence).toBe('high');
    expect(r.completion).toBeGreaterThanOrEqual(REVIEW_RULES.completionFull);
    expect(Math.abs(r.paceAdherence)).toBeLessThanOrEqual(1);
  });

  it('a material fade in the final reps: repeat, and the text says so', () => {
    const n = plannedSwimReps(css, plan.paces).length;
    const tail = Math.max(1, Math.round(n * 0.25));
    const r = review(css, lapsFor(css, i => (i >= n - tail ? 1.045 : 1)));
    expect(r.fadePercent).toBeGreaterThan(REVIEW_RULES.fadeSoftPct);
    expect(r.outcome).toBe('repeat');
    expect(r.text).toContain('slowed by');
  });

  it('two failed reps or a hard fade: reduce', () => {
    const r = review(css, lapsFor(css, i => (i < 2 ? 1.07 : 1)));
    expect(r.failedReps).toBeGreaterThanOrEqual(2);
    expect(r.outcome).toBe('reduce');
  });

  it('an unmatchable recording: insufficient-data, and no pace facts are invented', () => {
    const junk = [{ type: 'WORK', distance: 5000, movingTimeSec: 4000, startTimeSec: 0 }];
    const r = review(css, junk);
    expect(r.outcome).toBe('insufficient-data');
    expect(r.confidence).toBe('low');
    expect(r.paceAdherence).toBe(null);
  });

  it('technique sessions are never judged by pace (§3): fast or slow, completion decides', () => {
    expect(technique).toBeTruthy();
    const fast = review(technique, lapsFor(technique, () => 0.85));
    expect(fast.outcome).toBe('progress'); // 15% quick changes nothing
    expect(fast.text).toContain('technique day');
    const hard = review(technique, lapsFor(technique), { feel: 'hard' });
    expect(hard.outcome).toBe('repeat'); // effort is what counts here
  });

  it('feeling hard caps an otherwise perfect quality session at repeat', () => {
    expect(review(css, lapsFor(css), { feel: 'hard' }).outcome).toBe('repeat');
  });

  it('one session never answers retest-css on its own (§5); with rolling evidence it may', () => {
    const solo = review(css, lapsFor(css, () => 0.94)); // 6% quick, no evidence
    expect(solo.outcome).not.toBe('retest-css');
    const together = review(css, lapsFor(css, () => 0.94), { evidence: { direction: 'over', sessions: 3 } });
    expect(together.outcome).toBe('retest-css');
  });

  it('a recording from the wrong pool is low confidence: cautious conclusions only', () => {
    const a = { ...activityFor2(css), poolLengthM: 50 }; // athlete setting is 25 m
    const r = swimReview({ workout: css, activity: a, intervals: lapsFor(css), paces: plan.paces });
    expect(r.confidence).toBe('low');
    expect(r.outcome).toBe('insufficient-data');
  });

  it('every review exposes a confidence level and an explanation (§6, §7)', () => {
    [lapsFor(css), [], null].forEach(laps => {
      const r = review(css, laps);
      expect(['low', 'medium', 'high']).toContain(r.confidence);
      expect(typeof r.text).toBe('string');
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.text).not.toMatch(/—/); // no em dashes in athlete copy
    });
  });

  it('is deterministic: identical inputs produce identical reviews', () => {
    const a = review(css, lapsFor(css, i => 1 + i / 1000));
    const b = review(css, lapsFor(css, i => 1 + i / 1000));
    expect(a).toEqual(b);
  });
});

describe('swimReviewEvidence (§5)', () => {
  const rv = over => ({
    type: 'CSS Intervals', completion: 1, confidence: 'high',
    paceAdherence: over ? -4 : 4, outcome: 'progress',
  });

  it('three comparable high-confidence sessions in one direction make a case', () => {
    expect(swimReviewEvidence([rv(true), rv(true), rv(true)]).direction).toBe('over');
    expect(swimReviewEvidence([rv(false), rv(false), rv(false)]).direction).toBe('under');
  });
  it('mixed direction, thin history, or low confidence make none', () => {
    expect(swimReviewEvidence([rv(true), rv(false), rv(true)])).toBe(null);
    expect(swimReviewEvidence([rv(true), rv(true)])).toBe(null);
    const low = { ...rv(true), confidence: 'medium' };
    expect(swimReviewEvidence([low, low, rv(true)])).toBe(null); // needs 2 high
  });
  it('interrupted sessions and technique days are excluded from the window', () => {
    const cut = { ...rv(true), completion: 0.6 };
    const drills = { ...rv(true), type: 'Technique' };
    expect(swimReviewEvidence([cut, rv(true), rv(true), rv(true)]).direction).toBe('over');
    expect(swimReviewEvidence([drills, rv(true), rv(true)])).toBe(null); // only 2 usable
  });
});

describe('Phase 4 review fixes: one coaching voice, and silence where nothing can be said', () => {
  // a steady-band type (the average CAN judge it) that is built continuous,
  // so the per-rep engine reads it as splits: the exact overlap where two
  // instruments judged one swim
  const steady = swims.find(w => (w.type === 'Endurance' || w.type === 'Race Pace') && !plannedSwimReps(w, plan.paces).length);
  // even overall average, hard fade in the closing quarter
  const splitLaps = w => {
    const p = prescribedSwim(w);
    return [0, 1, 2, 3].map(i => ({
      type: 'WORK', distance: p.distM / 4, startTimeSec: i * 600,
      movingTimeSec: (p.sec / 4) * (i === 3 ? 1.08 : 0.97),
    }));
  };

  it('a whole-session average verdict never renders beside a contradicting per-rep read', () => {
    expect(steady).toBeTruthy();
    const laps = splitLaps(steady);
    const act = activityFor2(steady);
    const sr = swimReview({ workout: steady, activity: act, intervals: laps, paces: plan.paces });
    expect(sr.outcome).toBe('reduce');
    const withRead = reviewActivity({ workout: steady, activity: act, paces: plan.paces, swimReview: sr });
    expect(withRead.verdicts.some(v => /On target|Averaged/.test(v.text))).toBe(false);
    expect(withRead.verdicts.some(v => /Ease the next one/.test(v.text))).toBe(true);
    expect(withRead.verdicts.filter(v => v.tone === 'good').length).toBe(0);
    // and without a per-rep read the old average verdict still speaks
    const without = reviewActivity({ workout: steady, activity: act, paces: plan.paces });
    expect(without.verdicts.some(v => /On target|Averaged/.test(v.text))).toBe(true);
  });

  it('the generic average-blurs note yields to the real read, and returns without it', () => {
    const laps = lapsFor(css);
    const act = activityFor2(css);
    const sr = swimReview({ workout: css, activity: act, intervals: laps, paces: plan.paces });
    const withRead = reviewActivity({ workout: css, activity: act, paces: plan.paces, swimReview: sr });
    expect(withRead.verdicts.some(v => /average blurs/.test(v.text))).toBe(false);
    const without = reviewActivity({ workout: css, activity: act, paces: plan.paces });
    expect(without.verdicts.some(v => /average blurs/.test(v.text))).toBe(true);
  });

  it('an insufficient-data read is not a voice: the average keeps speaking', () => {
    const junk = [{ type: 'WORK', distance: 5000, movingTimeSec: 4000, startTimeSec: 0 }];
    const act = activityFor2(steady);
    const sr = swimReview({ workout: steady, activity: act, intervals: junk, paces: plan.paces });
    expect(sr.outcome).toBe('insufficient-data');
    expect(swimReviewVerdict(sr)).toBe(null);
    const rv = reviewActivity({ workout: steady, activity: act, paces: plan.paces, swimReview: sr });
    expect(rv.verdicts.some(v => /On target|Averaged/.test(v.text))).toBe(true);
  });

  it('a fitness test is never graded as a session', () => {
    const test = plan.weeks.flatMap(w => w.workouts).find(w => w.test && w.testKind === 'swimCss');
    expect(test).toBeTruthy();
    const laps = [
      { type: 'WORK', distance: 400, movingTimeSec: 400, startTimeSec: 0 },
      { type: 'WORK', distance: 200, movingTimeSec: 190, startTimeSec: 900 },
    ];
    expect(swimReview({ workout: test, activity: { id: 'a', distance: 1400, movingTimeSec: 2700 }, intervals: laps, paces: plan.paces })).toBe(null);
  });

  it('a rep session whose planned set cannot be read is low confidence, not a continuous swim', () => {
    const laps = [0, 1, 2, 3].map(i => ({ type: 'WORK', distance: 200, movingTimeSec: 240, startTimeSec: i * 600 }));
    // a legacy stored plan: rep metadata absent from the segments
    const stripped = { ...css, segments: css.segments.map(s => { const { swim, ...rest } = s; return rest; }) };
    expect(matchSwimIntervals({ workout: stripped, intervals: laps, paces: plan.paces }).confidence).toBe('low');
    // and a missing CSS cannot turn a rep session into a splits read
    const noCss = { ...plan.paces, swim: { ...plan.paces.swim, css: null } };
    const m = matchSwimIntervals({ workout: css, intervals: laps, paces: noCss });
    expect(m.confidence).toBe('low');
    // a genuinely continuous session still reads as splits
    const cont = swims.find(w => !plannedSwimReps(w, plan.paces).length && w.type === 'Endurance');
    if (cont) expect(matchSwimIntervals({ workout: cont, intervals: laps, paces: plan.paces }).confidence).toBe('medium');
  });

  it('open water copy never judges pool pace, the way its outcome never does', () => {
    const ow = ofType('Open Water');
    if (!ow) return;
    const p = prescribedSwim(ow);
    const laps = [0, 1, 2, 3].map(i => ({ type: 'WORK', distance: Math.max(1, p.distM / 4), movingTimeSec: (p.sec / 4) * 1.3, startTimeSec: i * 600 }));
    const r = swimReview({ workout: ow, activity: { id: 'a', distance: p.distM, movingTimeSec: p.sec }, intervals: laps, paces: plan.paces });
    expect(r.text).not.toMatch(/Pace averaged/);
  });

  it('evidence carries the newest contributing date so a dismissed nudge can speak again', () => {
    const rv2 = (d, over) => ({ type: 'CSS Intervals', completion: 1, confidence: 'high', paceAdherence: over ? -4 : 4, date: d });
    const e = swimReviewEvidence([rv2('2026-07-20', true), rv2('2026-07-13', true), rv2('2026-07-06', true)]);
    expect(e.latest).toBe('2026-07-20');
    // dateless reviews (nothing stored yet) still work, just without a date
    expect(swimReviewEvidence([rv2(null, true), rv2(null, true), rv2(null, true)]).latest).toBe(null);
  });
});

describe('review evidence feeds the retest nudge (§7: outcomes feed selection)', () => {
  it('rolling over-performance evidence recommends the retest, outranking the whole-session heuristic', () => {
    // a longer runway, because retest nudges now stay silent inside the
    // final fortnight and the old today sat exactly there
    const quiet = generatePlan({ ...base, raceDate: '2026-12-20', cssMeta: { source: 'try-test', measuredAt: '2026-06-20', confidence: 'high' } });
    const tests = quiet.weeks.flatMap(w => w.workouts).filter(w => w.test && w.testKind === 'swimCss');
    const lastTest = tests.map(w => w.date).sort().pop();
    const today = iso(addDays(new Date(lastTest), 2));
    const r = cssRetestRecommendation({
      plan: quiet, todayISO: today,
      reviewEvidence: { direction: 'over', sessions: 3 },
    });
    expect(r && r.reason).toBe('perf-fast');
    const under = cssRetestRecommendation({
      plan: quiet, todayISO: today,
      reviewEvidence: { direction: 'under', sessions: 3 },
    });
    expect(under && under.reason).toBe('perf-slow');
  });
});
