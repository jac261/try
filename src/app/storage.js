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
  // Morning check-in answers, {date: 'fresh'|'okay'|'rough'|'skip'}. A separate
  // store (not a field on the wellness records) because the server sync is
  // authoritative per date and would silently drop a field it doesn't know.
  const feelKey = ns + 'feel';
  const loadFeels = () => { try { return JSON.parse(localStorage.getItem(feelKey) || '{}'); } catch (e) { return {}; } };
  // Manually logged sessions (tracker mode's diary, sensor-less or watch-missed).
  // Local-only until the backend grows a free-standing activities endpoint —
  // the log endpoint keys on workout GUIDs, which manual entries don't have.
  const manualKey = ns + 'manualActivities';
  const loadManual = () => { try { return JSON.parse(localStorage.getItem(manualKey) || '[]'); } catch (e) { return []; } };
  const saveManual = arr => { try { localStorage.setItem(manualKey, JSON.stringify(arr)); } catch (e) {} };

  return {
    load(k, fb) { try { const v = localStorage.getItem(ns + k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } },
    save(k, v) { try { localStorage.setItem(ns + k, JSON.stringify(v)); } catch (e) {} },
    // Note: calibration and manualActivities deliberately survive clear() —
    // both are append-only diaries spanning plans, not current-plan state.
    clear() { ['plan', 'log', 'moves', 'adjust', 'pendingMoves', 'missedReasons'].forEach(k => localStorage.removeItem(ns + k)); },
    loadManualActivities: loadManual,
    // Replace-by-id upsert, date-sorted, capped like calibration so the diary
    // can't grow unbounded (500 sessions ≈ well over a year of training).
    upsertManualActivity(entry) {
      const a = loadManual().filter(e => e.id !== entry.id);
      a.push(entry);
      a.sort((x, y) => (x.date < y.date ? -1 : 1));
      const out = a.slice(-500);
      saveManual(out);
      return out;
    },
    removeManualActivity(id) {
      const a = loadManual().filter(e => e.id !== id);
      saveManual(a);
      return a;
    },
    loadWellness,
    upsertWellness(rec) {
      const a = loadWellness().filter(r => r.date !== rec.date);
      a.push(rec);
      a.sort((x, y) => (x.date < y.date ? -1 : 1));
      saveWellness(a);
      return a;
    },
    // The one-tap answer for a missed session, keyed by WORKOUT id (never the
    // log dict: a bare log[id] means done all over the codebase, and never
    // the daily feels map: that is keyed by date for the morning check-in).
    // Local-only, like the calibration diary.
    clearMissedReasons() { localStorage.removeItem(ns + 'missedReasons'); return {}; },
    loadMissedReasons() { try { return JSON.parse(localStorage.getItem(ns + 'missedReasons') || '{}'); } catch (e) { return {}; } },
    saveMissedReason(workoutId, reason, at) {
      const m = this.loadMissedReasons();
      if (reason == null) delete m[workoutId]; else m[workoutId] = { reason, at };
      const ids = Object.keys(m);
      // cap by entry count; a season of misses is well under this
      ids.slice(0, Math.max(0, ids.length - 200)).forEach(id => delete m[id]);
      try { localStorage.setItem(ns + 'missedReasons', JSON.stringify(m)); } catch (e) {}
      return m;
    },
    // The coach brain's frozen weekly decisions, keyed by week Monday.
    // Device-local by design (the digest quotes a stored decision verbatim or
    // shows none; it never recomputes one and presents it as the original
    // call). Capped in WEEKS, not entries: each week stores one bundle.
    loadCoachLog() { try { return JSON.parse(localStorage.getItem(ns + 'coachLog') || '{}'); } catch (e) { return {}; } },
    saveCoachDecision(weekMonday, decision) {
      const m = this.loadCoachLog();
      m[weekMonday] = decision;
      const weeks = Object.keys(m).sort();
      weeks.slice(0, Math.max(0, weeks.length - 26)).forEach(w => delete m[w]);
      try { localStorage.setItem(ns + 'coachLog', JSON.stringify(m)); } catch (e) {}
      return m;
    },
    // Durability reads, keyed by activity id. Like calibration and the
    // manual diary this is an append-only record of facts about PAST
    // recordings, spanning plans by design: it must NOT join clear()'s
    // removal list. read is null for a fetched-but-unreadable recording
    // (fail-closed: never refetched).
    loadDurability() { try { return JSON.parse(localStorage.getItem(ns + 'durability') || '[]'); } catch (e) { return []; } },
    saveDurabilityRead(entry) {
      const list = this.loadDurability().filter(e => e.activityId !== entry.activityId);
      list.push(entry);
      list.sort((a, b) => (a.date < b.date ? -1 : 1));
      const capped = list.slice(-40);
      try { localStorage.setItem(ns + 'durability', JSON.stringify(capped)); } catch (e) {}
      return capped;
    },
    // One-tap fuel answers for long sessions, keyed by ACTIVITY id only:
    // activity ids are the sync provider's and stable, so this store, like
    // durability and the calibration diary, spans plans and must NOT join
    // clear()'s removal list. No workout-id keying, no reshape wiring.
    loadFuel() { try { return JSON.parse(localStorage.getItem(ns + 'fuel') || '{}'); } catch (e) { return {}; } },
    saveFuel(activityId, level, at) {
      const m = this.loadFuel();
      if (level == null) delete m[activityId]; else m[activityId] = { level, at };
      // evict OLDEST answers by timestamp: object key order is insertion
      // order, not time order (gauntlet catch 2026-07-21)
      const ids = Object.keys(m).sort((a, b) => ((m[a].at || '') < (m[b].at || '') ? -1 : 1));
      ids.slice(0, Math.max(0, ids.length - 80)).forEach(id => delete m[id]);
      try { localStorage.setItem(ns + 'fuel', JSON.stringify(m)); } catch (e) {}
      return m;
    },
    // Block-focus changes journal in their OWN store: coach.js's
    // weekProposal scans adjustLog for any entry with a headline and
    // defaults a kind-less match to a trim, so a focus entry there would be
    // quoted as an accepted engine call (design panel 2026-07-21).
    loadFocusLog() { try { return JSON.parse(localStorage.getItem(ns + 'focusLog') || '[]'); } catch (e) { return []; } },
    saveFocusChange(entry) {
      const list = this.loadFocusLog().concat([entry]).slice(-20);
      try { localStorage.setItem(ns + 'focusLog', JSON.stringify(list)); } catch (e) {}
      return list;
    },
    // the last week a block review was shown, so the cadence fallback
    // cannot re-fire weekly once it starts
    loadBlockReviewed() { try { return localStorage.getItem(ns + 'blockReviewed') || null; } catch (e) { return null; } },
    saveBlockReviewed(weekMonday) { try { localStorage.setItem(ns + 'blockReviewed', weekMonday); } catch (e) {} return weekMonday; },
    loadFeels,
    saveFeel(date, value) {
      const m = loadFeels();
      m[date] = value;
      // Prune answers older than ~6 months; the durable copy for fitting lives
      // in the calibration observations, this map only feeds live scoring.
      const dates = Object.keys(m).sort();
      dates.slice(0, Math.max(0, dates.length - 180)).forEach(d => delete m[d]);
      try { localStorage.setItem(feelKey, JSON.stringify(m)); } catch (e) {}
      return m;
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
