/* Try — backend API client (Jack's ASP.NET Core service).
 *
 * Every call takes Clerk's `getToken` and sends a Bearer JWT. Responses are
 * normalised to { ok, status, body, message } so callers never throw on a
 * network/HTTP error — they branch on `ok`. The backend keeps our client-side
 * workout ids (`clientWorkoutRef`, e.g. "0-0"), so nothing about plan generation
 * changes; toClientState() rehydrates our { plan, log, moves } shape from a
 * PlanResponse, and the log/move helpers translate the other way.
 *
 * Endpoint map (see docs/try-api.postman_collection.json in try-backend):
 *   GET  /api/me                       PUT /api/me/preferences
 *   GET  /api/plans/current            POST /api/plans   PUT /api/plans/current
 *   PUT/DELETE /api/workouts/{ref}/log      PUT/DELETE /api/workouts/{ref}/move
 *   GET/POST /api/activity-files  GET .../{id}  GET .../{id}/download  DELETE .../{id}
 */

const DEFAULT_API_BASE_URL = 'http://localhost:5032';

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_API_BASE_URL;
}

export const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

function describeError(error) {
  return error instanceof Error ? error.message : 'Unexpected API error.';
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

// Core request: mints a token, sends it, and always resolves to a normalised
// result. `raw` skips JSON parsing (used for binary file downloads).
async function request(path, { getToken, method = 'GET', body, headers, raw } = {}) {
  if (typeof getToken !== 'function') {
    return { ok: false, status: null, message: 'Clerk is not ready yet.' };
  }
  let token = '';
  try {
    token = await getToken();
  } catch (error) {
    return { ok: false, status: null, message: describeError(error) };
  }
  if (!token) {
    return { ok: false, status: null, message: 'No Clerk session token is available.' };
  }

  const opts = { method, headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, ...(headers || {}) } };
  if (body !== undefined) {
    if (body instanceof FormData) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }

  try {
    const response = await fetch(apiBaseUrl + path, opts);
    if (raw) {
      if (!response.ok) return { ok: false, status: response.status, message: 'API returned ' + response.status + '.' };
      return { ok: true, status: response.status, body: await response.blob() };
    }
    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) {
      const serverMessage = parsed && parsed.error && parsed.error.message ? parsed.error.message : text;
      return { ok: false, status: response.status, message: serverMessage || ('API returned ' + response.status + '.'), body: parsed || text };
    }
    return { ok: true, status: response.status, body: parsed };
  } catch (error) {
    return { ok: false, status: null, message: describeError(error) };
  }
}

/* ---------------- auth / user ---------------- */

// Kept for the Settings "API connection test" row.
export function getAuthTest(getToken) {
  return request('/api/auth-test', { getToken });
}

export function getMe(getToken) {
  return request('/api/me', { getToken });
}

export function putPreferences(getToken, preferences) {
  return request('/api/me/preferences', { getToken, method: 'PUT', body: preferences });
}

// The plan-independent athlete profile (backend PR #22): the between-plans
// source of truth. The server keeps its own SUBSET (no raceType/raceDate/
// startDate — those belong to a plan) and ignores the extra fields we send;
// the FULL profile lives in the local store, and race fields are re-collected
// when the next plan is created.
export function putProfile(getToken, profile) {
  return request('/api/me/profile', { getToken, method: 'PUT', body: profile });
}

/* ---------------- plans ---------------- */

// End (archive) a plan server-side — the real state transition behind
// entering tracker (backend PR #22). Repeat deletes 404, tolerated by callers.
export function deletePlan(getToken, planId) {
  return request('/api/plans/' + planId, { getToken, method: 'DELETE' });
}

// The POST/PUT body is exactly our T.generatePlan(profile) output — no transform.
export function createPlan(getToken, plan) {
  return request('/api/plans', { getToken, method: 'POST', body: plan });
}

export function replaceCurrentPlan(getToken, plan) {
  return request('/api/plans/current', { getToken, method: 'PUT', body: plan });
}

