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

/* ---------------- plans ---------------- */

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

/* ---------------- shape mapping (server ⇄ client) ---------------- */

// PlanResponse → the frontend's { plan, log, moves, refToId }. The server returns
// the full workout graph (segments, flags) plus each overlay, keyed by
// clientWorkoutRef, so we rehydrate our exact in-memory shape without regenerating
// from the profile. `refToId` maps our client ref ("0-0") → the server workout
// GUID, which the log/move endpoints (api/workouts/{guid}/…) require.
export function toClientState(resp) {
  if (!resp) return null;
  const log = {};
  const moves = {};
  const refToId = {};

  const mapWorkout = (wo) => {
    refToId[wo.clientWorkoutRef] = wo.id;
    if (wo.log) log[wo.clientWorkoutRef] = { done: !!wo.log.completed, at: wo.log.completedAtUtc || null, feel: wo.log.feel || undefined };
    if (wo.move) moves[wo.clientWorkoutRef] = wo.move.movedDate;
    return {
      id: wo.clientWorkoutRef,
      week: wo.week, phase: wo.phase, date: wo.date,
      discipline: wo.discipline, role: wo.role || undefined, type: wo.type, title: wo.title,
      durationMin: wo.durationMin, distance: wo.distance ?? null, unit: wo.unit || '',
      segments: (wo.segments || []).map(s => ({ label: s.label, min: s.min ?? undefined, detail: s.detail || undefined })),
      key: !!wo.key, race: wo.race || undefined, test: wo.test || undefined,
      testKind: wo.testKind || undefined, note: wo.note || undefined, second: wo.second || undefined,
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
      totalMin: w.totalMin, workouts: (w.workouts || []).map(mapWorkout),
    })),
  };

  // Top-level logs[]/moves[] are also returned; merge them in case a workout row
  // was omitted (defensive — the embedded copies above are the primary source).
  (resp.logs || []).forEach(l => { if (!log[l.clientWorkoutRef]) log[l.clientWorkoutRef] = { done: !!l.completed, at: l.completedAtUtc || null, feel: l.feel || undefined }; });
  (resp.moves || []).forEach(m => { if (!moves[m.clientWorkoutRef]) moves[m.clientWorkoutRef] = m.movedDate; });

  return { plan, log, moves, refToId };
}

// Our log entry { done, at, feel } → the API's log body.
export function logToApi(entry) {
  return {
    completed: !!(entry && entry.done),
    completedAtUtc: (entry && entry.at) || new Date().toISOString(),
    feel: (entry && entry.feel) || null,
    notes: (entry && entry.notes) || null,
  };
}
