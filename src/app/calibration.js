/* Calibration-data collection for the readiness model.
 *
 * Every time a session is marked done (and again when its feel is rated) we
 * capture one observation: the readiness inputs as they stood on the session's
 * day, what the engine said, what the session was, and how it actually felt.
 * Accrue enough of these and the model's weights can be FITTED to real outcomes
 * instead of derived from policy (see docs/READINESS_MODEL.md).
 *
 * Snapshots are taken at capture time because everything they reference is
 * mutable afterwards — wellness records resync, plans reshape, the engine's
 * weights version. Observations are stored twice, both free:
 *   1. an append-only per-user localStorage list (survives plan reshapes), and
 *   2. embedded as compact JSON in the workout log's `notes` field, which the
 *      backend already stores + syncs (≤2000 chars; ours is ~300) — cloud
 *      durability with zero backend changes.
 */
import * as T from '@/lib';

const NOTE_PREFIX = 'cal:'; // namespaces the notes payload so a future human-notes feature can coexist

// One observation for a completed session. `wellnessRecs` is the full records
// list; the readiness inputs are taken from the session's own (effective) day.
export function buildObservation({ workout, date, feel, eased, wellnessRecs, at }) {
  const rec = (wellnessRecs || []).find(r => r.date === date) || null;
  const base = T.wellness.baseline(wellnessRecs || [], date);
  const snap = T.wellness.snapshot(rec, base);
  return {
    ...snap,
    date,
    workout: {
      id: workout.id,
      discipline: workout.discipline,
      type: workout.type,
      durationMin: workout.durationMin,
      key: !!workout.key,
    },
    eased: !!eased,
    feel: feel || null,
    at: at || null,
  };
}

export function toNote(obs) {
  return NOTE_PREFIX + JSON.stringify(obs);
}

export function fromNote(note) {
  if (typeof note !== 'string' || !note.startsWith(NOTE_PREFIX)) return null;
  try { return JSON.parse(note.slice(NOTE_PREFIX.length)); } catch (e) { return null; }
}

// Download this device's observations as JSON — the raw material for fitting
// the model weights once there's enough history.
export function downloadCalibration(storage) {
  const data = { exportedAt: new Date().toISOString(), engineVersion: T.wellness.ENGINE_VERSION, observations: storage.loadCalibration() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'try-readiness-calibration.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