// Resolves { ok:true, body:null } for a signed-in user with no plan yet (404).
export async function getCurrentPlan(getToken) {
  const res = await request('/api/plans/current', { getToken });
  if (!res.ok && res.status === 404) return { ok: true, status: 404, body: null };
  return res;
}

/* ---------------- workout log / move overlays ---------------- */

export function putWorkoutLog(getToken, workoutRef, entry) {
  return request('/api/workouts/' + encodeURIComponent(workoutRef) + '/log', { getToken, method: 'PUT', body: entry });
}

export function deleteWorkoutLog(getToken, workoutRef) {
  return request('/api/workouts/' + encodeURIComponent(workoutRef) + '/log', { getToken, method: 'DELETE' });
}

export function putWorkoutMove(getToken, workoutRef, entry) {
  return request('/api/workouts/' + encodeURIComponent(workoutRef) + '/move', { getToken, method: 'PUT', body: entry });
}

export function deleteWorkoutMove(getToken, workoutRef) {
  return request('/api/workouts/' + encodeURIComponent(workoutRef) + '/move', { getToken, method: 'DELETE' });
}

// Accepted day-adaptations (the eased-session overlay) sync like logs/moves —
// contract in docs/ADAPTIVE_ENGINE.md. Dormant until the backend ships them.
export function putWorkoutAdjustment(getToken, workoutId, adj) {
  return request('/api/workouts/' + encodeURIComponent(workoutId) + '/adjustment', { getToken, method: 'PUT', body: adj });
}

export function deleteWorkoutAdjustment(getToken, workoutId) {
  return request('/api/workouts/' + encodeURIComponent(workoutId) + '/adjustment', { getToken, method: 'DELETE' });
}

/* ---------------- activity files (.FIT) ---------------- */

export function listActivityFiles(getToken) {
  return request('/api/activity-files', { getToken });
}

export function uploadActivityFile(getToken, file, fields) {
  const form = new FormData();
  form.append('file', file);
  Object.entries(fields || {}).forEach(([k, v]) => form.append(k, v));
  return request('/api/activity-files', { getToken, method: 'POST', body: form });
}

export function getActivityFile(getToken, id) {
  return request('/api/activity-files/' + encodeURIComponent(id), { getToken });
}

export function downloadActivityFile(getToken, id) {
  return request('/api/activity-files/' + encodeURIComponent(id) + '/download', { getToken, raw: true });
}

export function deleteActivityFile(getToken, id) {
  return request('/api/activity-files/' + encodeURIComponent(id), { getToken, method: 'DELETE' });
}

/* ---------------- wellness / readiness ----------------
   Daily wellness records keyed by date ("YYYY-MM-DD"), intervals.icu-shaped:
   { date, hrv, rhr, sleepH, sleepScore, ctl, atl, tsb }. The readiness engine
   (lib/wellness.js) consumes these the same whether the backend stores manual
   entries or proxies them from intervals.icu. See docs/WELLNESS_ENDPOINT.md. */

// The wire name is `weight`; the client's is `weightKg` (gauntlet catch
// 2026-07-21: without this mapping, synced weights never reached any
// client consumer and manual weights never reached the server; the
// weakest-link card had silently fallen back to the profile value).
const toClientWellness = r => (r && r.weight != null && r.weightKg == null ? { ...r, weightKg: r.weight } : r);
const toWireWellness = r => (r && r.weightKg != null ? { ...r, weight: r.weightKg } : r);
const mapWellnessList = res => (res.ok && Array.isArray(res.body) ? { ...res, body: res.body.map(toClientWellness) } : res);

export function getWellness(getToken) {
  return request('/api/wellness', { getToken }).then(mapWellnessList);
}

export function putWellness(getToken, rec) {
  return request('/api/wellness/' + encodeURIComponent(rec.date), { getToken, method: 'PUT', body: toWireWellness(rec) });
}

export function deleteWellness(getToken, date) {
  return request('/api/wellness/' + encodeURIComponent(date), { getToken, method: 'DELETE' });
}

