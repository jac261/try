/* Backend sync orchestration. The UI updates local state + the per-user cache
   optimistically; these helpers push the change to the API in the background.
   A failed push just warns — localStorage stays the offline fallback until the
   next successful hydrate. Bind once per session with the Clerk getToken. */
import {
  getCurrentPlan, createPlan as apiCreatePlan, replaceCurrentPlan,
  putWorkoutLog, deleteWorkoutLog, putWorkoutMove, deleteWorkoutMove,
  toClientState, logToApi,
} from '@/lib/api.js';

function fire(promise, what) {
  return promise
    .then(r => { if (!r || !r.ok) console.warn('[sync] ' + what + ' failed:', (r && r.message) || 'no response'); return r; })
    .catch(e => { console.warn('[sync] ' + what + ' error:', e && e.message); });
}

export function makeSync(getToken) {
  return {
    // Load the server's plan graph. Returns { plan, log, moves } | 'none' (signed
    // in but no plan yet) | null (offline/error → caller keeps the local cache).
    async hydrate() {
      const res = await getCurrentPlan(getToken);
      if (res.ok && res.body) return toClientState(res.body);
      if (res.ok && res.body === null) return 'none';
      return null;
    },

    // Create the plan; if the server already has one (409) fall back to replacing
    // it — covers "start over" and migrating a pre-backend local plan.
    savePlan(plan) {
      return apiCreatePlan(getToken, plan).then(r => {
        if (r && r.status === 409) return fire(replaceCurrentPlan(getToken, plan), 'replace plan (existing)');
        if (!r || !r.ok) console.warn('[sync] create plan failed:', (r && r.message) || 'no response');
        return r;
      }).catch(e => console.warn('[sync] create plan error:', e && e.message));
    },
    replacePlan(plan) { return fire(replaceCurrentPlan(getToken, plan), 'replace plan'); },

    saveLog(id, entry) { return fire(putWorkoutLog(getToken, id, logToApi(entry)), 'log ' + id); },
    removeLog(id) { return fire(deleteWorkoutLog(getToken, id), 'unlog ' + id); },
    saveMove(id, date) { return fire(putWorkoutMove(getToken, id, { movedDate: date, reason: null }), 'move ' + id); },
    removeMove(id) { return fire(deleteWorkoutMove(getToken, id), 'unmove ' + id); },
  };
}
