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
  putWorkoutAdjustment, deleteWorkoutAdjustment,
  getWellness, putWellness, syncWellness, getIntervalsActivities, putPlannedEvents, getIntervalsThresholds,
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

/* ---------------- reconcile helpers (local overlays ⇄ server copies) ----------------
   The optimistic pushes above are skipped whenever a workout's GUID isn't known yet
   (plan push still in flight) or we're offline, so an overlay entry can exist only
   locally. These two helpers make sure such entries reach the server instead of
   being wiped by the next hydrate. */

// Fold a hydrated server overlay (log/moves/adjust) into its local counterpart:
// the server wins per workout, but a local-only entry whose workout still exists
// in the plan (present in refToId) is kept and pushed up via push(guid, entry) —
// the server never saw it. Trade-off: with no tombstones, an entry deleted on
// another device is resurrected by a device still holding it; never losing a
// log beats perfect deletion sync here.
export function mergeOverlay(server, local, refToId, push) {
  const merged = { ...(server || {}) };
  Object.keys(local || {}).forEach(id => {
    if (merged[id] === undefined && refToId[id]) { merged[id] = local[id]; push(refToId[id], local[id]); }
  });
  return merged;
}

// After a plan create/replace resolves with a fresh ref→GUID map, push the
// overlay entries the old map couldn't resolve but the new one can. There is no
// synced flag, so an entry that did sync in the meantime may be pushed again —
// an idempotent PUT, harmless.
export function sweepStale(overlay, oldMap, newMap, push) {
  Object.keys(overlay || {}).forEach(id => {
    if (!oldMap[id] && newMap[id]) push(newMap[id], overlay[id]);
  });
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
    saveAdjustment: (workoutId, adj) => fire(putWorkoutAdjustment(getToken, workoutId, adj), 'adjust ' + workoutId),
    removeAdjustment: workoutId => fire(deleteWorkoutAdjustment(getToken, workoutId), 'unadjust ' + workoutId),

    // Wellness records are keyed by date, not workout — no GUID mapping needed.
    // Returns the server's records array, or null on offline/error (keep the cache).
    loadWellness: async () => {
      const res = await getWellness(getToken);
      return res.ok && Array.isArray(res.body) ? res.body : null;
    },
    saveWellness: rec => fire(putWellness(getToken, rec), 'wellness ' + (rec && rec.date)),

    // One-time deep pull (a year) for the automatic history backfill; null on
    // any failure (offline / not connected / older backend without the window).
    backfillWellness: async (days = 365) => {
      const res = await syncWellness(getToken, days);
      return res.ok && Array.isArray(res.body) ? res.body : null;
    },

    // Recent watch activities for completed-session matching; null when not
    // connected, offline, or the backend predates the passthrough.
    loadActivities: async (days = 10) => {
      const res = await getIntervalsActivities(getToken, days);
      return res.ok && Array.isArray(res.body) ? res.body : null;
    },

    // Per-sport thresholds for the fitness watcher; null when not connected,
    // offline, or the backend predates the endpoint.
    loadThresholds: async () => {
      const res = await getIntervalsThresholds(getToken);
      return res.ok && res.body ? res.body : null;
    },

    // Workouts-to-watch: reconcile the upcoming plan onto the athlete's
    // intervals.icu calendar. Returns the {created, removed, unchanged}
    // counts, or null when not connected, offline, or on an older backend.
    pushWatchEvents: async body => {
      const res = await putPlannedEvents(getToken, body);
      if (res.ok && res.body) return res.body;
      // Surface the failure instead of a bare null: a server write must never
      // fail silently (the catalog-drift rule) — this was the last one that did.
      return { failed: true, status: res.status || 0, message: res.message || null };
    },

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