// Pull recent history from intervals.icu into the server's wellness store and
// return the refreshed list (same shape as getWellness). 404 → not connected.
// `days` deepens the window (backfill; backend caps at 730) — a backend that
// predates the parameter ignores it and does its normal ~60-day sync.
export function syncWellness(getToken, days) {
  const query = days ? '?days=' + encodeURIComponent(days) : '';
  return request('/api/wellness/sync' + query, { getToken, method: 'POST' }).then(mapWellnessList);
}

/* ---------------- integrations (intervals.icu) ----------------
   The server holds the athlete's intervals.icu credentials (the public client
   can't) and proxies the wellness feed. The key is write-only — status responses
   only carry { connected, athleteId, lastSyncedAtUtc }. */

export function getIntervalsIntegration(getToken) {
  return request('/api/integrations/intervals-icu', { getToken });
}

export function connectIntervalsIntegration(getToken, athleteId, apiKey) {
  return request('/api/integrations/intervals-icu', { getToken, method: 'PUT', body: { athleteId, apiKey } });
}

export function disconnectIntervalsIntegration(getToken) {
  return request('/api/integrations/intervals-icu', { getToken, method: 'DELETE' });
}

// Recent activities through the server-side passthrough, body verbatim (no
// mapper): id/date/startedAt/type/name/movingTimeSec/elapsedTimeSec/distance/
// trainingLoad/rpe/feel plus power (averageWatts/normalizedWatts), swim
// (poolLengthM/lengths/averageCadence/averageStride) and device
// (deviceName/deviceSource) fields — the delivered set is pinned in
// delivered-fields.test.js. 404 → not connected, or a backend that predates
// the endpoint.
export function getIntervalsActivities(getToken, days) {
  const query = days ? '?days=' + encodeURIComponent(days) : '';
  return request('/api/integrations/intervals-icu/activities' + query, { getToken });
}

// The interval/lap analysis of one activity (compact rows: type, label,
// groupId, startTimeSec, movingTimeSec, distance, averageSpeed, averageHeartrate, maxHeartrate,
// averageWatts, intensity, zone). 404 → not connected or an older backend.
export function getIntervalsActivityIntervals(getToken, activityId) {
  return request('/api/integrations/intervals-icu/activities/' + encodeURIComponent(activityId) + '/intervals', { getToken });
}

// The GPS track of one activity, decimated server-side ({ points: [{lat,
// lng}] }). Empty points → recorded without GPS (pool, trainer). 404 → not
// connected or a backend that predates the endpoint.
export function getIntervalsActivityRoute(getToken, activityId) {
  return request('/api/integrations/intervals-icu/activities/' + encodeURIComponent(activityId) + '/route', { getToken });
}

/* The athlete's best power by duration, built server-side from their rides
   (rows: durationSec, watts, date, source, bike, indoor, quality). `days`
   bounds which rides the endpoint considers — the freshness window belongs
   to the QUERY, because nothing client-side can apply it after the fact.
   404 → not connected, or a backend that predates the endpoint. */
export function getIntervalsPowerCurve(getToken, days) {
  const query = days ? '?days=' + encodeURIComponent(days) : '';
  return request('/api/integrations/intervals-icu/power-curve' + query, { getToken });
}

// The athlete's per-sport thresholds as configured on intervals.icu
// (bikeFtp watts; run/swim threshold paces in metres per second).
export function getIntervalsThresholds(getToken) {
  return request('/api/integrations/intervals-icu/thresholds', { getToken });
}

// Reconcile the athlete's intervals.icu calendar with the app's upcoming plan
// (workouts-to-watch). Body: { oldest, newest, events: [{ref, date, type,
// name, description, movingTimeSec}] }.
export function putPlannedEvents(getToken, body) {
  return request('/api/integrations/intervals-icu/planned-events', { getToken, method: 'PUT', body });
}

/* ---------------- shape mapping (server ⇄ client) ---------------- */

