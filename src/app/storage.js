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
  // exposed so surfaces that keep their own localStorage keys (TodayView's
  // dismissals) can share this user's namespace instead of a global literal
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
    ns,
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
      /* Capped like every sibling store — this was the only uncapped one,
         and the server sync re-upserts the whole merged history on every
         load, so a multi-year intervals.icu history grew the store and the
         per-load work together. 800 daily records is over two years, more
         than anything here reads. Oldest evicted first: a is date-sorted. */
      saveWellness(a.slice(-800));
      return a.slice(-800);
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
    /* The unified decision journal (phase 2 §9): every terminal athlete
       action on a coaching decision — accepted, rejected (a dismissal IS a
       rejection), superseded — appended in the shared decision shape.
       Device-local by design (COACH_BRAIN rule: a synced journal is a
       backend ask, filed); rejections are never deleted, because history
       is the point. Idempotent: re-appending the latest (id, status) pair
       is a no-op, so an effect that fires twice writes once. */
    loadDecisionLog() { try { return JSON.parse(localStorage.getItem(ns + 'decisionLog') || '[]'); } catch (e) { return []; } },
    appendDecision(entry) {
      const log = this.loadDecisionLog();
      const last = [...log].reverse().find(e => e.id === entry.id);
      if (last && last.status === entry.status) return log;   // idempotent
      const next = log.concat([entry]).slice(-120);
      try { localStorage.setItem(ns + 'decisionLog', JSON.stringify(next)); } catch (e) {}
      return next;
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
    saveFuel(activityId, level, at, discipline) {
      const m = this.loadFuel();
      /* The DISCIPLINE the answer was about rides along, because the tap is
         shared with long swims and runs where taking nothing in is normal and
         correct, and the bike's fuelling target reads this store to work out
         what a rider's stomach has proven. Without it one honest "nothing" on
         a forty-five minute swim capped every future ride at thirty grams an
         hour. Entries written before this carry no discipline and are ignored
         by that calculation rather than guessed at. */
      if (level == null) delete m[activityId]; else m[activityId] = { level, at, discipline: discipline || undefined };
      // evict OLDEST answers by timestamp: object key order is insertion
      // order, not time order (gauntlet catch 2026-07-21)
      const ids = Object.keys(m).sort((a, b) => ((m[a].at || '') < (m[b].at || '') ? -1 : 1));
      ids.slice(0, Math.max(0, ids.length - 80)).forEach(id => delete m[id]);
      try { localStorage.setItem(ns + 'fuel', JSON.stringify(m)); } catch (e) {}
      return m;
    },
    /* Phase 6 §5: aero position tolerance, on exactly the fuel store's terms
       and for the same reasons — keyed by the RECORDING (never a workout id,
       which an eased rebuild can change under you), capped and evicted oldest
       first, and spanning plans because tolerance is a property of the rider
       and their bike, not of one training block. */
    loadPosition() { try { return JSON.parse(localStorage.getItem(ns + 'position') || '{}'); } catch (e) { return {}; } },
    savePosition(activityId, comfort, symptoms, at, minutes) {
      const m = this.loadPosition();
      if (comfort == null) delete m[activityId];
      else m[activityId] = { comfort, symptoms: symptoms || [], at, minutes: minutes || null };
      const ids = Object.keys(m).sort((a, b) => ((m[a].at || '') < (m[b].at || '') ? -1 : 1));
      ids.slice(0, Math.max(0, ids.length - 80)).forEach(id => delete m[id]);
      try { localStorage.setItem(ns + 'position', JSON.stringify(m)); } catch (e) {}
      return m;
    },
    /* Phase 7 §5/§6: the last power curve we showed, so the next one has
       something to be compared against. Without a stored previous there is no
       historical comparison and, more importantly, no device-change
       detection: the entire protection against reporting a new power meter as
       a performance jump only runs when a previous curve exists. */
    loadPowerCurve() { try { return JSON.parse(localStorage.getItem(ns + 'powercurve') || 'null'); } catch (e) { return null; } },
    savePowerCurve(curve) {
      try { localStorage.setItem(ns + 'powercurve', JSON.stringify(curve || null)); } catch (e) {}
      return curve || null;
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
