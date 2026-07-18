/* Backend sync orchestration. The UI updates local state + the per-user cache
   optimistically; these helpers push the change to the API in the background.
   A failed push just warns — localStorage stays the offline fallback until the
   next successful hydrate. Bind once per session with the Clerk getToken.

   Note: the log/move endpoints key on the server workout GUID, not our client ref
   ("0-0"). Every plan response carries both, so hydrate/savePlan/replacePlan return
   a `refToId` map the caller keeps and uses to resolve a ref → GUID before pushing. */
import {
  getCurrentPlan, createPlan as apiCreatePlan, replaceCurrentPlan, deletePlan, putProfile, getMe,
  putWorkoutLog, deleteWorkoutLog, putWorkoutMove, deleteWorkoutMove,
  putWorkoutAdjustment, deleteWorkoutAdjustment,
  getWellness, putWellness, syncWellness, getIntervalsActivities, putPlannedEvents, getIntervalsThresholds, getIntervalsActivityIntervals, getIntervalsActivityRoute,
  toClientState, logToApi,
} from '@/lib/api.js';

function fire(promise, what) {
  return promise
    .then(r => { if (!r || !r.ok) console.warn('[sync] ' + what + ' failed:', (r && r.message) || 'no response'); return r; })
    .catch(e => { console.warn('[sync] ' + what + ' error:', e && e.message); });
}

