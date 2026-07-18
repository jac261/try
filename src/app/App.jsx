import { useState, useEffect, useMemo, useRef } from 'react';
import * as T from '@/lib';
import { makeSync, mergeOverlay, mergeMoves, baseDates, sweepStale } from '@/app/sync.js';
import { buildObservation, toNote, downloadCalibration } from '@/app/calibration.js';
import { effDate } from '@/lib/schedule.js';
import { INTENSITY_TYPES, paceSuggestions, tuneFields } from '@/lib/tuning.js';
import { downloadICS } from '@/lib/ics.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { Splash } from '@/components/Splash.jsx';
import { DetailSheet } from '@/components/DetailSheet.jsx';
import { WhatIfSheet } from '@/features/wellness/WhatIfSheet.jsx';
import { RecapSlides } from '@/features/recap/RecapSlides.jsx';
import { AddWorkoutSheet } from '@/components/AddWorkoutSheet.jsx';
import { Onboarding } from '@/features/onboarding/Onboarding.jsx';
import { BuildingPlan } from '@/features/onboarding/BuildingPlan.jsx';
import { FitnessEditor } from '@/features/settings/FitnessEditor.jsx';
import { PlanSettingsEditor } from '@/features/settings/PlanSettingsEditor.jsx';
import { SettingsView } from '@/features/settings/SettingsView.jsx';
import { WellnessEditor } from '@/features/wellness/WellnessEditor.jsx';
import { ReadinessInfo } from '@/features/wellness/ReadinessInfo.jsx';
import { SupportView } from '@/features/support/SupportView.jsx';
import { TodayView } from '@/features/today/TodayView.jsx';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { PlanView } from '@/features/plan/PlanView.jsx';
import { ProgressView } from '@/features/progress/ProgressView.jsx';
import { WurmReveal } from '@/features/easter-egg/WurmReveal.jsx';

// The tracker calendar browses back to the FIRST of the month six months ago
// (addMonths snaps to the 1st), which is at most 213 days (Dec 31 → Jun 1);
// one more covers the fence. Well inside the server's 365-day cap.
const TRACKER_FEED_DAYS = 214;

