/* Per-user localStorage cache. Namespaced by Clerk user id so multiple accounts
   on one browser stay separate; once the backend sync is wired these keys become
   the offline / last-loaded cache with the API as the source of truth. */
const NS = 'try.';

// One-time sweep of dead keys from earlier eras: the pre-auth releases stored
// state un-namespaced ("try.plan"), and the original app used "triflow.*".
// Both are superseded by the per-user keys (and the backend as source of truth).
['plan', 'log', 'moves', 'adjust', 'wellness'].forEach(k => {
  try { localStorage.removeItem(NS + k); localStorage.removeItem('triflow.' + k); } catch (e) {}
});

export function storageForUser(userId) {
  const ns = NS + 'user.' + userId + '.';
  const wellnessKey = ns + 'wellness';
  const loadWellness = () => { try { return JSON.parse(localStorage.getItem(wellnessKey) || '[]'); } catch (e) { return []; } };
  const saveWellness = arr => { try { localStorage.setItem(wellnessKey, JSON.stringify(arr)); } catch (e) {} };
  const calKey = ns + 'calibration';
  const loadCalibration = () => { try { return JSON.parse(localStorage.getItem(calKey) || '[]'); } catch (e) { return []; } };
  const saveCalibration = arr => { try { localStorage.setItem(calKey, JSON.stringify(arr)); } catch (e) {} };

  return {
    load(k, fb) { try { const v = localStorage.getItem(ns + k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } },
    save(k, v) { try { localStorage.setItem(ns + k, JSON.stringify(v)); } catch (e) {} },
    // Note: calibration deliberately survives clear() — it's an append-only
    // dataset spanning plans, not state tied to the current one.
    clear() { ['plan', 'log', 'moves', 'adjust'].forEach(k => localStorage.removeItem(ns + k)); },
    loadWellness,
    upsertWellness(rec) {
      const a = loadWellness().filter(r => r.date !== rec.date);
      a.push(rec);
      a.sort((x, y) => (x.date < y.date ? -1 : 1));
      saveWellness(a);
      return a;
    },
    loadCalibration,
    // One observation per workout+date: re-ticking or rating feel replaces the
    // earlier capture for that session. Capped so it can't grow unbounded.
    upsertCalibration(obs) {
      const keyOf = o => (o.workout && o.workout.id) + '@' + o.date;
      const a = loadCalibration().filter(o => keyOf(o) !== keyOf(obs));
      a.push(obs);
      saveCalibration(a.slice(-1000));
      return a;
    },
    removeCalibration(workoutId, date) {
      const a = loadCalibration().filter(o => !((o.workout && o.workout.id) === workoutId && o.date === date));
      saveCalibration(a);
      return a;
    },
  };
}

// Nuke every Try cache key regardless of user — used by the error boundary to
// recover from a corrupt/stale cached plan when it can't know whose it is.
export function clearAll() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(NS)).forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}
