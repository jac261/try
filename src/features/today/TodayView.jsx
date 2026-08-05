import { Fragment, useState, useMemo } from 'react';
import * as T from '@/lib';
import { effDate } from '@/lib/schedule.js';
import { paceSuggestions } from '@/lib/tuning.js';
import { tap } from '@/utils/a11y.js';
import { Icon } from '@/components/Icon.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { WeekCard } from '@/features/today/WeekCard.jsx';
import { ReadinessCard } from '@/features/wellness/ReadinessCard.jsx';
import { RecordedActivities } from '@/components/RecordedActivities.jsx';
import { WeeklyDigest } from '@/features/today/WeeklyDigest.jsx';
import { RaceWeekCard } from '@/features/today/RaceWeekCard.jsx';
const D = T.DISCIPLINES;

// A rejected weekly proposal stays rejected while its SIGNATURE (kind, week,
// targets) is unchanged: the engine re-derives the same proposal every render,
// so without this the banner returns the moment it is dismissed. A materially
// different proposal (new week, new targets, new kind) speaks again.
/* Dismissal keys are PER USER, like every store in storage.js. They were
   browser-global literals, so two accounts on one device shared dismissal
   state: a nudge user A dismissed stayed silent for user B whenever the
   signatures matched — a real coaching signal suppressed for the wrong
   athlete. Reads fall back to the legacy global key once so existing
   dismissals are honoured; writes go to the user key only. */
let DISMISS_NS = 'try.';
const dGet = name => {
  try { return localStorage.getItem(DISMISS_NS + name) ?? localStorage.getItem('try.' + name); }
  catch (e) { return null; }
};
const dSet = (name, v) => { try { localStorage.setItem(DISMISS_NS + name, v); } catch (e) { /* private mode */ } };

const loadWeeklyDismiss = () => dGet('weeklyProposalDismissed');
const saveWeeklyDismiss = v => dSet('weeklyProposalDismissed', v);

// Phase 3b: the CSS retest nudge and the failed-test explanation dismiss the
// same way the weekly proposal does — sticky per signature, so a dismissed
// nudge stays quiet until the situation genuinely changes.
const loadEftpDismiss = () => dGet('eftpProposalDismissed');
const saveEftpDismiss = v => dSet('eftpProposalDismissed', v);
const loadFtpRetestDismiss = () => dGet('ftpRetestDismissed');
const saveFtpRetestDismiss = v => dSet('ftpRetestDismissed', v);
const loadRetestDismiss = () => dGet('cssRetestDismissed');
const saveRetestDismiss = v => dSet('cssRetestDismissed', v);
const loadCssFailDismiss = () => dGet('cssTestFailDismissed');
const loadRunFailDismiss = () => dGet('runTestFailDismissed');
const saveRunFailDismiss = v => dSet('runTestFailDismissed', v);
const saveCssFailDismiss = v => dSet('cssTestFailDismissed', v);
/* The under-built warning's dismissal, in the SAME per-user namespace as its
   siblings. It arrived on a branch cut before that refactor and carried a
   browser-global literal; merging it unchanged would have reintroduced the
   cross-account leak the audit had just closed, for one key. */
const loadShortfallDismiss = () => dGet('startShortfallDismissed');
const saveShortfallDismiss = v => dSet('startShortfallDismissed', v);