// PlanResponse → the frontend's { plan, log, moves, refToId }. The server returns
// the full workout graph (segments, flags) plus each overlay, keyed by
// clientWorkoutRef, so we rehydrate our exact in-memory shape without regenerating
// from the profile. `refToId` maps our client ref ("0-0") → the server workout
// GUID, which the log/move endpoints (api/workouts/{guid}/…) require.
// The server stores our calibration note verbatim ("cal:" + JSON); it also
// carries the session's recorded moving time, which we restore into the log
// entry here so actual durations survive hydrate on any device with no
// dedicated backend field.
const actualFromNote = note => {
  if (typeof note !== 'string' || !note.startsWith('cal:')) return undefined;
  try { const v = JSON.parse(note.slice(4)).actualMin; return v == null ? undefined : v; } catch (e) { return undefined; }
};
/* Review persistence (phase 1, 2026-07-30). The backend stores each review
   as opaque jsonb; the CLIENT owns the shape, so the client versions it: on
   the wire a review is an envelope { schemaVersion, createdAt, engineVersion,
   review } and in client state it is the flat object every consumer already
   spreads, with the envelope's metadata on a sibling <x>ReviewMeta field.
   Unwrapping at this seam keeps all five existing readers byte-unchanged.
   A stored object WITHOUT a review key is treated as a legacy flat review
   (nothing shipped that shape, but jsonb cannot promise what is in it). */
export const REVIEW_SCHEMA_VERSION = 1;
export const reviewToApi = (review, engineVersion) => ({
  schemaVersion: REVIEW_SCHEMA_VERSION,
  createdAt: new Date().toISOString(),
  engineVersion: engineVersion ?? undefined,
  review,
});
const unwrapReview = stored => {
  if (!stored || typeof stored !== 'object') return { review: undefined, meta: undefined };
  if (!('review' in stored)) return { review: stored, meta: undefined };
  return {
    review: stored.review || undefined,
    meta: {
      schemaVersion: stored.schemaVersion ?? undefined,
      createdAt: stored.createdAt ?? undefined,
      engineVersion: stored.engineVersion ?? undefined,
    },
  };
};
const reviewFields = l => {
  const out = {};
  [['swimReview', 'swimReviewMeta'], ['bikeReview', 'bikeReviewMeta'], ['runReview', 'runReviewMeta']]
    .forEach(([field, metaField]) => {
      const { review, meta } = unwrapReview(l[field]);
      out[field] = review;
      out[metaField] = meta;
    });
  return out;
};
const toLogEntry = l => ({
  done: !!l.completed, at: l.completedAtUtc || null, feel: l.feel || undefined,
  notes: l.notes || undefined, actualMin: actualFromNote(l.notes),
  // The three typed review columns, all live on the backend as of
  // 2026-07-30 (runReview pending Jack's PR #24 merge; reading it early is
  // harmless because absent maps to undefined). Envelope-unwrapped above.
  ...reviewFields(l),
  // The technique cue answer: a bare enum column, not an envelope.
  techniqueCue: l.techniqueCue || undefined,
});
// The server can return a log row for workouts that were never completed
// (empty stubs from other write paths). An entry's EXISTENCE means "done"
// throughout the app, so only meaningful rows may become entries — phantom
// stubs once marked an entire upcoming week as done and emptied the watch push.
const meaningfulLog = l => !!l && !!(l.completed || l.feel || l.notes);

