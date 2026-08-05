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

/* Every coach-card dismissal, and what it is a dismissal OF.

   A dismissal is sticky per SIGNATURE: the engine re-derives the same nudge
   on every render, so without a stored signature the card returns the moment
   it is dismissed. The question this table answers is what makes a signature
   go stale.

   PLAN-scoped signatures are built from the plan's own structure — a week
   INDEX, positional workout ids — and a regenerated plan produces them
   byte-identical, so a rejection made about one week silently silenced a
   materially different week of the next plan.

   ATHLETE-scoped signatures are built from measurements and dates (a test
   date, a threshold value, today). They already speak again the moment the
   athlete's situation changes, and a new plan says nothing about whether a
   CSS retest is due, so stamping them would just re-ask a question already
   answered.

   An unregistered key defaults to PLAN-scoped on purpose: a forgotten
   registration then produces a card that asks once more, never one that
   stays silent for the wrong athlete. Do not "fix" this toward silence. */
export const DISMISS_SCOPE = {
  weeklyProposalDismissed: 'plan',
  startShortfallDismissed: 'plan',
  cssTestFailDismissed: 'plan',
  runTestFailDismissed: 'plan',
  cssRetestDismissed: 'athlete',
  ftpRetestDismissed: 'athlete',
  eftpProposalDismissed: 'athlete',
  todayProposalDismissed: 'athlete',
};
const planScoped = name => (DISMISS_SCOPE[name] || 'plan') === 'plan';
const PLAN_DISMISS_KEYS = Object.keys(DISMISS_SCOPE).filter(planScoped);

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
    // Plan-scoped dismissals join the list: they are current-plan state in
    // exactly the way moves and adjustments are, and "start a new plan"
    // means every rejection about the old one is spent.
    clear() { ['plan', 'log', 'moves', 'adjust', 'pendingMoves', 'missedReasons', ...PLAN_DISMISS_KEYS].forEach(k => localStorage.removeItem(ns + k)); },
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
    // The coach brain's weekly decisions, keyed by week Monday. From Sunday
    // 17:00 the reviewed week's bundle is PROVISIONAL (stamped so, rewritten
    // in place as evidence lands); the first render after the week closes
    // writes the final bundle, and from then the digest quotes it verbatim
    // or shows none — a final bundle is never recomputed and presented as
    // the original call (2026-07-31). Device-local by design. Capped in
    // WEEKS, not entries: each week stores one bundle.
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
      /* Idempotent on (id, status, why) — the WHY matters (gauntlet catch):
         a today-proposal id carries no band, so an amber ease rejected and
         its RED escalation rejected the same day share (id, status), and
         comparing only those silently dropped the materially different
         second rejection. A re-fired effect still dedupes: its why is
         byte-identical. */
      if (last && last.status === entry.status && (last.why || null) === (entry.why || null)) return log;
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
    /* The whole list at once. Only the selection-rule purge needs this —
       every other write is one entry through saveDurabilityRead — and it
       only ever removes, so the append-only spirit above survives. */
    replaceDurability(list) {
      const next = [...(list || [])].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-40);
      try { localStorage.setItem(ns + 'durability', JSON.stringify(next)); } catch (e) {}
      return next;
    },
    /* The shape label's own history, so it can show what it changed FROM.
       Append-on-change only: a label that has not moved writes nothing, so
       the list is a record of transitions rather than of renders. Spans
       plans and stays out of clear(), like durability and the fuel diary —
       a history that reset with the plan would defeat the point, which is
       that the athlete watches the reading move rather than receiving it as
       a fixed fact about themselves. */
    loadShapeLabels() { try { return JSON.parse(localStorage.getItem(ns + 'shapeLabels') || '[]'); } catch (e) { return []; } },
    saveShapeLabel(text, at) {
      const list = this.loadShapeLabels();
      const last = list.length ? list[list.length - 1] : null;
      if (!text || (last && last.text === text)) return list;   // nothing moved
      list.push({ text, at });
      const capped = list.slice(-10);
      try { localStorage.setItem(ns + 'shapeLabels', JSON.stringify(capped)); } catch (e) {}
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
    /* Phase 2 stray fix: stamped with planCreatedAt like every sibling
       journal (adjustLog/coachLog/focusLog all carry it) — a bare week
       string survived storage.clear() and a plan replace, so a block review
       answered on a PREVIOUS plan suppressed the next plan's first review.
       A legacy bare string is honoured as current-plan once and restamped
       on the next write. */
    loadBlockReviewed(planCreatedAt) {
      try {
        const raw = localStorage.getItem(ns + 'blockReviewed');
        if (!raw) return null;
        try {
          const v = JSON.parse(raw);
          if (v && typeof v === 'object') {
            return planCreatedAt == null || v.planCreatedAt === planCreatedAt ? v.weekMonday : null;
          }
        } catch (e2) { /* legacy bare week string */ }
        return raw;
      } catch (e) { return null; }
    },
    saveBlockReviewed(weekMonday, planCreatedAt) {
      try { localStorage.setItem(ns + 'blockReviewed', JSON.stringify({ weekMonday, planCreatedAt: planCreatedAt ?? null })); } catch (e) {}
      return weekMonday;
    },
    /* Coach-card dismissals, stamped the same way and living beside their
       model — but with three deliberate differences from it, because a
       dismissal is a stronger claim than a week marker:

       1. A plan-scoped key with a NULL stamp returns null. loadBlockReviewed
          above reads `planCreatedAt == null` as "matches anything", which
          here would honour a foreign stamp for any caller that has no plan.
       2. A legacy bare string (written before the stamp existed) is honoured
          for athlete-scoped keys, where no stamp was ever needed, and
          IGNORED for plan-scoped ones: it cannot answer the question being
          asked, so it is not evidence, and the card gets one more say.
       3. These are arrow closures over ns, not this-bound methods, so a test
          double can borrow them onto its own object. Keep them that way.

       Written as a bare name/sig pair rather than storage.load/save because
       the components reach them through the storage prop only — features may
       not import app (scripts/check-boundaries.mjs). */
    loadDismiss: (name, planCreatedAt) => {
      try {
        const raw = localStorage.getItem(ns + name);
        if (!raw) return null;
        try {
          const v = JSON.parse(raw);
          if (v && typeof v === 'object') {
            if (!planScoped(name)) return v.sig ?? null;
            return planCreatedAt != null && v.planCreatedAt === planCreatedAt ? (v.sig ?? null) : null;
          }
        } catch (e2) { /* legacy bare signature string */ }
        return planScoped(name) ? null : raw;
      } catch (e) { return null; }
    },
    saveDismiss: (name, sig, planCreatedAt) => {
      try {
        localStorage.setItem(ns + name, JSON.stringify({ sig, planCreatedAt: planScoped(name) ? (planCreatedAt ?? null) : null }));
      } catch (e) { /* private mode */ }
      return sig;
    },
    /* The stamp alone cannot carry a REGENERATED plan: createdAt identifies
       the server row, and a reshape keeps it while rebuilding the week grid.
       So this sits beside its siblings at the two wholesale-wipe sites in
       App, for the same stated reason they do — positional ids change
       meaning, so an annotation about the old structure must not land on the
       new one. Athlete-scoped keys survive: nothing about a reshape makes a
       retest answer stale. */
    clearDismiss: () => {
      PLAN_DISMISS_KEYS.forEach(k => { try { localStorage.removeItem(ns + k); } catch (e) {} });
    },
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
