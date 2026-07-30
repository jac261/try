import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeReviews, reviewChanges, reviewEqual, REVIEW_ENGINE_VERSIONS } from './review-persist.js';
import { generatePlan } from './plan.js';

/* Phase 1: reviews persist. The pure half (compute, diff) is unit-tested
 * here; the wiring — which value tests cannot reach, because a review that
 * is computed and dropped renders identically to one that is computed and
 * persisted — is pinned at the source, the repo's established pattern for
 * exactly this failure class (three review engines shipped with no caller
 * between them before the audits caught each one). */

const profile = {
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const plan = generatePlan(profile);
const workoutOf = disc => plan.weeks.flatMap(w => w.workouts).find(w => w.discipline === disc && !w.test);

describe('computeReviews', () => {
  it('computes for the workout discipline and only that discipline', () => {
    const ride = workoutOf('bike');
    const activity = { id: 'a1', type: 'Ride', date: ride.date, movingTimeSec: ride.durationMin * 60, distance: 30000 };
    const out = computeReviews({ workout: ride, activity, intervals: null, paces: plan.paces, profile: plan.profile, feel: 'right' });
    expect(out.bikeReview).toBeTruthy();
    expect(out.swimReview).toBeUndefined();
    expect(out.runReview).toBeUndefined();
  });

  it('a swim without interval rows yields no swim review, not a null one', () => {
    const swim = workoutOf('swim');
    const activity = { id: 'a2', type: 'Swim', date: swim.date, movingTimeSec: swim.durationMin * 60, distance: 1500 };
    const out = computeReviews({ workout: swim, activity, intervals: null, paces: plan.paces, profile: plan.profile });
    expect('swimReview' in out).toBe(false);
  });

  it('ad-hoc sessions never produce a persistable review', () => {
    // They occupy no plan slot: there is no server row to persist against.
    const adhoc = { id: 'adhoc-a9', adhoc: true, discipline: 'run', type: 'Easy', durationMin: 40, segments: [] };
    const activity = { id: 'a9', type: 'Run', movingTimeSec: 2400, distance: 8000 };
    expect(computeReviews({ workout: adhoc, activity, intervals: null, paces: plan.paces, profile: plan.profile })).toEqual({});
  });
});

describe('reviewEqual: order-insensitive, because jsonb is', () => {
  it('treats key order as irrelevant and undefined keys as absent', () => {
    // Postgres jsonb does not preserve key order, so a hydrated review would
    // compare stringify-unequal to a byte-identical recomputation and every
    // sheet open would re-PUT an unchanged snapshot.
    expect(reviewEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(reviewEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(reviewEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(reviewEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(reviewEqual(null, undefined)).toBe(true);
    expect(reviewEqual(0, null)).toBe(false);
  });
});

describe('reviewChanges', () => {
  const entry = { done: true, at: '2026-07-06T10:00:00Z', bikeReview: { outcome: 'progress', completion: 1 } };

  it('returns only fields that differ from the stored copy', () => {
    expect(reviewChanges(entry, { bikeReview: { completion: 1, outcome: 'progress' } })).toBe(null); // reordered = same
    const c = reviewChanges(entry, { bikeReview: { outcome: 'repeat', completion: 0.8 } });
    expect(c).toEqual({ bikeReview: { outcome: 'repeat', completion: 0.8 } });
  });

  it('never clears: a null or missing computation is skipped, not written', () => {
    expect(reviewChanges(entry, { bikeReview: null })).toBe(null);
    expect(reviewChanges(entry, {})).toBe(null);
  });

  it('an entry-less id persists nothing (ad-hoc, races)', () => {
    expect(reviewChanges(undefined, { bikeReview: { outcome: 'progress' } })).toBe(null);
  });

  it('a first review on a bare entry is a change', () => {
    const c = reviewChanges({ done: true }, { runReview: { outcome: 'progress' } });
    expect(c).toEqual({ runReview: { outcome: 'progress' } });
  });
});

describe('the wiring exists at the source', () => {
  const app = readFileSync('src/app/App.jsx', 'utf8');
  const sheet = readFileSync('src/components/DetailSheet.jsx', 'utf8');
  const deck = readFileSync('src/features/recap/RecapSlides.jsx', 'utf8');

  it('App passes the persistence handlers to BOTH write surfaces', () => {
    expect(app).toMatch(/onReview=\{persistReview\}[\s\S]*?<\/DetailSheet>|onReview=\{persistReview\}/);
    // both surfaces: the sheet and the recap deck
    expect((app.match(/onReview=\{persistReview\}/g) || []).length).toBe(2);
    expect(app).toMatch(/onCue=\{answerCue\}/);
    expect(app).toMatch(/cueAnswer=\{\(log\[detail\.id\] \|\| \{\}\)\.techniqueCue\}/);
  });

  it('persistReview merges locally AND syncs with the engine versions', () => {
    const body = app.slice(app.indexOf('const persistReview'), app.indexOf('const answerCue'));
    expect(body).toContain('T.reviewChanges(');
    expect(body).toContain('setLog(');
    expect(body).toContain('sync.saveReview(');
    expect(body).toContain('REVIEW_ENGINE_VERSIONS');
  });

  it('the sheet and the deck report from an effect, gated on the reps fetch settling', () => {
    [sheet, deck].forEach(src => {
      expect(src).toContain('T.computeReviews(');
      // the report waits for the lap answer, and the handler rides a ref so
      // App re-renders cannot re-fire the effect
      expect(src).toMatch(/if \(!onReviewRef\.current \|\| !repsSettled\) return;/);
      expect(src).toMatch(/setRepsSettled\(true\)/);
    });
  });

  it('the cue question is live: App supplies onCue, so it renders for Technique', () => {
    // The chips shipped 2026-07-27 gated on an onCue prop that nothing
    // passed — a question that could never be asked. Now it can.
    expect(sheet).toMatch(/onCue && w\.type === 'Technique'/);
    expect(app).toMatch(/const answerCue = \(id, cue\) => \{/);
  });

  it('engine versions cover exactly the three disciplines', () => {
    expect(Object.keys(REVIEW_ENGINE_VERSIONS).sort()).toEqual(['bikeReview', 'runReview', 'swimReview']);
  });
});

describe('bikeLoad inside bikeReview honours the estimated-FTP gate (phase 1 defect)', () => {
  /* paces carries ftp even when it is a level-table estimate (ftpEstimated
     true), and bikePowerAnchor calls any truthy ftp 'real'. The review's
     bikeLoad call passed pc.ftp through unconditionally, so the moment
     normalizedWatts arrived, IF/TSS/VI computed from a guess. The module
     gate (delivered-fields.test.js) passed throughout — it tested the
     function, not the call site. */
  const workout = {
    id: '0-0', discipline: 'bike', type: 'Endurance', durationMin: 60,
    date: '2026-07-06', segments: [{ label: 'Main', min: 60, zone: 'Z2' }],
  };
  const activity = {
    id: 'b1', type: 'Ride', date: '2026-07-06', movingTimeSec: 3600,
    distance: 30000, averageWatts: 180, normalizedWatts: 190,
  };

  it('an estimated FTP yields a review with null load fields', async () => {
    const { bikeReview } = await import('./bike-review.js');
    const rv = bikeReview({ workout, activity, intervals: null, paces: { ftp: 250, ftpEstimated: true }, feel: 'right' });
    expect(rv).toBeTruthy();
    expect(rv.intensityFactor).toBe(null);
    expect(rv.powerTss).toBe(null);
    expect(rv.normalizedPowerWatts).toBe(null);
    expect(rv.variabilityIndex).toBe(null);
  });

  it('a real FTP yields the known values from the same ride', async () => {
    const { bikeReview } = await import('./bike-review.js');
    const rv = bikeReview({ workout, activity, intervals: null, paces: { ftp: 250 }, feel: 'right' });
    expect(rv.intensityFactor).toBeCloseTo(0.76, 2);
    expect(rv.variabilityIndex).toBeCloseTo(1.06, 2);
    expect(rv.powerTss).toBeGreaterThan(0);
  });
});

describe('the no-downgrade guard (gauntlet 2026-07-30)', () => {
  const rich = { outcome: 'progress', confidence: 'medium', timeInTarget: 92, efforts: 6 };
  const repless = { outcome: 'insufficient-data', confidence: 'low', timeInTarget: null, efforts: 0 };
  const entry = { done: true, bikeReview: rich };

  it('a lower-confidence recomputation never replaces a stored review', () => {
    // The exact failing scenario: reps fetch failed or the recording aged
    // out of the intervals endpoint, so the recompute is repless and weaker.
    expect(reviewChanges(entry, { bikeReview: repless })).toBe(null);
  });

  it('equal or better confidence still writes: reviews may legitimately change', () => {
    const changed = { ...rich, outcome: 'repeat', timeInTarget: 60 };
    expect(reviewChanges(entry, { bikeReview: changed })).toEqual({ bikeReview: changed });
    const upgraded = { ...rich, confidence: 'high' };
    expect(reviewChanges(entry, { bikeReview: upgraded })).toEqual({ bikeReview: upgraded });
  });

  it('a first review is never blocked, whatever its confidence', () => {
    expect(reviewChanges({ done: true }, { bikeReview: repless })).toEqual({ bikeReview: repless });
  });
});

describe('the sync layer: ordering, re-push, and the runReview latch', () => {
  const sync = readFileSync('src/app/sync.js', 'utf8');
  const app = readFileSync('src/app/App.jsx', 'utf8');
  const api = readFileSync('src/lib/api.js', 'utf8');

  it('every log-endpoint write is serialised per workout', () => {
    // saveLog, saveReview, saveLogFull and removeLog all hit the same row
    // and the server rewrites the base four on every PUT: unserialised, a
    // stale review body could revert a feel tap, and a PUT landing after an
    // un-complete DELETE resurrected the workout on the next hydrate.
    ['saveLog:', 'saveReview:', 'saveLogFull:', 'removeLog:'].forEach(fn => {
      const at = sync.indexOf(fn);
      expect(at, fn).toBeGreaterThan(0);
      expect(sync.slice(at, at + 400)).toContain('serialLog(');
    });
  });

  it('the re-push paths carry reviews; the tap paths still never do', () => {
    // Hydrate's local-only merge and adoptMap's sweep push entries the
    // server has never seen — through logToApi they arrived bare and the
    // next server-wins hydrate erased the local reviews too.
    expect(app).toMatch(/sweepStale\(cur\.log[^\n]*saveLogFull/);
    expect(app).toMatch(/mergeOverlay\(result\.log[^\n]*saveLogFull/);
    // fullLogToApi only ever ADDS: absent fields stay omitted, never null
    expect(api).toMatch(/function fullLogToApi/);
  });

  it('fullLogToApi wraps present reviews and omits absent ones', async () => {
    const { fullLogToApi } = await import('./api.js');
    const b = fullLogToApi({ done: true, at: '2026-07-06T10:00:00Z', feel: 'hard', swimReview: { outcome: 'hold' }, techniqueCue: 'catch' }, { swimReview: 2 });
    expect(b.swimReview.review).toEqual({ outcome: 'hold' });
    expect(b.swimReview.engineVersion).toBe(2);
    expect(b.techniqueCue).toBe('catch');
    expect('bikeReview' in b).toBe(false);   // omitted = preserved, never cleared
    expect('runReview' in b).toBe(false);
    expect(b.feel).toBe('hard');
  });

  it('a runReview 400 latches the field off for the session', () => {
    expect(sync).toMatch(/runReviewUnsupported = true/);
    expect(sync).toMatch(/if \(runReviewUnsupported && f && 'runReview' in f\)/);
  });
});