export function toClientState(resp) {
  if (!resp) return null;
  const log = {};
  const moves = {};
  const adjust = {};
  const refToId = {};

  const mapWorkout = (wo, week) => {
    refToId[wo.clientWorkoutRef] = wo.id;
    if (meaningfulLog(wo.log)) log[wo.clientWorkoutRef] = toLogEntry(wo.log);
    if (wo.move) moves[wo.clientWorkoutRef] = wo.move.movedDate;
    if (wo.adjustment) {
      adjust[wo.clientWorkoutRef] = { kind: wo.adjustment.kind || 'ease', at: wo.adjustment.at || null };
      if (wo.adjustment.factor != null) adjust[wo.clientWorkoutRef].factor = wo.adjustment.factor;
    }
    return {
      id: wo.clientWorkoutRef,
      week: wo.week, phase: wo.phase, date: wo.date,
      discipline: wo.discipline, role: wo.role || undefined, type: wo.type, title: wo.title,
      durationMin: wo.durationMin, distance: wo.distance ?? null, unit: wo.unit || '',
      // the server's segment DTO is label/min/detail only, so profile data
      // (zone/blocks/swim) does not round-trip yet — upgradePlanSegments
      // rebuilds it on load. Pass any fields through in case the DTO widens.
      segments: (wo.segments || []).map(s => ({
        label: s.label, min: s.min ?? undefined, detail: s.detail || undefined,
        zone: s.zone || undefined, blocks: s.blocks || undefined, swim: s.swim || undefined,
        terrain: s.terrain || undefined,
      })),
      key: !!wo.key, race: wo.race || undefined, test: wo.test || undefined,
      testKind: wo.testKind || undefined, note: wo.note || undefined, second: wo.second || undefined,
      // not stored server-side, but fully derivable: user-added sessions carry
      // role "custom", and the variant seed is the generation rule (recovery
      // weeks pin 0). Without these, hydrated custom workouts lost their
      // Added tag and Remove button, and the segment rebuild silently pinned
      // rotated sessions back to the canonical format.
      custom: wo.role === 'custom' || undefined,
      seed: week && week.isRecovery ? 0 : (week ? week.index : undefined),
      // Also derivable rather than stored: a RACE-typed workout that is not
      // THE race is a tune-up (B) race — the flag drives calendar locking and
      // proposal exclusions, so it must survive hydrate.
      bRace: (wo.type === 'RACE' && !wo.race) || undefined,
    };
  };

  const plan = {
    profile: resp.profile || null,
    race: resp.race,
    createdAt: resp.createdAt || null,
    updatedAt: resp.updatedAt || undefined,
    totalWeeks: resp.totalWeeks,
    paces: resp.paces || null,
    weeks: (resp.weeks || []).map(w => ({
      index: w.index, phase: w.phase, isRecovery: w.isRecovery, start: w.start,
      totalMin: w.totalMin, workouts: (w.workouts || []).map(wo => mapWorkout(wo, w)),
    })),
  };

  // Top-level logs[]/moves[] are also returned; merge them in case a workout row
  // was omitted (defensive — the embedded copies above are the primary source).
  (resp.logs || []).forEach(l => { if (!log[l.clientWorkoutRef] && meaningfulLog(l)) log[l.clientWorkoutRef] = toLogEntry(l); });
  (resp.moves || []).forEach(m => { if (!moves[m.clientWorkoutRef]) moves[m.clientWorkoutRef] = m.movedDate; });

  // the server plan GUID rides along: it becomes plan.serverId in the App,
  // the one identity every end-plan decision keys on
  return { plan, log, moves, adjust, refToId, planId: resp.id != null ? resp.id : null };
}

/* Our log entry { done, at, feel } → the API's log body.

   MUST NEVER emit review keys. The backend's review fields are
   Optional<T>: omitted means "preserve what is stored", an explicit null
   means "clear it". logToApi runs on every feel tap and completion toggle,
   so a defensive `swimReview: null` here would erase the athlete's stored
   review history on their next tap. The base four (completed/completedAtUtc/
   feel/notes) are NOT Optional — the server writes them on every PUT — so
   any review write must carry them too (see reviewBodyToApi). */
export function logToApi(entry) {
  return {
    completed: !!(entry && entry.done),
    completedAtUtc: (entry && entry.at) || new Date().toISOString(),
    feel: (entry && entry.feel) || null,
    notes: (entry && entry.notes) || null,
  };
}

/* A review (or cue) write: the base four from the CURRENT entry — because
   the server overwrites them unconditionally, sending stale ones would
   revert a feel tap — plus only the named review/cue fields. Reviews are
   wrapped in the versioned envelope; techniqueCue passes through bare
   (enum column). An explicit null clears (deselecting a cue). */
export function reviewBodyToApi(entry, fields, engineVersions) {
  const body = logToApi(entry);
  ['swimReview', 'bikeReview', 'runReview'].forEach(f => {
    if (!(f in fields)) return;                       // omitted = preserved
    body[f] = fields[f] == null ? null
      : reviewToApi(fields[f], engineVersions && engineVersions[f]);
  });
  if ('techniqueCue' in fields) body.techniqueCue = fields.techniqueCue ?? null;
  return body;
}