export function App({ storage, getToken, user }) {
  // upgradePlanSegments backfills profile data (zones/blocks) into plans
  // cached before the workout-profile release; a no-op on current plans.
  const [plan, setPlan] = useState(() => T.upgradePlanSegments(storage.load('plan', null)));
  const [log, setLog] = useState(() => storage.load('log', {}));
  const [moves, setMoves] = useState(() => storage.load('moves', {}));
  // This device's own not-yet-confirmed move writes (id → date, null = un-move).
  // Only these are ever pushed at hydrate — the moves cache itself is never
  // authoritative, so stale cached moves can no longer resurrect (the
  // 2026-07-12 "workouts moved without me" field report).
  const [pendingMoves, setPendingMoves] = useState(() => storage.load('pendingMoves', {}));
  // Accept-time record of engine proposals, quoted verbatim by the weekly
  // digest. Append-only and capped: the adjust overlay is current-state (a
  // restore deletes its entries), so the week's story has to be written down
  // the moment it happens or it is gone.
  const [adjustLog, setAdjustLog] = useState(() => storage.load('adjustLog', []));
  const sync = useMemo(() => makeSync(getToken), [getToken]);
  const [hydrated, setHydrated] = useState(false);
  // Hold the splash for one full pulse even when hydration is instant (a
  // cached plan resolves in milliseconds and the mark just flashed). The app
  // shows once BOTH are true, so a slow load still gets the splash for as
  // long as it genuinely needs. Declared here with the other hooks — never
  // after the early returns (the default-to-no-plan hooks lesson).
  const [splashHeld, setSplashHeld] = useState(true);
  useEffect(() => {
    // long enough for the mark to tumble through all three faces (4.2s, Jon)
    const t = setTimeout(() => setSplashHeld(false), 4400);
    return () => clearTimeout(t);
  }, []);
  const didHydrate = useRef(false);
  // client workout ref ("0-0") → server workout GUID; the log/move endpoints key on
  // the GUID. Populated from every plan response (hydrate / create / replace).
  const [refToId, setRefToId] = useState({});
  const [view, setView] = useState('today');
  const [detail, setDetail] = useState(null);
  // The what-if simulator sheet: null, {} (generic, from Progress), or
  // { initial: { tab, skipIds, skipLabel } } from a workout's own sheet.
  const [whatIf, setWhatIf] = useState(null);
  const [editFitness, setEditFitness] = useState(false);
  const [editPlan, setEditPlan] = useState(false);
  const [building, setBuilding] = useState(false);
  const [wurm, setWurm] = useState(false);
  const [wellness, setWellness] = useState(() => storage.loadWellness());
  const [editWellness, setEditWellness] = useState(false);
  const saveWellness = rec => { setWellness(storage.upsertWellness(rec)); sync.saveWellness(rec); setEditWellness(false); };
  // Morning check-in: one tap a day, kept in its own store (the server sync is
  // authoritative per date and would clobber a field it doesn't know) and merged
  // into the records at read time, so it scores immediately and rides along in
  // that day's calibration snapshots.
  const [feels, setFeels] = useState(() => storage.loadFeels());
  const answerFeel = v => setFeels(storage.saveFeel(T.iso(new Date()), v));
  const [adjust, setAdjust] = useState(() => storage.load('adjust', {}));
  // Read-time overlays on the server-shaped wellness store: the morning
  // check-in answers, then Fitness/Fatigue/Form derived from the logged
  // sessions wherever measured data is absent or stale, so the charts,
  // readiness factors and engine phases work without intervals.icu. Neither
  // overlay is ever stored or synced. Memoised because the derivation walks
  // the whole plan; renders happen on state change, so staleness matches deps.
  const [activities, setActivities] = useState(null); // recent watch activities (null until loaded / not connected)
  // Manually logged sessions (the tracker diary): stored per device, merged
  // into the feed SHAPE for display and load, never into `activities` itself —
  // the raw feed alone drives connected/spotted/eFTP/brick matching, so a
  // manual entry can never claim to be watch data.
  const [manualActs, setManualActs] = useState(() => storage.loadManualActivities());
  const displayActivities = useMemo(() => T.mergeActivities(activities, manualActs), [activities, manualActs]);
  // The plan-independent athlete profile (Phase 2, docs/NO_PLAN_WORKFLOW.md):
  // the between-plans source of truth, mirrored to /api/me/profile on every
  // change. plan.profile stays the in-plan mirror while a plan exists; this
  // store is what survives when the plan ends. The LOCAL copy is the full
  // profile; the server keeps its plan-independent subset and ignores the
  // race fields we send. Deliberately not in storage.clear(): the profile
  // spans plans, like the calibration and manual diaries.
  const [profileStore, setProfileStore] = useState(() => storage.load('profile', null));
  const saveProfileBoth = profile => {
    if (!profile) return;
    setProfileStore(profile);
    storage.save('profile', profile);
    sync.saveProfile(profile);
  };
  const recs = useMemo(() => T.withLogLoad(T.wellness.mergeFeel(wellness, feels),
    { plan, log, moves, adjust, activities: displayActivities, todayISO: T.iso(new Date()) }),
    [wellness, feels, plan, log, moves, adjust, displayActivities]);
  // Activity fetches are guarded by a sequence counter: the shallow mount fetch
  // and a deep tracker fetch can race, and last-write-wins would let a late
  // 10-day response clobber the 6-month diary.
  const actSeq = useRef(0);
  const fetchActivities = days => {
    const seq = ++actSeq.current;
    sync.loadActivities(days).then(a => { if (a && seq === actSeq.current) setActivities(a); });
  };
  const [thresholds, setThresholds] = useState(null); // intervals.icu per-sport thresholds (fitness watcher)
  // A failed plan write means this device and the account have diverged — the
  // catalog-drift incident proved that must never be silent again.
  const [planSyncFailed, setPlanSyncFailed] = useState(false);
  const [addOpen, setAddOpen] = useState(null);    // "Add a session" sheet: null | { disc, dateISO } (Today passes {}, calendar cards preselect; tracker routes it to the manual-log flavour)
  const [manualDetail, setManualDetail] = useState(null); // stored manual entry being edited (second-and-later taps on a Logged row)
  const [recap, setRecap] = useState(null);        // session recap slides (workout whose recording just landed)
  // Support library: which topic is open, and where to return to when leaving
  // (charts on any tab deep-link in via openSupport).
  const [supportTopic, setSupportTopic] = useState(null);
  const supportReturn = useRef('settings');
  const [watchSync, setWatchSync] = useState(() => storage.load('watchSync', false));
  const [watchPush, setWatchPush] = useState(null); // last reconcile result, for the Settings card
  const toggleWatchSync = on => {
    setWatchSync(on);
    storage.save('watchSync', on);
    // Forget the last pushed payload so re-enabling always reconciles afresh.
    if (!on) storage.save('watchPushed', null);
  };

  // Overlays as the async plan-response handlers must see them — a .then()
  // closure only holds the render it was created in.
  const live = useRef(null);
  live.current = { log, moves, adjust, pendingMoves, refToId, plan };
  // Adopt the fresh ref→GUID map from a plan create/replace response, then push
  // any overlay entries created while the old map was stale — their optimistic
  // sync was skipped (gid() was undefined), so the server never saw them and
  // the next hydrate would drop them.
  // Adopt a plan write's response ({ refToId, planId } | null): the ref map
  // via adoptMap, and the plan's server GUID stamped onto the LOCAL plan
  // object — but only when it is still the same plan that was saved (the
  // createdAt nonce), and only from a SUCCESSFUL response, so a failed save
  // can never tag a plan with a stale id and a late response can never tag a
  // successor plan (re-verify catches, 2026-07-17). The id lives ON the plan:
  // cached, cleared and replaced atomically with it, never a separate key.
  // Each plan write gets a monotonic token; only the LATEST write's response
  // may adopt. createdAt alone cannot tell two rapid writes to the same plan
  // apart (retarget/reshape preserve it by design), and the serial queue
  // guarantees response1 lands before request2 even dispatches — so without
  // the token, a superseded response briefly installed a wrong-structure ref
  // map (convergence-gate catch 2026-07-18).
  const writeSeq = useRef(0);
  const adoptRes = nonce => {
    const tok = ++writeSeq.current;
    return res => {
      if (tok !== writeSeq.current) return; // a newer write owns the state now
      const cur = live.current.plan;
      if (!cur || cur.createdAt !== nonce) return;
      if (cur.race === 'tracker') {
        // The plan this save belongs to was ENDED locally while the save was
        // in flight (buildTrackerPlan preserves createdAt, so the nonce still
        // matches). The row now exists server-side with a known id: finish
        // the end — the serial queue orders this DELETE after the create —
        // and record it on the sentinel so the hydrate seam can verify it.
        // Never adopt a plan's ref map onto a sentinel.
        if (res && res.planId != null) {
          sync.endPlan(res.planId);
          setPlan(p => (p && p.createdAt === nonce && p.race === 'tracker')
            ? { ...p, endedServerId: res.planId } : p);
        }
        return;
      }
      adoptMap(res ? res.refToId : null);
      if (res && res.planId != null) {
        setPlan(p => (p && p.createdAt === nonce && p.serverId !== res.planId)
          ? { ...p, serverId: res.planId } : p);
      }
    };
  };
  const adoptMap = map => {
    if (!map) { setPlanSyncFailed(true); return; }
    setPlanSyncFailed(false);
    const cur = live.current;
    sweepStale(cur.log, cur.refToId, map, (g, e) => sync.saveLog(g, e));
    // Moves: only this device's pending writes are swept — the moves cache is
    // never authoritative (see mergeMoves). Entries are { date, base }; a null
    // date routes to the delete endpoint. The same base-date guard mergeMoves
    // enforces applies here too: a pending write whose workout no longer sits
    // on its recorded base must not ride a plan replace by id alone (every
    // current replace path clears pending first, but the guard keeps a future
    // path from re-opening the id-reuse hole).
    const baseOf = baseDates(cur.plan);
    const validPending = {};
    Object.keys(cur.pendingMoves || {}).forEach(id => {
      const e = cur.pendingMoves[id];
      if (e && baseOf[id] === e.base) validPending[id] = e;
    });
    sweepStale(validPending, cur.refToId, map, (g, e) => (e && e.date === null ? sync.removeMove(g) : sync.saveMove(g, e && e.date)));
    sweepStale(cur.adjust, cur.refToId, map, (g, a) => sync.saveAdjustment(g, a));
    setRefToId(map);
  };

  useEffect(() => { if (plan) storage.save('plan', plan); }, [plan, storage]);
  useEffect(() => { storage.save('log', log); }, [log, storage]);
  useEffect(() => { storage.save('moves', moves); }, [moves, storage]);
  useEffect(() => { storage.save('pendingMoves', pendingMoves); }, [pendingMoves, storage]);
  useEffect(() => { storage.save('adjust', adjust); }, [adjust, storage]);
  useEffect(() => { storage.save('adjustLog', adjustLog); }, [adjustLog, storage]);

  // Engine-adjustments overlay: session ids → their eased (readiness), trimmed
  // (ramp guardrail) or boosted (build nudge) version. The name predates the
  // extra kinds; it applies them all. Declared ABOVE every effect and early
  // return on purpose: an effect that fires on a render which returned early
  // (splash, onboarding, building) finds any const below that return still in
  // its temporal dead zone and throws — the 2026-07-11 and 2026-07-15
  // "something went wrong" field crashes were both exactly that, via this
  // binding. Anything an above-the-returns hook closes over must live up here.
  const easedOf = w => {
    const a = w && adjust[w.id];
    if (!a) return w;
    if (a.kind === 'trim') return T.trimWorkout(w, plan, a.factor || 0.8);
    if (a.kind === 'boost') return T.boostWorkout(w, plan, a.factor || 1.1);
    return T.easeWorkout(w, plan);
  };

  // Workouts-to-watch: while enabled, keep the intervals.icu calendar equal to
  // the upcoming plan (moves and engine adjustments included). The pushed-hash
  // guard makes the reconcile idempotent across loads; the short delay
  // coalesces bursts of changes, e.g. accepting a weekly proposal. The
  // hydrated gate is semantic: never push a stale cached plan the server is
  // about to correct.
  useEffect(() => {
    if (!hydrated || !plan || !watchSync) return;
    const body = T.buildWatchEvents({ plan, moves, easedOf, log, todayISO: T.iso(new Date()) });
    const hash = JSON.stringify(body);
    if (storage.load('watchPushed', null) === hash) {
      setWatchPush({ ok: true, upToDate: true, events: body.events.length, inWindow: body.inWindow, doneInWindow: body.doneInWindow });
      return;
    }
    let stale = false; // a re-run supersedes this push's report (rapid toggle flips)
    const t = setTimeout(() => {
      sync.pushWatchEvents(body).then(r => {
        if (stale) return;
        if (!r) { setWatchPush({ ok: false, notSupported: true }); return; } // 404: no endpoint / not connected
        const ok = !r.failed;
        if (ok) storage.save('watchPushed', hash);
        setWatchPush({ at: new Date().toISOString(), ok, status: r.status || null, events: body.events.length, inWindow: body.inWindow, doneInWindow: body.doneInWindow });
      });
    }, 2000);
    return () => { stale = true; clearTimeout(t); };
  }, [hydrated, plan, moves, adjust, log, watchSync, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount (per user): pull the server's plan graph. The server is the source of
  // truth; localStorage is the offline fallback if it's unreachable.
  useEffect(() => {
    if (didHydrate.current) return;
    didHydrate.current = true;
    let cancelled = false;
    sync.hydrate().then(async result => {
      if (cancelled) return;
      // Phase 2 (docs/NO_PLAN_WORKFLOW.md): server-side, tracker is
      // "no plan + profile". Every branch below is keyed on PLAN IDENTITY
      // (server GUIDs), never on timestamps: a plan is only ever deleted by
      // the id this device decided to end, and a server plan with any OTHER
      // id is someone's real plan and is always adopted.
      const sp = result && result.plan;
      if (plan && plan.race === 'tracker' && sp && sp.race !== 'tracker') {
        if (plan.endedServerId != null && result.planId === plan.endedServerId) {
          // The exact plan this device decided to end — the DELETE never
          // landed (offline at the time). Finish the job idempotently.
          saveProfileBoth(plan.profile);
          sync.endPlan(result.planId);
          setHydrated(true);
          return;
        }
        // A different plan: started elsewhere (or predates the end decision
        // in a way we cannot prove). Adopt it — never delete, never ignore.
        // Falls through to the normal server-plan branch below.
      }
      if (result === 'none') {
        // Signed in but no server plan.
        if (plan && plan.race === 'tracker') {
          // The sentinel is already the correct client representation of
          // "no plan + profile"; just keep the profile up.
          saveProfileBoth(plan.profile);
        } else if (plan && (plan.serverId != null || T.planEnded(plan, T.iso(new Date())))) {
          // This plan was ONCE on the server (id stamped) and is gone now —
          // it was ended on another device — or its own dates are done. Never
          // resurrect it; drop to tracker on its profile. (Caches from before
          // serverId existed can slip this guard once; accepted and documented
          // as a narrow self-healing rollout window — see NO_PLAN_WORKFLOW.)
          saveProfileBoth(plan.profile);
          setPlan(T.buildTrackerPlan(plan, new Date().toISOString()));
          setLog({}); setMoves({}); setPendingMoves({}); setAdjust({});
          fetchActivities(TRACKER_FEED_DAYS);
        } else if (plan) {
          // A real plan the server has never seen (offline creation): migrate
          // it up. The only 'none' case that legitimately creates a plan.
          sync.savePlan(plan).then(adoptRes(plan.createdAt));
        } else {
          // No local plan at all: tracker if a profile exists (the plan was
          // ended on another device), else onboarding.
          const prof = profileStore || await sync.loadProfile();
          if (cancelled) return; // unmount during the /api/me await must not write
          if (prof) {
            storage.save('profile', prof);
            setProfileStore(prof);
            setPlan(T.trackerFromProfile(prof));
            fetchActivities(TRACKER_FEED_DAYS);
          } else setPlan(null);
        }
      } else if (result) {
        const ids = result.refToId || {};
        // One-time idempotent sentinel migration: a server-side tracker plan
        // (synced before Phase 2) becomes "profile up, plan ended"; the local
        // sentinel keeps representing the state.
        if (result.plan.race === 'tracker') {
          const prof = (plan && plan.race === 'tracker' && plan.profile) || result.plan.profile;
          saveProfileBoth(prof);
          sync.endPlan(result.planId);
          setPlan(plan && plan.race === 'tracker' ? plan : T.trackerFromProfile(prof));
          fetchActivities(TRACKER_FEED_DAYS);
          setHydrated(true);
          return;
        }
        const adopted = T.upgradePlanSegments(result.plan);
        if (result.planId != null) adopted.serverId = result.planId;
        setPlan(adopted);
        // keep the standalone profile store warm (local seed; the backend
        // already backfilled its own subset copy from active plans)
        if (!profileStore && adopted.profile) {
          storage.save('profile', adopted.profile);
          setProfileStore(adopted.profile);
        }
        // Merge, don't replace: an entry created while a plan push was still in
        // flight (stale gid → its own push was skipped) or offline exists only
        // locally — wholesale-replacing would silently lose it. The loading
        // screen blocks input until hydration, so the mount-time overlays
        // captured here are current.
        // Drop cached phantom entries (no done/feel/notes) before the merge, or
        // the overlay would treat them as unsynced local logs and push them back.
        const localLog = {};
        Object.keys(log).forEach(k => { const e = log[k]; if (e && (e.done || e.feel || e.notes)) localLog[k] = e; });
        setLog(mergeOverlay(result.log, localLog, ids, (g, e) => sync.saveLog(g, e)));
        // Moves: server wins outright; only this device's pending writes are
        // applied and re-pushed. The old mergeOverlay path pushed ANY cached
        // local-only move back up, and because workout ids are reused across
        // plan regenerations those stale moves landed on the wrong workouts.
        setMoves(mergeOverlay(result.moves, moves, ids, (g, d) => sync.saveMove(g, d)));
        setRefToId(ids);
        // Adjustments sync only once the backend supports them; an empty result
        // means "unknown", so the local overlay is kept rather than wiped.
        if (result.adjust && Object.keys(result.adjust).length) setAdjust(mergeOverlay(result.adjust, adjust, ids, (g, a) => sync.saveAdjustment(g, a)));
      } // result === null → offline/error: keep the cache already loaded
      setHydrated(true);
    });
    // Wellness syncs separately (keyed by date, independent of the plan). The
    // refresh pulls from intervals.icu first when connected (plain GET otherwise),
    // then we merge server + local (server wins per date) and migrate any
    // local-only days up.
    sync.refreshWellness().then(serverRecs => {
      if (cancelled || !serverRecs) return; // null → offline/error, keep local cache
      applyServerWellness(serverRecs);
      // Self-healing history: connected but the fitness record only reaches
      // back a few weeks → quietly deepen it to a year, once. The flag is only
      // set on a successful response, so an offline or not-yet-deployed backend
      // retries next load; a backend that ignores the days window still answers
      // (shallow), which sets the flag and stops a retry loop. Users who
      // connect fresh get the deep pull at connect time instead.
      if (T.wellness.shallowHistory(serverRecs, T.iso(new Date())) && !storage.load('backfilled', false)) {
        sync.backfillWellness().then(deep => {
          if (!deep) return;
          storage.save('backfilled', true);
          if (!cancelled) applyServerWellness(deep);
        });
      }
    });
    // Recent watch activities → the "spotted on your watch" one-tap logging.
    // Tracker mode is a diary, so fetch as far back as its calendar browses
    // instead of the spotting window — otherwise the calendar shows months of
    // false blanks. (Sequence-guarded via fetchActivities against the deep
    // refetch that entering tracker fires.)
    fetchActivities(plan && plan.race === 'tracker' ? TRACKER_FEED_DAYS : undefined);
    sync.loadThresholds().then(t => { if (!cancelled && t) setThresholds(t); });
    return () => { cancelled = true; };
  }, [sync]); // eslint-disable-line react-hooks/exhaustive-deps -- didHydrate-guarded: runs once

  // Fold a server wellness list into local state + the offline cache (server wins
  // per date; local-only days are pushed up). Also called when the Settings page
  // connects intervals.icu, so the readiness card updates without a reload.
  const applyServerWellness = serverRecs => {
    const local = storage.loadWellness();
    const serverDates = new Set(serverRecs.map(r => r.date));
    local.forEach(r => { if (!serverDates.has(r.date)) sync.saveWellness(r); });
    const byDate = {};
    local.forEach(r => { byDate[r.date] = r; });
    serverRecs.forEach(r => { byDate[r.date] = r; });
    const merged = Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1));
    merged.forEach(r => storage.upsertWellness(r)); // refresh the offline cache
    setWellness(merged);
  };

  // Drop to tracker mode: replace the plan with the no-weeks sentinel, keeping
  // the profile and fitness history. Overlays prune to empty (no workout ids
  // survive), exactly as reshapePlan does against a fresh graph. Defined HERE,
  // above the early returns, because the default-to-no-plan effect below must
  // be an unconditional hook — declaring it after the loading/onboarding
  // returns changed the hook count between renders and crashed the app (the
  // 2026-07-13 gauntlet catch on this feature's first cut).
  const enterTracker = () => {
    const np = T.buildTrackerPlan(plan, new Date().toISOString());
    // Remember WHICH server plan this decision ends: if the DELETE below never
    // lands (offline), the next hydrate finishes the job — but only when the
    // server still holds this exact id. Any other id is someone's real plan.
    np.endedServerId = plan.serverId != null ? plan.serverId : null;
    setLog({}); setMoves({}); setPendingMoves({}); setAdjust({});
    // Stale workout GUIDs from the ended plan must not resolve for the next
    // plan's reused positional ids (the onRegenerate lesson): a truthy-but-
    // wrong gid() pushes at dead rows AND stops sweepStale's later re-push.
    setRefToId({});
    setPlan(np);
    setEditPlan(false);
    setPlanSyncFailed(false); // clear any prior real-plan alarm; tracker never raises it
    // The diary needs depth the spotting window doesn't: refetch the feed to
    // match the tracker calendar's browsable range.
    fetchActivities(TRACKER_FEED_DAYS);
    // Phase 2 (docs/NO_PLAN_WORKFLOW.md): server-side, tracker is "no plan +
    // profile". Snapshot the profile up and END the exact plan this session
    // was using — the sentinel above is client-only and is never pushed. A
    // never-synced plan (no serverId) has nothing to delete. Both calls are
    // fire-and-forget: offline, local state is already right and the hydrate
    // seam reconciles via endedServerId. The watch-push effect sees the
    // zero-week plan and clears the scheduled events window on its own.
    saveProfileBoth(np.profile);
    if (plan.serverId != null) sync.endPlan(plan.serverId);
  };
  // Default-to-no-plan (docs/NO_PLAN_FLOW.md): a plan whose last day has passed
  // ends into tracker mode unless the user already started a new one. Gated on
  // hydration so a stale cached plan never transitions before the server view
  // arrives (the server may hold a newer plan from another device); after the
  // transition plan.race is 'tracker', so the re-run is a no-op. The banners
  // (post-race, maintenance horizon) keep their window: planEnded stays false
  // through the race plan's post-race grace days.
  useEffect(() => {
    if (!hydrated || !plan) return;
    if (T.planEnded(plan, T.iso(new Date()))) enterTracker();
  }, [hydrated, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Splash while hydrating: the same shared screen the auth gate shows while
  // the session loads, so startup is ONE screen. Held for at least one pulse.
  if (!hydrated || splashHeld) return <Splash />;
  if (!plan) return <Onboarding onCreate={p => { const w = [...recs].reverse().find(r => r.weightKg); const np = T.generatePlan(w ? { ...p, weightKg: Math.round(w.weightKg * 10) / 10 } : p); setPlan(np); setView('today'); setBuilding(true); saveProfileBoth(np.profile); sync.savePlan(np).then(adoptRes(np.createdAt)); }} />;
  if (building) return <BuildingPlan plan={plan} onDone={() => setBuilding(false)} />;

  // Resolve our client ref → server workout GUID for the log/move endpoints; skip
  // the push (local-only) if the plan hasn't synced a GUID for it yet.
  const gid = id => refToId[id];
  // Calibration capture: when a session is completed (and again when its feel is
  // rated), snapshot the readiness inputs for that day next to the outcome —
  // stored locally (append-only) and embedded in the synced log's notes field.
  const observe = (id, feel, at, actualMin) => {
    const w = plan.weeks.flatMap(wk => wk.workouts).find(x => x.id === id);
    if (!w || w.discipline === 'rest') return null;
    const obs = buildObservation({
      workout: w, date: effDate(w, moves), feel, eased: !!adjust[id], wellnessRecs: recs, at, actualMin,
    });
    storage.upsertCalibration(obs);
    return toNote(obs);
  };
  // The recorded moving time for a session, when a matching watch activity
  // exists — feeds the derived load model and the completed-load bars with what
  // actually happened rather than what was planned. Rides along in the synced
  // calibration note, so it survives hydrate on any device.
  // Bricks resolve to a ride+run PAIR, folded into one combined recording (no
  // distance — summing km across two sports would render a misleading pace);
  // the link opens the ride leg. Everything else resolves to its single match.
  const recordingFor = w => {
    if (!w) return null;
    if (w.discipline === 'brick') {
      const pair = T.brickPairFor({ workout: w, activities, moves });
      if (!pair) return null;
      const rpes = [pair.ride.rpe, pair.run.rpe].filter(v => v != null);
      const load = (pair.ride.trainingLoad != null || pair.run.trainingLoad != null)
        ? (pair.ride.trainingLoad || 0) + (pair.run.trainingLoad || 0) : null;
      return {
        id: pair.ride.id, date: pair.ride.date, type: 'Ride', name: 'Brick — ride + run legs',
        movingTimeSec: pair.ride.movingTimeSec + pair.run.movingTimeSec,
        trainingLoad: load, rpe: rpes.length ? Math.max(...rpes) : null,
      };
    }
    return T.activityFor({ workout: w, activities, moves });
  };
  const actualFor = w => {
    const a = recordingFor(w);
    return a ? Math.round(a.movingTimeSec / 60) : undefined;
  };
  const toggle = id => {
    if (log[id]) {
      const w = plan.weeks.flatMap(wk => wk.workouts).find(x => x.id === id);
      setLog(l => { const n = { ...l }; delete n[id]; return n; });
      if (w) storage.removeCalibration(id, effDate(w, moves));
      if (gid(id)) sync.removeLog(gid(id));
    } else {
      const w = plan.weeks.flatMap(wk => wk.workouts).find(x => x.id === id);
      const at = new Date().toISOString();
      const actualMin = actualFor(w);
      const entry = { done: true, at, actualMin, notes: observe(id, null, at, actualMin) };
      setLog(l => ({ ...l, [id]: entry }));
      if (gid(id)) sync.saveLog(gid(id), entry);
      if (actualMin && w) {
        // a recording landed with the tick → celebrate + consequence. The
        // fourth recap doorway, and it must mark seen like the other three
        // or the deck replays forever (gauntlet catch, 2026-07-16).
        markRecapSeen(recordingFor(w));
        setRecap({ workout: w });
      }
    }
  };
  // Tap a row in the Recorded card → open the in-app recap deck rather than
  // bouncing out to intervals.icu. Matched recordings recap against their
  // planned session; an unplanned activity gets a lightweight ad-hoc workout
  // synthesised from itself, so the wrapped-style deck still shows what you did
  // (no plan-relative verdicts — reviewActivity skips those when adhoc).
  // The wrapped recap is a one-time celebration per recording: the first tap
  // plays the deck, every later tap opens the session overview instead, which
  // carries a replay link (Jon, 2026-07-16). Seen ids persist per device,
  // pruned to the newest hundred.
  const markRecapSeen = (a, preloaded) => {
    if (!a || !a.id) return;
    const seen = preloaded || storage.load('recapSeen', {});
    if (seen[a.id]) return;
    const next = { ...seen, [a.id]: new Date().toISOString() };
    const ids = Object.keys(next);
    if (ids.length > 120) {
      ids.sort((x, y) => (next[x] < next[y] ? -1 : 1)).slice(0, ids.length - 100)
        .forEach(id => delete next[id]);
    }
    storage.save('recapSeen', next);
  };
  // The manual diary's write path. Load is machine-estimated at save time and
  // frozen (estimateTss keys on the library type the athlete picked); feel is
  // descriptive only and never folds into the number.
  const logManualActivity = spec => {
    const sameDay = displayActivities.some(a => a && a.date === spec.dateISO
      && T.DISCIPLINE[a.type] === spec.discipline);
    if (sameDay && !confirm('You already have a ' + spec.discipline + ' session on '
      + T.fmtDate(spec.dateISO, { weekday: 'short', month: 'short', day: 'numeric' }) + '. Log this one too?')) return;
    const entry = {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      date: spec.dateISO, sport: spec.discipline, sessionType: spec.type,
      durationMin: spec.durationMin,
      trainingLoad: Math.round(T.estimateTss({ durationMin: spec.durationMin, type: spec.type })),
      feel: spec.feel || null, createdAt: new Date().toISOString(), editedAt: null,
    };
    setManualActs(storage.upsertManualActivity(entry));
    setAddOpen(null);
  };
  const saveManualEdit = (id, spec) => {
    const prev = manualActs.find(e => e.id === id);
    if (!prev) { setManualDetail(null); return; }
    // Same speed bump as creation: an edit that moves the entry onto a day
    // that already holds a session of the same sport asks first — excluding
    // the entry's own current slot (gauntlet catch).
    const sameDay = displayActivities.some(a => a && a.manualId !== id && a.date === spec.dateISO
      && T.DISCIPLINE[a.type] === spec.discipline);
    if (sameDay && (prev.date !== spec.dateISO || prev.sport !== spec.discipline)
      && !confirm('You already have a ' + spec.discipline + ' session on '
        + T.fmtDate(spec.dateISO, { weekday: 'short', month: 'short', day: 'numeric' }) + '. Keep this change?')) return;
    const entry = {
      ...prev, date: spec.dateISO, sport: spec.discipline, sessionType: spec.type,
      durationMin: spec.durationMin,
      trainingLoad: Math.round(T.estimateTss({ durationMin: spec.durationMin, type: spec.type })),
      feel: spec.feel || null, editedAt: new Date().toISOString(),
    };
    setManualActs(storage.upsertManualActivity(entry));
    setManualDetail(null);
  };
  const removeManual = id => { setManualActs(storage.removeManualActivity(id)); setManualDetail(null); };
  const openRecording = arg => {
    if (!arg) return;
    // Carry the tapped activity through when the row supplied one, so a matched
    // recap opens the exact recording tapped rather than re-deriving the
    // closest-to-plan match. Bricks pass no activity and re-build their pair.
    if (arg.workout) {
      const a = arg.activity || recordingFor(arg.workout);
      const seen = storage.load('recapSeen', {});
      if (a && seen[a.id]) { setDetail(arg.workout); return; }
      markRecapSeen(a, seen);
      setRecap({ workout: arg.workout, activity: arg.activity || null });
      return;
    }
    const a = arg.activity;
    if (!a || !a.movingTimeSec) return;
    const disc = T.DISCIPLINE[a.type] || 'bike';
    // A manual entry celebrates ONCE like any recording, then every later tap
    // opens the edit sheet — the natural second action on your own entry is
    // fixing it, not replaying slides.
    if (a.manual) {
      const seen = storage.load('recapSeen', {});
      if (seen[a.id]) {
        const stored = manualActs.find(e => e.id === a.manualId);
        if (stored) setManualDetail(stored);
        return;
      }
      markRecapSeen(a, seen);
      setRecap({
        // type filled so the review's steady/easy-intent verdicts can key on
        // the library session the athlete picked; adhoc skips plan-relative ones
        workout: { id: 'adhoc-' + a.id, adhoc: true, type: a.name, title: a.name, discipline: disc, durationMin: Math.round(a.movingTimeSec / 60) },
        activity: a,
      });
      return;
    }
    markRecapSeen(a);
    setRecap({
      workout: {
        id: 'adhoc-' + a.id, adhoc: true,
        title: a.name || (T.DISCIPLINES[disc] && T.DISCIPLINES[disc].name) || 'Session',
        discipline: disc, durationMin: Math.round(a.movingTimeSec / 60),
      },
      activity: a,
    });
  };
  const moveWorkout = (id, date) => {
    setMoves(m => { const n = { ...m }; if (date === null) delete n[id]; else n[id] = date; return n; });
    if (gid(id)) { if (date === null) sync.removeMove(gid(id)); else sync.saveMove(gid(id), date); }
  };
  // Re-target the plan from updated fitness. Same level/days/race → identical
  // week/day IDs, so the log & moves overlays stay valid; only paces change.
  // Latest synced weight rides into the profile at every (re)generation so the
  // weakest-link bike score (W/kg) has something honest to stand on.
  const withWeight = p => {
    const w = [...recs].reverse().find(r => r.weightKg);
    return w ? { ...p, weightKg: Math.round(w.weightKg * 10) / 10 } : p;
  };
  const retarget = fields => {
    const old = plan.profile;
    const snapshot = { date: T.iso(new Date()), fivekSec: old.fivekSec, css100Sec: old.css100Sec, ftp: old.ftp, fitness: old.fitness };
    const profile = withWeight(Object.assign({}, old, fields, { fitnessHistory: (old.fitnessHistory || []).concat([snapshot]) }));
    // Hold the frequency-swap verdict steady: a retarget keeps the structure,
    // and a flipped verdict would change disciplines at ids the log joins on.
    // The verdict is DETECTED from the plan's own weeks, not read from the
    // limiterSwap stamp: the backend's typed plan DTO drops the stamp on
    // every hydrate, and trusting it silently un-swapped a reloaded plan on
    // its next retarget (re-verify catch). Legacy and unswapped plans detect
    // to null: no swap appears mid-flight.
    const np = T.generatePlan(profile, { lockedSwap: T.detectLimiterSwap(plan) });
    np.createdAt = plan.createdAt;
    np.updatedAt = new Date().toISOString();
    np.serverId = plan.serverId; // same server row: replace updates in place
    setPlan(np);
    sync.replacePlan(np).then(adoptRes(np.createdAt));
    saveProfileBoth(np.profile); // the standalone profile mirrors every retarget
  };
  // In tracker mode a fitness update must NOT generate a plan: it snapshots
  // history, refreshes the numbers and paces, and the sentinel stays a
  // sentinel (Phase 0 of docs/NO_PLAN_WORKFLOW.md — the benchmark window).
  const updateFitness = fields => {
    if (plan.race === 'tracker') {
      const np = T.applyTrackerFitness(plan, fields, new Date().toISOString());
      np.profile = withWeight(np.profile);
      setPlan(np);
      // Phase 2: tracker state syncs as the PROFILE, never as a plan push.
      saveProfileBoth(np.profile);
    } else retarget(fields);
    setEditFitness(false);
  };
  const applyTune = () => { const s = paceSuggestions(plan, log); if (s.length) retarget(tuneFields(plan.profile, s)); };
  const setFeel = (id, feel) => {
    const at = (log[id] && log[id].at) || new Date().toISOString();
    // Rebuilding the note must carry the entry's recorded duration forward —
    // omitting it once wrote actualMin:null into the synced note and silently
    // erased the measurement on every other device (2026-07-12 audit finding).
    const entry = Object.assign({}, log[id], { done: true, at, feel, notes: observe(id, feel, at, (log[id] || {}).actualMin) });
    setLog(l => ({ ...l, [id]: entry }));
    if (gid(id)) sync.saveLog(gid(id), entry);
  };
  const todaysHard = () => { const t = T.iso(new Date()); return plan.weeks.flatMap(wk => wk.workouts).filter(w => effDate(w, moves) === t && INTENSITY_TYPES[w.type] && !w.race); };
  const easeToday = () => {
    const hard = todaysHard(); if (!hard.length) return;
    const at = new Date().toISOString();
    setAdjust(a => { const n = { ...a }; hard.forEach(w => n[w.id] = { kind: 'ease', at }); return n; });
    hard.forEach(w => { if (gid(w.id)) sync.saveAdjustment(gid(w.id), { kind: 'ease', easedFrom: w.type, at }); });
  };
  const restoreToday = () => {
    const t = T.iso(new Date());
    const todaysIds = plan.weeks.flatMap(wk => wk.workouts).filter(w => effDate(w, moves) === t).map(w => w.id);
    setAdjust(a => { const n = { ...a }; todaysIds.forEach(id => delete n[id]); return n; });
    todaysIds.forEach(id => { if (adjust[id] && gid(id)) sync.removeAdjustment(gid(id)); });
  };
  const unEase = id => {
    setAdjust(a => { const n = { ...a }; delete n[id]; return n; });
    if (gid(id)) sync.removeAdjustment(gid(id));
  };
  // The engine's structural proposal (one banner): race-day form targeting
  // (Phase 4) outranks the week rules (Phases 2-3) — inside the final fortnight
  // the taper is the thing that matters. Accepting lands trim/boost/ease entries
  // in the same adjust overlay (and sync), so calendar, sheet and undo just work.
  const engineInputs = { wellness: recs, plan, log, moves, adjust, todayISO: T.iso(new Date()) };
  const weekly = T.proposeRace(engineInputs) || T.proposeWeek(engineInputs);
  // Recovery timeline: speaks only from the high-risk form zone (null otherwise).
  const recovery = T.projectRecovery(engineInputs);
  // proposeWeek already walks this each render; matches recovery above. In
  // tracker mode the diary (feed + manual) carries the run history instead of
  // the plan-scoped log, so the athlete strip's run tile stays honest.
  const runLoad = plan.race === 'tracker'
    ? T.runLoadFromActivities({ activities: displayActivities, todayISO: T.iso(new Date()) })
    : T.runLoadSignal(engineInputs);
  // Completed sessions spotted on the watch → one-tap logging (with the
  // athlete's recorded RPE as the feel, and a calibration observation each).
  const spotted = T.matchActivities({ activities, plan, log, moves, todayISO: T.iso(new Date()) });
  // eFTP watcher: dormant until the backend passes eftp through on activities.
  const eftp = T.eftpProposal({ activities, thresholds, plan, todayISO: T.iso(new Date()) });
  const applyEftp = () => { if (eftp) retarget(eftp.retarget); };
  const logSpotted = () => {
    const at = new Date().toISOString();
    const entries = {};
    spotted.forEach(m => {
      const secs = (m.activity && m.activity.movingTimeSec || 0) + (m.activityRun && m.activityRun.movingTimeSec || 0);
      const actualMin = secs ? Math.round(secs / 60) : undefined;
      const entry = { done: true, at, feel: m.feel, actualMin, notes: observe(m.workout.id, m.feel || null, at, actualMin) };
      entries[m.workout.id] = entry;
      if (gid(m.workout.id)) sync.saveLog(gid(m.workout.id), entry);
    });
    setLog(l => ({ ...l, ...entries }));
    if (spotted.length) {
      markRecapSeen(recordingFor(spotted[0].workout));
      setRecap({ workout: spotted[0].workout }); // recap the headline session
    }
  };
  // Every accepted proposal is journalled with the exact headline and why
  // the athlete tapped, so the weekly digest can quote — never re-derive —
  // the reasoning later. Capped so the key can't grow without bound.
  // The SAME timestamp goes on the journal entry and the overlay entries it
  // produced: the digest dedupes overlay rows against journal rows by `at`,
  // and two separate Date constructions would differ by milliseconds and
  // render an accepted proposal twice (quoted AND generic).
  const journalProposal = (p, at) => setAdjustLog(l =>
    [...l, { at, kind: p.kind, headline: p.headline, why: p.why }].slice(-40));
  const applyWeekly = p => {
    if (!p) return;
    const at = new Date().toISOString();
    journalProposal(p, at);
    if (p.action === 'restoreWeek') {
      setAdjust(a => { const n = { ...a }; p.targets.forEach(id => delete n[id]); return n; });
      p.targets.forEach(id => { if (adjust[id] && gid(id)) sync.removeAdjustment(gid(id)); });
      return;
    }
    const all = plan.weeks.flatMap(wk => wk.workouts);
    const kind = p.action === 'boostWeek' ? 'boost' : 'trim';
    setAdjust(a => {
      const n = { ...a };
      p.targets.forEach(id => { n[id] = { kind, factor: p.factor, at }; });
      (p.ease || []).forEach(id => { n[id] = { kind: 'ease', at }; });
      return n;
    });
    p.targets.forEach(id => { if (gid(id)) sync.saveAdjustment(gid(id), { kind, factor: p.factor, at }); });
    (p.ease || []).forEach(id => {
      const w = all.find(x => x.id === id);
      if (gid(id)) sync.saveAdjustment(gid(id), { kind: 'ease', easedFrom: w && w.type, at });
    });
  };
  // Rebuild the plan after a race/schedule change. This reshapes the structure:
  // completions are pruned to surviving ids (past ticks stay), while moves and
  // engine adjustments — annotations on the OLD structure — clear wholesale
  // (fitness/history carry over on the profile).
  const reshapePlan = fields => {
    const fromTracker = plan.race === 'tracker';
    const profile = withWeight(Object.assign({}, plan.profile, fields));
    const np = T.generatePlan(profile);
    // From tracker this is a brand-NEW plan: fresh identity (its own
    // createdAt nonce, no serverId — the old row was ended). From a real
    // plan it is a reshape of the same server row.
    if (!fromTracker) {
      np.createdAt = plan.createdAt;
      if (plan.updatedAt) np.updatedAt = plan.updatedAt;
      np.serverId = plan.serverId;
    }
    // Ids are positional, so surviving-id pruning alone let a completed
    // swim's tick re-attach to whatever run now sits at the same id (sim
    // catch 2026-07-17 — the same reuse hazard the moves/adjust comment below
    // describes). A tick survives only when the id still means the SAME
    // session: same discipline on the same date.
    const oldById = {};
    plan.weeks.flatMap(w => w.workouts).forEach(w => { oldById[w.id] = w; });
    const survives = {};
    np.weeks.flatMap(w => w.workouts).forEach(w => {
      const o = oldById[w.id];
      if (o && o.discipline === w.discipline && o.date === w.date) survives[w.id] = 1;
    });
    setLog(l => { const n = {}; Object.keys(l).forEach(id => { if (survives[id]) n[id] = l[id]; }); return n; });
    // Moves and engine adjustments are annotations on a specific STRUCTURE, and
    // workout ids are reused across regenerations — so pruning them by
    // surviving id is a no-op that lets old-structure moves land on the new
    // plan's different workouts (the "workouts moved without me" report).
    // Clear them wholesale; completions above stay, per the documented intent.
    setMoves({});
    setAdjust({});
    setRefToId({}); // regenerated id space: no stale GUID may resolve meanwhile
    setPlan(np);
    setEditPlan(false);
    // From tracker: CREATE. The sync layer serialises plan lifecycle writes,
    // so this POST cannot start until the enterTracker DELETE has settled —
    // without that ordering the 409→PUT fallback reused the dying row's id
    // and the late DELETE destroyed the brand-new plan (gauntlet critical,
    // reproduced 2026-07-18). From a real plan: replace the same row.
    (fromTracker ? sync.savePlan(np) : sync.replacePlan(np)).then(adoptRes(np.createdAt));
    saveProfileBoth(np.profile);
  };
  const endPlanToTracker = () => { if (confirm('End your plan and just track? Your fitness history is kept.')) enterTracker(); };
  // User-added sessions: first-class plan workouts (flagged custom), persisted
  // through the same plan replace as retargets — server preserves logs by ref.
  const addWorkout = spec => {
    const r = T.addCustomWorkout(plan, Object.assign({ dateISO: T.iso(new Date()) }, spec));
    setPlan(r.plan);
    setAddOpen(null);
    // adoptRes sweeps for a quick-complete raced against this replace: the new
    // workout's log lands once its GUID is known instead of staying local-only.
    sync.replacePlan(r.plan).then(adoptRes(r.plan.createdAt));
  };
  const removeWorkout = id => {
    const np = T.removeCustomWorkout(plan, id);
    setPlan(np);
    setDetail(null);
    setLog(l => { const n = { ...l }; delete n[id]; return n; });
    setMoves(m => { const n = { ...m }; delete n[id]; return n; });
    setAdjust(a => { const n = { ...a }; delete n[id]; return n; });
    sync.replacePlan(np).then(adoptRes(np.createdAt));
  };

  const openSupport = topic => {
    if (view !== 'support' && view !== 'readinessInfo') supportReturn.current = view;
    if (topic === 'readiness') { setView('readinessInfo'); return; } // its own explainer
    setSupportTopic(topic || null);
    setView('support');
  };

  const tracker = plan.race === 'tracker';
  const race = T.RACES[plan.race];
  const rawDaysToRace = T.daysBetween(new Date(), plan.profile.raceDate);
  const daysToRace = Math.max(0, rawDaysToRace);
  // The plan's edges: race day passed → offer a maintenance block (with a
  // recovery week baked in); a maintenance block near its horizon → offer to
  // roll another. Both reshape the plan, pruning overlays to the new graph.
  const rollMaintenance = postRace => {
    const mon = T.startOfWeekMonday(new Date());
    reshapePlan({
      raceType: 'maintenance', postRace,
      startDate: T.iso(mon), raceDate: T.iso(T.addDays(mon, 12 * 7 - 1)), horizonWeeks: 12,
    });
  };
  let planEdge = null;
  if (!tracker && plan.race !== 'maintenance' && rawDaysToRace < 0) planEdge = {
    key: 'post-race', icon: 'trophy',
    title: 'Race day is behind you — congratulations!',
    sub: 'Recover well, then keep the engine ticking. Tap to start a 12-week maintenance block →',
    act: () => rollMaintenance(true),
  };
  else if (plan.race === 'maintenance' && rawDaysToRace <= 14) planEdge = {
    key: 'extend', icon: 'flame',
    title: 'Your maintenance block is nearly done',
    sub: 'Tap to roll another 12 weeks — or pick your next race in Settings →',
    act: () => rollMaintenance(false),
  };

  // Settings/profile now lives behind the avatar (top-left), Runna-style — off the
  // bottom nav, which stays focused on training.
  const tabs = [
    ['today', 'today', 'Today'], ['calendar', 'calendar', 'Calendar'],
    ['plan', 'plan', 'Plan'], ['progress', 'progress', 'Progress'],
  ];
  const avatarUrl = user && user.imageUrl;
  const initial = ((plan.profile.name || 'A').trim()[0] || 'A').toUpperCase();

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-top">
          <button className="avatar-btn" type="button" title="Profile &amp; settings"
            aria-label="Profile and settings" onClick={() => setView('settings')}>
            {avatarUrl ? <img className="avatar" src={avatarUrl} alt="" /> : <span className="avatar avatar-fallback">{initial}</span>}
          </button>
          <h1><Icon name="logo" size={26} /> Try</h1>
        </div>
        {/* No suffix with no plan: the chip below already carries the next-plan
            message, and a third "ready" in three lines read as copy-paste. */}
        <div className="sub">Hi {plan.profile.name}{tracker ? '' : " — let's get to the finish line"}</div>
        <div className="race-chip">{tracker
          ? <span>Ready for your next plan?</span>
          : race.noRace
            ? <><span>Maintenance block</span><b>{Math.max(0, Math.ceil(rawDaysToRace / 7))}</b><span>weeks left</span></>
            : <><span>{race.name} Triathlon</span><b>{daysToRace}</b><span>days to go</span></>}</div>
      </div>

      {planSyncFailed && !tracker && <div className="banner ramp" {...tap(() => sync.replacePlan(plan).then(adoptRes(plan.createdAt)))}>
        <div className="bi"><Icon name="bolt" size={20} /></div>
        <div><div className="bt">Your plan didn't save to your account</div>
          <div className="bs">Changes are only on this device until it syncs. Tap to retry →</div></div>
      </div>}
      {view === 'today' && <TodayView plan={plan} log={log} moves={moves} open={setDetail} onTune={applyTune} wellness={recs} onFeel={answerFeel} onEditWellness={() => setEditWellness(true)} easedOf={easedOf} onEaseToday={easeToday} onRestoreToday={restoreToday} weekly={weekly} onWeekly={applyWeekly} spotted={spotted} onLogSpotted={logSpotted} onAddWorkout={() => setAddOpen({})} eftp={eftp} onEftp={applyEftp} onToggleWorkout={toggle} planEdge={planEdge} onSupport={openSupport} activities={activities} displayActivities={displayActivities} recovery={recovery} onOpenRecording={openRecording} onEditPlan={() => setEditPlan(true)} onEnterTracker={endPlanToTracker} offerTracker={plan.race === 'maintenance' && rawDaysToRace <= 14} adjust={adjust} adjustLog={adjustLog} storage={storage} />}
      {view === 'calendar' && <CalendarView plan={plan} log={log} moves={moves} open={setDetail} easedOf={easedOf} onToggleWorkout={toggle} onMove={moveWorkout} activities={displayActivities} onOpenRecording={openRecording} onAddWorkout={(disc, dateISO) => setAddOpen({ disc, dateISO })} />}
      {view === 'plan' && <PlanView plan={plan} log={log} moves={moves} open={setDetail} easedOf={easedOf} onToggleWorkout={toggle} onSupport={openSupport} onEditPlan={() => setEditPlan(true)} onStartMaintenance={() => rollMaintenance(false)} />}
      {view === 'progress' && <ProgressView plan={plan} log={log} wellness={recs} runLoad={runLoad} recovery={recovery} onSupport={openSupport} onWhatIf={tracker ? null : () => setWhatIf({})} />}
      {view === 'settings' && <SettingsView plan={plan}
        onEditFitness={() => setEditFitness(true)}
        onEditPlan={() => setEditPlan(true)}
        onEnterTracker={endPlanToTracker} tracker={tracker}
        onRegenerate={() => { if (confirm('Start a new plan? Your current plan will be replaced.')) {
          // The component never unmounts (plan-null renders Onboarding from
          // inside App), so EVERY overlay must be reset in state, not just in
          // storage — leftover in-memory pending moves or adjustments would
          // resurrect onto the new plan through the reused workout ids.
          storage.clear(); setLog({}); setMoves({}); setAdjust({}); setRefToId({}); setPlan(null);
        } }}
        onReset={() => { if (confirm('Clear all completion progress?')) setLog({}); }}
        onExport={() => downloadICS(plan, moves)} onReleaseWurm={() => setWurm(true)}
        onWellnessSynced={applyServerWellness} onSupportHub={() => openSupport(null)}
        watchSync={watchSync} onWatchSync={toggleWatchSync} watchPush={watchPush}
        onExportCalibration={() => downloadCalibration(storage)} calibrationCount={storage.loadCalibration().length} />}
      {view === 'readinessInfo' && <ReadinessInfo onBack={() => setView(supportReturn.current === 'settings' ? 'settings' : 'support')} />}
      {view === 'support' && <SupportView topic={supportTopic} onTopic={setSupportTopic}
        onBack={() => setView(supportReturn.current)} onReadinessInfo={() => setView('readinessInfo')} />}

      {recap && (() => {
        // Only mount with a live recording: activities can refetch under an
        // open recap, and a null activity must degrade to nothing, not a
        // focusless invisible dialog. A matched/planned recap re-derives its
        // activity (surviving refetch); an ad-hoc one carries it explicitly.
        const w = recap.workout;
        const a = recap.activity || recordingFor(w);
        return a ? <RecapSlides workout={w} activity={a} plan={plan} log={log} moves={moves}
          onLoadIntervals={sync.loadActivityIntervals} onLoadRoute={sync.loadActivityRoute} onClose={() => setRecap(null)}
          onDetails={w.adhoc ? null : () => { setRecap(null); setDetail(w); }} /> : null;
      })()}
      {wurm && <WurmReveal onClose={() => setWurm(false)} />}
      {whatIf && <WhatIfSheet plan={plan} log={log} moves={moves} adjust={adjust} wellness={recs}
        todayISO={T.iso(new Date())} initial={whatIf.initial} onClose={() => setWhatIf(null)} />}

      {editFitness && <FitnessEditor profile={plan.profile} noPlan={tracker} onClose={() => setEditFitness(false)} onSave={updateFitness} />}
      {editPlan && <PlanSettingsEditor profile={plan.profile} onClose={() => setEditPlan(false)} onSave={reshapePlan} />}
      {editWellness && <WellnessEditor onClose={() => setEditWellness(false)} onSave={saveWellness} />}

      {detail && <DetailSheet w={easedOf(detail)} plan={plan} done={!!log[detail.id]} eff={effDate(detail, moves)}
        activity={log[detail.id] ? recordingFor(detail) : null}
        feel={(log[detail.id] || {}).feel} onFeel={setFeel}
        onClose={() => setDetail(null)} onToggle={() => toggle(detail.id)}
        onMove={moveWorkout} onResetMove={id => moveWorkout(id, null)} onRestore={() => unEase(detail.id)}
        onLogResult={() => { setDetail(null); setEditFitness(true); }}
        onRemove={detail.custom ? () => removeWorkout(detail.id) : null} onLoadIntervals={sync.loadActivityIntervals} onSupport={t => { setDetail(null); openSupport(t); }}
        onWhatIf={tracker ? null : w => { setDetail(null); setWhatIf({ initial: { tab: 'miss', skipIds: [w.id], skipLabel: w.title || w.type } }); }}
        onReplayRecap={log[detail.id] && recordingFor(detail) ? () => { const w2 = detail; setDetail(null); setRecap({ workout: w2, activity: recordingFor(w2) }); } : null} />}

      {addOpen && <AddWorkoutSheet mode={tracker ? 'log' : 'plan'} initialDisc={addOpen.disc} dateISO={addOpen.dateISO}
        onAdd={tracker ? logManualActivity : addWorkout} onClose={() => setAddOpen(null)} />}
      {manualDetail && <AddWorkoutSheet mode="log" editing={manualDetail}
        onAdd={spec => saveManualEdit(manualDetail.id, spec)}
        onDelete={() => removeManual(manualDetail.id)}
        onClose={() => setManualDetail(null)} />}

      <div className="nav">
        {tabs.map(([k, ic, label]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            <span className="ic"><Icon name={ic} size={22} /></span>{label}</button>
        ))}
      </div>
    </div>
  );
}
