/* Backend sync orchestration. The UI updates local state + the per-user cache
   optimistically; these helpers push the change to the API in the background.
   A failed push just warns — localStorage stays the offline fallback until the
   next successful hydrate. Bind once per session with the Clerk getToken.

   Note: the log/move endpoints key on the server workout GUID, not our client ref
   ("0-0"). Every plan response carries both, so hydrate/savePlan/replacePlan return
   a `refToId` map the caller keeps and uses to resolve a ref → GUID before pushing. */
import {
  getCurrentPlan, createPlan as apiCreatePlan, replaceCurrentPlan,
  putWorkoutLog, deleteWorkoutLog, putWorkoutMove, deleteWorkoutMove,
  getWellness, putWellness, syncWellness,
  toClientState, logToApi,
} from '@/lib/api.js';

function fire(promise, what) {
  return promise
    .then(r => { if (!r || !r.ok) console.warn('[sync] ' + what + ' failed:', (r && r.message) || 'no response'); return r; })
    .catch(e => { console.warn('[sync] ' + what + ' error:', e && e.message); });
}

// The ref → workout-GUID map from a plan response, or null on failure.
function refFrom(r) {
  return r && r.ok && r.body ? (toClientState(r.body).refToId || {}) : null;
}

export function makeSync(getToken) {
  // Load the server's plan graph. Returns { plan, log, moves, refToId } | 'none'
  // (signed in, no plan) | null (offline/error → caller keeps the local cache).
  const hydrate = async () => {
    const res = await getCurrentPlan(getToken);
    if (res.ok && res.body) return toClientState(res.body);
    if (res.ok && res.body === null) return 'none';
    return null;
  };
  const replacePlan = plan => replaceCurrentPlan(getToken, plan)
    .then(r => { if (!r || !r.ok) console.warn('[sync] replace plan failed:', (r && r.message) || 'no response'); return refFrom(r); })
    .catch(e => { console.warn('[sync] replace plan error:', e && e.message); return null; });
  // Create the plan; if the server already has one (409) fall back to replacing it.
  // Resolves to the ref→GUID map (or null on failure).
  const savePlan = plan => apiCreatePlan(getToken, plan)
    .then(r => {
      if (r && r.status === 409) return replacePlan(plan);
      if (!r || !r.ok) { console.warn('[sync] create plan failed:', (r && r.message) || 'no response'); return null; }
      return refFrom(r);
    })
    .catch(e => { console.warn('[sync] create plan error:', e && e.message); return null; });

  // workoutId is the server GUID (resolve from refToId before calling).
  return {
    hydrate, savePlan, replacePlan,
    saveLog: (workoutId, entry) => fire(putWorkoutLog(getToken, workoutId, logToApi(entry)), 'log ' + workoutId),
    removeLog: workoutId => fire(deleteWorkoutLog(getToken, workoutId), 'unlog ' + workoutId),
    saveMove: (workoutId, date) => fire(putWorkoutMove(getToken, workoutId, { movedDate: date, reason: null }), 'move ' + workoutId),
    removeMove: workoutId => fire(deleteWorkoutMove(getToken, workoutId), 'unmove ' + workoutId),

    // Wellness records are keyed by date, not workout — no GUID mapping needed.
    // Returns the server's records array, or null on offline/error (keep the cache).
    loadWellness: async () => {
      const res = await getWellness(getToken);
      return res.ok && Array.isArray(res.body) ? res.body : null;
    },
    saveWellness: rec => fire(putWellness(getToken, rec), 'wellness ' + (rec && rec.date)),

    // Prefer the intervals.icu proxy: POST /api/wellness/sync pulls the athlete's
    // last ~60 days server-side and returns the refreshed list. 404 (no integration)
    // falls back to the plain GET, so manual-entry users see no difference.
    refreshWellness: async () => {
      const res = await syncWellness(getToken);
      if (res.ok && Array.isArray(res.body)) return res.body;
      const fallback = await getWellness(getToken);
      return fallback.ok && Array.isArray(fallback.body) ? fallback.body : null;
    },
  };
}
