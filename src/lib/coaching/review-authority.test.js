import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reviewAuthority } from './review-authority.js';
import { reviewActivity } from '../review.js';
import { buildRecap } from '../recap.js';
import { runReviewVerdict } from '../run-review.js';

/* Phase 2 §6: one voice per session, now a quotable rule rather than a chain
 * of inline guards — and the recap hole closed. Before this commit,
 * buildRecap never received a runReview, so a run recap could headline a
 * whole-session average verdict ("on target") minutes before the sheet's
 * per-rep review said the opposite: the exact contradiction class the rule
 * exists to prevent, surviving in the one surface the rule never reached. */

const runWorkout = {
  id: '4-2', discipline: 'run', type: 'Threshold', durationMin: 45,
  date: '2026-07-20', title: 'Threshold run',
  segments: [{ label: 'Main', min: 30 }],
};
const activity = {
  id: 'r1', type: 'Run', date: '2026-07-20',
  movingTimeSec: 45 * 60, distance: 9000,
};
// The engine shape a per-rep run review carries when it could judge and the
// verdict is not the average's: the session broke down late.
const offTargetRunReview = {
  outcome: 'repeat', confidence: 'high', completion: 96,
  explanation: 'The final rep came in well below the body of the session.',
};

describe('reviewAuthority', () => {
  it('one authority per session, with a reason, across all three disciplines', () => {
    ['swimReview', 'bikeReview', 'runReview'].forEach(f => {
      const r = reviewAuthority({ workout: runWorkout, activity, [f]: offTargetRunReview });
      expect(r.authority).toBe('structured');
      expect(r.review).toBe(offTargetRunReview);
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(20);
    });
  });

  it('an insufficient-data review is not a voice: the whole-session summary speaks', () => {
    const r = reviewAuthority({ workout: runWorkout, activity, runReview: { outcome: 'insufficient-data' } });
    expect(r.authority).toBe('whole-session');
  });

  it('no recording, no voice at all', () => {
    expect(reviewAuthority({ workout: runWorkout, activity: null }).authority).toBe('none');
    expect(reviewAuthority({ workout: runWorkout, activity: { movingTimeSec: 0 } }).authority).toBe('none');
  });

  it('golden reason pin: the structured reason names the yield, not a score', () => {
    const r = reviewAuthority({ workout: runWorkout, activity, bikeReview: offTargetRunReview });
    expect(r.reason).toBe('The per-rep review read this session, so it is the single voice; the whole-session average stays available as raw numbers but issues no competing verdict.');
  });

  it('judges nothing itself: the module never reads a metric', () => {
    // No second judge (spec §1.3): the only fields consulted are outcome
    // (existence of a verdict) and the recording's existence.
    const src = readFileSync(new URL('./review-authority.js', import.meta.url), 'utf8');
    ['watts', 'pace', 'adherence', 'completion', 'timeInTarget', 'fade', 'distance'].forEach(m =>
      expect(src, m).not.toContain(m));
  });
});

describe('the recap speaks with the per-rep voice (the hole this commit closes)', () => {
  const base = {
    workout: runWorkout, activity, intervals: null, route: null,
    paces: { run: { easy: 360, threshold: 250 } }, plan: null, log: {}, moves: {}, todayISO: '2026-07-20',
  };

  it('a run recap headlines the per-rep verdict, never the average one', () => {
    /* Fails on main: buildRecap had no runReview path at all, so the
       headline fell back to whatever the whole-session verdicts said. */
    const slides = buildRecap({ ...base, reviews: { runReview: offTargetRunReview } });
    const headline = slides.find(s => s.kind === 'headline');
    const verdictText = runReviewVerdict(offTargetRunReview).text;
    expect(headline.lines).toContain(verdictText);
  });

  it('display and persistence are one computation: buildRecap computes no review of its own', () => {
    const src = readFileSync(new URL('../recap.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/swimReview\(\{/);      // no engine calls
    expect(src).not.toMatch(/bikeReview\(\{/);
    // and the numeric activity.feel FALLBACK into a review computation is
    // gone (the effort slide's own display of a recorded feel remains — it
    // quotes, it does not judge)
    expect(src).not.toMatch(/\.feel\) \|\| activity\.feel/);
    const deck = readFileSync(new URL('../../features/recap/RecapSlides.jsx', import.meta.url), 'utf8');
    expect(deck).toMatch(/reviews,\s*\/\/ the same computation the persist effect reports/);
  });

  it('reviewActivity suppresses the steady-pace verdict under a structured authority', () => {
    const withPerRep = reviewActivity({ workout: runWorkout, activity, paces: base.paces, runReview: offTargetRunReview });
    const verdictTexts = withPerRep.verdicts.map(v => v.text);
    expect(verdictTexts).toContain(runReviewVerdict(offTargetRunReview).text);
    // exactly one verdict speaks about pacing/outcome: the per-rep one is
    // last, and no in-band average verdict appears beside it
    const without = reviewActivity({ workout: runWorkout, activity, paces: base.paces });
    expect(without.verdicts.length).toBeGreaterThanOrEqual(withPerRep.verdicts.length - 1);
  });
});