// A plan write's useful outcome: the ref → workout-GUID map plus the plan's
// own server GUID, or null on failure. The GUID is stamped onto the local
// plan object ONLY from a successful response (a failed save must never tag
// a plan with a stale id — re-verify catch 2026-07-17).
function resFrom(r) {
  if (!(r && r.ok && r.body)) return null;
  return { refToId: toClientState(r.body).refToId || {}, planId: r.body.id != null ? r.body.id : null };
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

// id → its SCHEDULED (un-moved) date. A pending move is stamped with its
// workout's base date at record time; this is what a hydrated plan is checked
// against. Per-workout, not plan-wide: a layout-only reshape (same race/dates
// but different training days) moves a workout onto a new date, so its base
// changes and a stale pending move is dropped — where a plan-wide fingerprint
// would have collided. A retarget keeps the day slots, so bases (and legit
// pending moves) survive it.
export function baseDates(plan) {
  const m = {};
  (plan && plan.weeks || []).forEach(w => (w.workouts || []).forEach(x => { m[x.id] = x.date; }));
  return m;
}

// Moves get stricter treatment than logs: a resurrected move silently corrupts
// the plan (workout ids are REUSED across regenerations, so a stale cached move
// applies cleanly to the wrong workout — the 2026-07-12 "workouts moved without
// me" field report), while a lost offline move costs one re-drag. So the cache
// is never authoritative: the server wins outright, and only this device's own
// PENDING writes (made offline or while a plan push was in flight) are applied
// and pushed. A pending entry is dropped when the server already reflects it
// (confirmed), when its workout no longer resolves, or when the workout no
// longer sits on the base date the move was recorded against — the structure
// changed under it (possibly on another device) and the move must not cross.
// Pending entries are { date, base } with date null for an un-move; baseOf is
// the hydrated plan's id → base-date map. push(guid, dateOrNull) — the caller
// routes null to the delete endpoint.
export function mergeMoves(server, pending, refToId, push, baseOf) {
  const moves = { ...(server || {}) };
  const still = {};
  Object.keys(pending || {}).forEach(id => {
    const e = pending[id];
    if (!e || !refToId[id] || (baseOf || {})[id] !== e.base) return;
    const synced = e.date === null ? moves[id] === undefined : moves[id] === e.date;
    if (synced) return;
    if (e.date === null) delete moves[id]; else moves[id] = e.date;
    still[id] = e;
    push(refToId[id], e.date);
  });
  return { moves, pending: still };
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
  // PLAN LIFECYCLE WRITES ARE SERIALIZED. The backend's "current plan" is a
  // reused row: PUT /api/plans/current overwrites the SAME row id with new
  // content, and DELETE has no version guard — so a delete that lands after
  // a 409→PUT fallback would destroy the brand-new plan that now occupies
  // the row (gauntlet critical, reproduced 2026-07-18). Chaining every
  // create/replace/end through one promise queue guarantees this device's
  // decisions land in the order they were made: an end always settles before
  // the next create can touch the row. Cross-device interleavings need the
  // backend's conditional delete (asked of Jack in NO_PLAN_WORKFLOW.md).
  let planChain = Promise.resolve();
  const serial = fn => {
    const p = planChain.then(fn, fn);
    planChain = p.then(() => {}, () => {});
    return p;
  };

  // Load the server's plan graph. Returns { plan, log, moves, refToId, planId }
  // | 'none' (signed in, no plan) | null (offline/error → caller keeps cache).
  const hydrate = async () => {
    const res = await getCurrentPlan(getToken);
    if (res.ok && res.body) return toClientState(res.body);
    if (res.ok && res.body === null) return 'none';
    return null;
  };
  // Replace the current plan; if there IS no current plan (404 — it was ended,
  // e.g. starting the next plan from tracker) fall back to creating one. The
  // symmetric twin of savePlan's 409 fallback, so either entry point converges
  // on the server's actual state instead of failing into the retry banner.
  const replacePlanNow = plan => replaceCurrentPlan(getToken, plan)
    .then(r => {
      if (r && r.status === 404) return apiCreatePlan(getToken, plan)
        .then(r2 => { if (!r2 || !r2.ok) console.warn('[sync] create-after-404 failed:', (r2 && r2.message) || 'no response'); return resFrom(r2); });
      if (!r || !r.ok) console.warn('[sync] replace plan failed:', (r && r.message) || 'no response');
      return resFrom(r);
    })
    .catch(e => { console.warn('[sync] replace plan error:', e && e.message); return null; });
  const replacePlan = plan => serial(() => replacePlanNow(plan));
  // Create the plan; if the server already has one (409) fall back to replacing it.
  // Resolves to { refToId, planId } (or null on failure).
  const savePlan = plan => serial(() => apiCreatePlan(getToken, plan)
    .then(r => {
      if (r && r.status === 409) return replacePlanNow(plan);
      if (!r || !r.ok) { console.warn('[sync] create plan failed:', (r && r.message) || 'no response'); return null; }
      return resFrom(r);
    })
    .catch(e => { console.warn('[sync] create plan error:', e && e.message); return null; }));

  // The plan-independent profile (Phase 2): PUT is idempotent; failures are
  // logged, never fatal (the local store stays authoritative offline).
  const saveProfile = profile => fire(putProfile(getToken, profile), 'profile');
  // The athlete profile from /api/me, or null (offline / none stored).
  const loadProfile = async () => {
    const res = await getMe(getToken);
    return res.ok && res.body && res.body.profile ? res.body.profile : null;
  };
  // End a SPECIFIC plan by its server GUID — always the id the caller decided
  // to end, never a fresh "current plan" lookup (a fresh GET could return a
  // plan another device just started and delete it — gauntlet critical
  // 2026-07-17). A repeat delete 404s: tolerated, the goal state holds.
  const endPlan = planId => serial(async () => {
    if (!planId) return false;
    const res = await deletePlan(getToken, planId);
    if (res && (res.ok || res.status === 404)) return true;
    console.warn('[sync] end plan failed:', (res && res.message) || 'no response');
    return false;
  });

  // workoutId is the server GUID (resolve from refToId before calling).
  return {
    hydrate, savePlan, replacePlan, saveProfile, loadProfile, endPlan,
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

    // The interval/lap rows for one recording (the rep table). null when not
    // connected, offline, or on a backend that predates the endpoint — the
    // review simply shows no table.
    loadActivityIntervals: async activityId => {
      const res = await getIntervalsActivityIntervals(getToken, activityId);
      return res.ok && Array.isArray(res.body) ? res.body : null;
    },

    // The GPS track for one recording, as [lat, lng] pairs for the recap's
    // route map. null when there is no drawable route for ANY reason — not
    // connected, offline, a backend predating the endpoint, an indoor session
    // with no GPS, or a track too short to draw — the recap simply has no
    // route slide.
    loadActivityRoute: async activityId => {
      const res = await getIntervalsActivityRoute(getToken, activityId);
      const pts = res.ok && res.body && Array.isArray(res.body.points) ? res.body.points : null;
      if (!pts) return null;
      const route = pts
        .filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number')
        .map(p => [p.lat, p.lng]);
      return route.length >= 2 ? route : null;
    },

    // Workouts-to-watch: reconcile the upcoming plan onto the athlete's
    // intervals.icu calendar. Returns the {created, removed, unchanged}
    // counts, or null when not connected, offline, or on an older backend.
    pushWatchEvents: async body => {
      const res = await putPlannedEvents(getToken, body);
      if (res.ok && res.body) return res.body;
      if (res.status === 404) return null; // not connected / older backend: legitimately quiet
      // Surface real failures instead of a bare null: a server write must never
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