export function TodayView({ plan, log, moves, missedReasons, open, onTune, wellness, onFeel, onEditWellness, easedOf, onEaseToday, onRestoreToday, weekly, onWeekly, spotted, onLogSpotted, onAddWorkout, eftp, onEftp, onToggleWorkout, planEdge, onSupport, activities, displayActivities, onOpenRecording, onEditPlan, onEnterTracker, offerTracker, adjust, adjustLog, coachLog, blockReviewed, onBlockReviewed, onFocus, storage, retest, onRetest, cssFail, onFixCss, runFail, onFixRun, ftpRetest, onFtpRetest, startShortfall, onDecision, fuelLog }) {
  // Align the dismissal keys to THIS user before any lazy initialiser runs.
  // They were browser-global, so two accounts on one device shared them.
  DISMISS_NS = (storage && storage.ns) || 'try.';
  const tracker = plan.race === 'tracker';
  const todayISO = T.iso(new Date());
  /* Memoised because a coach-chip tap is a state change that changes no
     input, and it used to re-run all of this — the plan flattened, the
     briefing rebuilt, the pace suggestions recomputed (audit 2026-08-05).
     The dependency lists are the honest inputs, which is what the stable
     easedOf in App exists for: keyed on a fresh arrow these would
     invalidate every render and buy nothing. */
  const all = useMemo(() => plan.weeks.flatMap(w => w.workouts), [plan]);
  const sessions = useMemo(() => all.filter(w => w.discipline !== 'rest' && !w.race), [all]);
  const today = useMemo(() => all.filter(w => effDate(w, moves) === todayISO), [all, moves, todayISO]);
  // The daily briefing (phase 5): pure selector over the plan, same fuelLog
  // the detail sheet reads so the cue numbers agree one tap deeper.
  const briefing = useMemo(() => (tracker ? null : T.todayBriefing({ plan, todayISO, moves, fuelLog, easedOf, log })),
    [tracker, plan, todayISO, moves, fuelLog, easedOf, log]);
  const suggestions = useMemo(() => paceSuggestions(plan, log), [plan, log]);
  const [coachIdx, setCoachIdx] = useState(0);
  const [weeklyDismissed, setWeeklyDismissed] = useState(loadWeeklyDismiss);
  const [retestDismissed, setRetestDismissed] = useState(loadRetestDismiss);
  const [ftpRetestDismissed, setFtpRetestDismissed] = useState(loadFtpRetestDismiss);
  const [eftpDismissed, setEftpDismissed] = useState(loadEftpDismiss);
  const [cssFailDismissed, setCssFailDismissed] = useState(loadCssFailDismiss);
  const [runFailDismissed, setRunFailDismissed] = useState(loadRunFailDismiss);
  const [shortfallDismissed, setShortfallDismissed] = useState(loadShortfallDismiss);
  const [reviewToday, setReviewToday] = useState(false);
  const row = w => <WorkoutRow key={w.id} w={easedOf(w)} done={!!log[w.id]} eff={effDate(w, moves)} moved={effDate(w, moves) !== w.date} onClick={() => open(w)} profile onToggle={() => onToggleWorkout(w.id)} />;

  // One coach voice at a time: every possible nudge queues into a single slot,
  // most important first; a counter chip cycles through the rest. Applying a
  // suggestion clears its condition, so the queue drains itself.
  const coach = [];
  // Tracker mode: the only card is the prompt to start the next plan. The
  // engine cards below are all empty here (no weeks to reason about) but we
  // build only this one to be certain. Copy is honest per connection state:
  // without a feed, nothing is being "spotted" and the card must not claim it.
  const connected = !!activities;
  if (tracker) coach.push({
    key: 'no-plan', cls: 'banner tune', icon: 'nextplan',
    title: 'Ready for your next plan?',
    sub: connected
      ? 'Sessions from your watch land below and on your calendar. Tap to start your next plan.'
      : 'Log sessions here or on your calendar to keep your training diary going. Tap to start your next plan.',
    act: onEditPlan,
  });
  // The plan's own edges (race just passed / maintenance block ending)
  // outrank everything: they decide what the plan even is next.
  if (!tracker && planEdge) coach.push({ key: planEdge.key, cls: 'banner tune', icon: planEdge.icon, title: planEdge.title, sub: planEdge.sub, act: planEdge.act });
  // A maintenance block near its end can also just stop into tracker mode; offer
  // it as a second card the athlete can cycle to.
  if (!tracker && offerTracker) coach.push({
    // 'watch', not 'rest': a scheduled rest day's row wears the crescent on
    // this same screen, and one glyph must not mean two things at once
    key: 'just-track', cls: 'banner', icon: 'watch',
    title: 'Or just track for now',
    sub: (connected
      ? 'Stop the plan and take a break from structure. Sessions from your watch still land on your calendar.'
      : 'Stop the plan and take a break from structure.')
      + ' Your fitness history is kept. Tap to make the switch.',
    act: onEnterTracker,
  });
  const weeklySig = weekly
    ? weekly.kind + ':' + (weekly.week != null ? weekly.week : '') + ':' + (weekly.targets || []).join('.') : null;
  if (!tracker && weekly && weeklyDismissed !== weeklySig) {
    const skin = { 'trim-week': ['banner ramp', 'trend'], 'trim-long-run': ['banner ramp', 'trend'], 'boost-week': ['banner tune', 'flame'], 'restore-week': ['banner', 'bolt'] };
    const [cls, icon] = skin[weekly.kind] || ['banner', 'bolt'];
    coach.push({ key: 'weekly', cls, icon, title: weekly.headline, sub: weekly.why + ' Tap to apply →', act: () => onWeekly(weekly),
      dismiss: () => {
        saveWeeklyDismiss(weeklySig); setWeeklyDismissed(weeklySig);
        if (onDecision) onDecision(T.fromWeeklyProposal(weekly), 'rejected');
      } });
  }
  if (!tracker && spotted && spotted.length > 0) coach.push({
    key: 'spotted', cls: 'banner', icon: 'watch',
    title: spotted.length === 1 ? 'Session spotted on your watch' : spotted.length + ' sessions spotted on your watch',
    sub: spotted.map(m => m.workout.title).join(' · ') + ' — tap to log ' + (spotted.length === 1 ? 'it' : 'them') + ' →', act: onLogSpotted,
  });
  /* Phase 2: the threshold-update proposal finally has a dismiss like every
     sibling. Sticky per signature (kind:sport:proposedValue), so a dismissed
     offer stays quiet until the evidence actually proposes a different
     number — and the dismissal is journalled as a rejection, because
     rejected proposals remain in history. */
  if (!tracker && eftp && eftpDismissed !== eftp.sig) coach.push({
    key: 'eftp', cls: eftp.up ? 'banner tune' : 'banner ramp', icon: 'trend', title: eftp.headline,
    // swim proposals open the evidence sheet instead of retargeting on the
    // spot (spec §6); the wording must not promise a one-tap change
    // one verb for all three sports since the run gained its sheet (phase 2):
    // every threshold change is reviewed, none is a single tap
    sub: eftp.why + ' Tap to review →', act: onEftp,
    dismiss: () => {
      saveEftpDismiss(eftp.sig); setEftpDismissed(eftp.sig);
      if (onDecision) onDecision(T.fromThresholdProposal(eftp), 'rejected');
    },
  });
  // Phase 3b (§7): the athlete swam a CSS test but no CSS came out of it.
  // Silence here would read as the feature being broken; say why, and point
  // at the by-hand path.
  if (!tracker && cssFail && cssFail.issue && cssFailDismissed !== cssFail.sig) coach.push({
    key: 'cssfail', cls: 'banner ramp', icon: 'pace',
    title: 'We could not read a CSS from your test swim',
    sub: cssFail.issue + ' You can enter the result by hand. Tap to update fitness →',
    act: onFixCss,
    dismiss: () => { saveCssFailDismiss(cssFail.sig); setCssFailDismissed(cssFail.sig); },
  });
  // The run test's version of the same promise: a test that produced no 5 km
  // says why, and points at the by-hand path (audit catch 2026-07-30).
  if (!tracker && runFail && runFail.issue && runFailDismissed !== runFail.sig) coach.push({
    key: 'runfail', cls: 'banner ramp', icon: 'run',
    title: 'We could not read a 5 km time from your test run',
    sub: runFail.issue + ' You can enter the result by hand. Tap to update fitness →',
    act: onFixRun,
    dismiss: () => { saveRunFailDismiss(runFail.sig); setRunFailDismissed(runFail.sig); },
  });
  // Phase 3b (§5): the retest nudge. A recommendation, never a change: it
  // opens the protocol sheet, and dismissing it sticks until its signature
  // moves. The update-proposal banner above always outranks it (App passes
  // retest as null while a swim proposal is live).
  // §6: the FTP assessment nudge, dismissible per signature like the others.
  /* The under-built warning. Informational, dismissible per signature: the
     signature carries the shortfall sizes and the race date, so it speaks
     again if the athlete changes either. It never blocks anything — it is
     the one honest sentence the anchors owe the athlete they protect. */
  if (!tracker && startShortfall && shortfallDismissed !== startShortfall.sig) coach.push({
    key: 'start-shortfall', cls: 'banner', icon: 'trend', title: 'Your race build starts below where this race usually peaks',
    sub: startShortfall.text,
    dismiss: () => { saveShortfallDismiss(startShortfall.sig); setShortfallDismissed(startShortfall.sig); },
  });
  if (!tracker && ftpRetest && ftpRetestDismissed !== ftpRetest.sig) coach.push({
    key: 'ftp-retest', cls: 'banner', icon: 'trend', title: ftpRetest.headline,
    sub: ftpRetest.why + ' Tap to enter a result →', act: onFtpRetest,
    dismiss: () => {
      saveFtpRetestDismiss(ftpRetest.sig); setFtpRetestDismissed(ftpRetest.sig);
      if (onDecision) onDecision(T.fromRetest(ftpRetest, { discipline: 'bike' }), 'rejected');
    },
  });
  if (!tracker && retest && retestDismissed !== retest.sig) coach.push({
    key: 'retest', cls: 'banner', icon: 'pace', title: retest.headline,
    sub: retest.why + ' Tap for the protocol →', act: onRetest,
    dismiss: () => {
      saveRetestDismiss(retest.sig); setRetestDismissed(retest.sig);
      if (onDecision) onDecision(T.fromRetest(retest, { discipline: 'swim' }), 'rejected');
    },
  });
  if (!tracker && suggestions.length > 0) coach.push({
    key: 'tune', cls: 'banner tune', icon: 'pace', title: 'Time to tune your paces',
    sub: suggestions.map(s => D[s.discipline].name + (s.direction === 'faster' ? ' feels easy' : ' feels hard')).join(' · ') + ' — tap to adjust →', act: onTune,
  });
  const slot = coach.length ? coach[coachIdx % coach.length] : null;

  // Closing the loop: when today's training is logged (or it is a rest day),
  // answer the evening question — what's next?
  const todayReal = useMemo(() => today.filter(w => w.discipline !== 'rest' && !w.race), [today]);
  const allDone = todayReal.length > 0 && todayReal.every(w => log[w.id]);
  /* Unlogged only: a ticked session is not "next", and without this filter
     the row disagreed with the week card's own up-next on the same screen
     (audit, 2026-08-05). `sessions` already excludes the goal race. */
  // the comparator calls effDate on every comparison, so this is the one
  // derivation here that is more than a filter over a small array
  const next = useMemo(() => sessions.filter(w => effDate(w, moves) > todayISO && !log[w.id])
    .sort((a, b) => (effDate(a, moves) < effDate(b, moves) ? -1 : 1))[0], [sessions, moves, todayISO, log]);
  const restDay = todayReal.length === 0;

  /* The coach card holds up to three controls, so the card itself is NOT one
     of them. It used to be a role="button" with the dismiss and the cycle
     chip nested inside it — invalid ARIA, and the reason the cycle chip was
     aria-hidden rather than labelled: hiding it was the only way to stop a
     button appearing inside a button. That left every suggestion after the
     first reachable by pointer alone (audit, 2026-08-05). The action now
     lives on a wrapper around the icon and the text, so all three are
     siblings and each can be a real control. */
  const cycleTo = coach.length ? ((coachIdx % coach.length) + 1) % coach.length : 0;
  const coachBody = slot && <>
    <div className="bi" aria-hidden="true"><Icon name={slot.icon} size={20} /></div>
    <div className="btx"><div className="bt">{slot.title}</div><div className="bs">{slot.sub}</div></div>
  </>;
  const coachCard = slot && <div className={slot.cls + (slot.act ? '' : ' inert')}>
    {/* No act, no button: exactly one card (the under-built warning) is
        informational, and spreading tap() on it both advertised an action it
        did not have and threw on Enter, because the handler was undefined.
        The controls below no longer stopPropagation — they are siblings of
        the action now, not children of it. */}
    {slot.act
      ? <div className="b-act" {...tap(slot.act)}>{coachBody}</div>
      : <div className="b-act">{coachBody}</div>}
    {slot.dismiss && <div className="bmore bx" {...tap(slot.dismiss)} aria-label="Dismiss this suggestion">✕</div>}
    {coach.length > 1 && <div className="bmore" {...tap(() => setCoachIdx(i => i + 1))}
      aria-label={'Show suggestion ' + (cycleTo + 1) + ' of ' + coach.length}>
      {(coachIdx % coach.length) + 1}/{coach.length} ▸</div>}
  </div>;

  return (
    <>
      <div className="section-title">Today · {T.fmtDate(todayISO, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      {/* The daily briefing's context line (phase 5, spec §5.2/§24.1): where
          the athlete is in the plan and what today is for, in two short
          lines at most. Tracker has no plan to brief. */}
      {briefing && <div className="tb-context">
        <div className="tb-ctx-line">{briefing.contextLine}</div>
        {/* One voice for the priority (review, 2026-08-05): with any
            readiness record the verdict below already names today's session
            ("attack today's Tempo Run"), and this line said it a second
            time. It speaks only in the no-readiness state, where the card
            shows the add-your-morning banner and nothing else would. */}
        {briefing.priorityLine && !(wellness && wellness.length) && <div className="tb-priority">{briefing.priorityLine}</div>}
      </div>}
      {/* With no plan the tab's one call to action is the next-plan prompt, so
          it leads; in plan mode readiness keeps the top spot (Jon, 2026-07-16). */}
      {tracker && coachCard}
      <ReadinessCard wellness={wellness} today={today.map(w => ({ ...easedOf(w), done: !!log[w.id] }))} noPlan={tracker}
        onEdit={onEditWellness} onFeel={onFeel} onEase={onEaseToday} onRestore={onRestoreToday} onOpen={open} onSupport={onSupport}
        storage={storage} onDecision={onDecision} />
      {!tracker && coachCard}
      {/* The countdown self-gates to the final week (and hides for noRace
          blocks), so mounting is unconditional in plan mode. */}
      {!tracker && <RaceWeekCard plan={plan} storage={storage} />}
      <div className="card">
        {allDone && !reviewToday
          ? <div className="today-done">
            <div className="td-tick">✓</div>
            <div className="td-t">Done for today</div>
            <div className="td-s">{todayReal.map(w => easedOf(w).title).join(' · ')} logged</div>
            <a className="reset" {...tap(() => setReviewToday(true))}>Review</a>
          </div>
          : today.length === 0
            ? <div className="empty"><div className="big"><Icon name="rest" size={40} /></div>{tracker ? 'No plan active. Rest up.' : 'No session scheduled today.'}</div>
            : <>
              {/* Briefing decorations around the untouched rows (phase 5):
                  the Main session caption marks the primary ONLY on
                  multi-session days (the selector's rule), cues render
                  under the session they prepare, and the dependency line
                  closes the list. All in this file on purpose: WorkoutRow
                  is shared with WeekOverview and the calendar, and its
                  race-row test pins its text. */}
              {today.map(w => <Fragment key={w.id}>
                {briefing && briefing.primaryId === w.id && <div className="tb-main">Main session</div>}
                {row(w)}
                {briefing && (briefing.cues[w.id] || []).map((c, i) => (
                  <div key={i} className="tb-cue"><Icon name={c.icon} size={13} /> {c.text}</div>
                ))}
              </Fragment>)}
              {briefing && briefing.dependencyLine && <div className="tb-dep">{briefing.dependencyLine}</div>}
            </>}
        {(allDone || restDay) && next && <div className="tmrw" {...tap(() => open(next))}
          aria-label={'Next up, ' + T.fmtDate(effDate(next, moves), { weekday: 'long' }) + ': ' + easedOf(next).title + '. Open details'}>
          <Icon name="calendar" size={15} />
          <span>Next up · {T.fmtDate(effDate(next, moves), { weekday: 'long' })}: <b>{easedOf(next).title}</b> · {T.fmtDuration(easedOf(next).durationMin || 0)}</span>
        </div>}
        {/* tracker's row logs a DONE session into the diary; plan mode's adds
            a scheduled one — same doorway, App routes by mode */}
        <div className="add-row" {...tap(onAddWorkout)}><Icon name="plus" size={15} /> {tracker ? 'Log a session' : 'Add a session'}</div>
      </div>
      <RecordedActivities activities={displayActivities || activities} date={todayISO} plan={plan} log={log} moves={moves} onOpen={onOpenRecording} />
      {/* One week card, not two: the retrospective used to sit above the
          strip as its own card carrying the same three numbers under the
          title this one now wears, so it rides inside instead. */}
      {!tracker && (
        <WeekCard plan={plan} log={log} moves={moves} adjust={adjust} missedReasons={missedReasons}
          open={open} todayISO={todayISO}>
          {storage && <WeeklyDigest embedded plan={plan} log={log} moves={moves} adjust={adjust} adjustLog={adjustLog}
            wellness={wellness} activities={displayActivities || activities} storage={storage} todayISO={todayISO} coachLog={coachLog} blockReviewed={blockReviewed} onBlockReviewed={onBlockReviewed} onFocus={onFocus} />}
        </WeekCard>
      )}
      {/* tracker has no plan week to strip, so the digest keeps its own card */}
      {tracker && storage && <WeeklyDigest plan={plan} log={log} moves={moves} adjust={adjust} adjustLog={adjustLog}
        wellness={wellness} activities={displayActivities || activities} storage={storage} todayISO={todayISO} coachLog={coachLog} blockReviewed={blockReviewed} onBlockReviewed={onBlockReviewed} onFocus={onFocus} />}
    </>
  );
}
