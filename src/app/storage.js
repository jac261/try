/* Per-user localStorage cache. Namespaced by Clerk user id so multiple accounts
   on one browser stay separate; once the backend sync is wired these keys become
   the offline / last-loaded cache with the API as the source of truth. */
const NS = 'try.';

export function storageForUser(userId) {
  const ns = NS + 'user.' + userId + '.';
  const wellnessKey = ns + 'wellness';
  const loadWellness = () => { try { return JSON.parse(localStorage.getItem(wellnessKey) || '[]'); } catch (e) { return []; } };
  const saveWellness = arr => { try { localStorage.setItem(wellnessKey, JSON.stringify(arr)); } catch (e) {} };

  return {
    load(k, fb) { try { const v = localStorage.getItem(ns + k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } },
    save(k, v) { try { localStorage.setItem(ns + k, JSON.stringify(v)); } catch (e) {} },
    clear() { ['plan', 'log', 'moves', 'adjust'].forEach(k => localStorage.removeItem(ns + k)); },
    loadWellness,
    upsertWellness(rec) {
      const a = loadWellness().filter(r => r.date !== rec.date);
      a.push(rec);
      a.sort((x, y) => (x.date < y.date ? -1 : 1));
      saveWellness(a);
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
