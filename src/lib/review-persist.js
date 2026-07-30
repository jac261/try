import { swimReview } from './swim-review.js';
import { bikeReview } from './bike-review.js';
import { runReview } from './run-review.js';
import { intervalRows } from './review.js';

/* Review persistence (phase 1, 2026-07-30). Reviews used to be computed on
   every sheet or recap open and discarded; the backend has stored them as
   opaque jsonb since 30 July, and every dashboard already reads
   log[id].<x>Review — they were just permanently empty. This module is the
   pure half of the write path: compute, diff against what is stored, and
   hand the app only what actually changed.

   The engine versions ride the wire envelope (api.js reviewToApi) so a
   future review engine can refuse to merge snapshots it did not write.
   Recorded now, enforced later — nothing incompatible can exist yet. Bump a
   version when a review's FIELDS change meaning, not when copy changes. */
export const REVIEW_ENGINE_VERSIONS = { swimReview: 1, bikeReview: 1, runReview: 1 };

/* One computation for both write surfaces — the workout sheet and the recap
   deck — mirroring the sheet's shipped conditions exactly: swim needs the
   interval rows (no laps, no per-rep read), bike and run speak from the
   activity alone when they must. Ad-hoc sessions are excluded: they occupy
   no plan slot, so there is no server row to persist against. */
export function computeReviews({ workout, activity, intervals, paces, profile, feel }) {
  if (!workout || !activity || workout.adhoc) return {};
  const out = {};
  if (workout.discipline === 'swim' && intervals) {
    const r = swimReview({ workout, activity, intervals, paces, feel });
    if (r) out.swimReview = r;
  }
  if (workout.discipline === 'bike') {
    const r = bikeReview({ workout, activity, intervals, paces, feel });
    if (r) out.bikeReview = r;
  }
  if (workout.discipline === 'run') {
    const rows = intervalRows({ workout, intervals, paces, activity });
    const r = runReview({ workout, activity, rows, profile, feel });
    if (r) out.runReview = r;
  }
  return out;
}

/* Order-insensitive deep equality. NOT JSON.stringify: Postgres jsonb does
   not preserve key order, so a hydrated review compares stringify-unequal
   to a byte-identical recomputation and every sheet open would re-PUT an
   unchanged snapshot. */
export function reviewEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => reviewEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    // undefined-valued keys are absent keys: {x: undefined} equals {}
    const ka = Object.keys(a).filter(k => a[k] !== undefined);
    const kb = Object.keys(b).filter(k => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every(k => reviewEqual(a[k], b[k]));
  }
  return false;
}

/* The fields worth writing: computed, non-null, different from what the
   entry already stores, and never WEAKER than it. Null and undefined
   computations are SKIPPED, never written — a review that cannot be
   computed right now (reps still loading, activity briefly unmatched) must
   not clear a stored one. Returns null when there is nothing to do, so
   reopening a sheet is free.

   The no-downgrade guard (gauntlet catch 2026-07-30): bike and run compute
   a review from the activity alone when the lap fetch has not resolved or
   the recording has aged out of the intervals endpoint, and that repless
   review is non-null — so the null-skip alone let a low-confidence
   whole-ride read overwrite a stored per-effort one. A recomputation may
   REPLACE a stored review only at equal or better confidence; the write
   surfaces additionally hold their report until the lap fetch settles, so
   this guard is the backstop for the fetch that never resolves. The cost is
   accepted and named: a legitimately corrected review that drops confidence
   will not overwrite until the stored one ages out with its plan. */
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
export function reviewChanges(entry, fields) {
  if (!entry) return null;
  const out = {};
  ['swimReview', 'bikeReview', 'runReview'].forEach(f => {
    const next = fields && fields[f];
    if (!next) return;
    if (reviewEqual(entry[f], next)) return;
    const prev = entry[f];
    if (prev && CONFIDENCE_RANK[next.confidence] != null && CONFIDENCE_RANK[prev.confidence] != null
      && CONFIDENCE_RANK[next.confidence] < CONFIDENCE_RANK[prev.confidence]) return;
    out[f] = next;
  });
  return Object.keys(out).length ? out : null;
}
