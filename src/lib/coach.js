/* Try — the coach brain: explainable weekly decisions (pass 1 of the
 * progression spec, docs/COACH_BRAIN.md).
 *
 * One pure function turns a finished (or in-progress) week into a small set
 * of decisions: one overall call and one line per discipline, each carrying
 * plain-language evidence. The vocabulary is deliberately small and honest:
 *
 *   progress        the current workload is repeatable, move one thing on
 *   hold            keep the workload, and that is a GOOD outcome, not a
 *                   failure state (the spec's central idea)
 *   reduce-volume   pull the week's volume back
 *   ease-intensity  keep moving, drop the hard work
 *   recover         signals agree the athlete needs a genuinely easy week
 *
 * The spec's REST and RESTRICT_DISCIPLINE are absent on purpose: Try has no
 * full-stand-down actuator to distinguish REST from recover, and no mid-plan
 * injured-state flow for RESTRICT to point at (design panel 2026-07-20).
 *
 * HONESTY RULES BAKED IN:
 * - This layer never re-derives the adaptive engine's thresholds. It calls
 *   proposeWeek/runLoadSignal/etc and maps their RETURNS, so the weekly
 *   verdict can never contradict the engine card that shares its signals.
 * - HOLD is the default. Insufficient evidence is never progression.
 * - A missed session is 'missed-unknown' until the athlete's own one-tap
 *   answer says otherwise. Wellness context never infers the reason.
 * - Discipline-scoped reductions exist only for the run: it is the one
 *   discipline with its own mechanical strain signal (runload.js). Aggregate
 *   ramp and form signals speak only through the overall decision.
 * - Injury language appears only when the athlete's own answer said niggle.
 */

import { proposeWeek } from './adapt.js';
import { runLoadSignal, runLoadFromActivities, RUN_RAMP_RULES } from './runload.js';
import { weakestLink } from './weakest.js';
import { wellness as W } from './wellness.js';
import { effDate } from './schedule.js';
import { weekPhaseLabel } from './plan.js';
import { iso, addDays } from './date.js';

// Bump when decision logic changes: stored decisions carry the version they
// were made under, so an old stored call is never judged by new rules.
export const COACH_RULE_VERSION = 1;

// The one-tap answers for a missed session, in the athlete's own words.
export const MISSED_REASONS = {
  tired: 'Felt too run down',
  life: 'Life got in the way',
  niggle: 'An injury niggle',
  choice: 'Skipped it on purpose',
};

// A done session with a recording well short of the plan is 'partial'. The
// fraction is deliberately below the matcher's own lower window (0.5 of the
// planned time would not even have matched), and a done entry with NO
// recorded duration always classifies as plain completed, never inferred
// partial (design panel 2026-07-20).
const PARTIAL_FRACTION = 0.7;

// The progression a discipline is named for when it earns 'progress'. These
// describe what the plan machinery actually does next (the limiter swap's
// third swim, the boost path's volume), not aspirations.
const PROGRESSION = {
  swim: 'a third swim in the week',
  bike: 'more time in the hard aerobic work',
  run: 'extending the long run',
};

// The limiter must have completed its key sessions in this many consecutive
// reviewed weeks before 'progress' is on the table: the spec's "repeated
// successfully" made concrete. Documented here because it is a NEW rule, not
// borrowed from the engine.
export const REPEAT_WEEKS = 2;

/* ---- the block focus (pass 4, display-and-coach-only) ----
 * The limiter machinery keeps actuating exactly as before: a declared focus
 * NEVER feeds weakBias or the frequency swap (it would bypass the noise
 * gates weakest.js exists for), never renames the progression variable when
 * it diverges from the limiter (the named progression describes what the
 * plan really does next), and changes nothing about generation. It labels
 * blocks, scopes the block review, and where it disagrees with the derived
 * limiter every surface says both plainly (design panel 2026-07-21). */
export const FOCUS_OPTIONS = { swim: 'the swim', bike: 'the bike', run: 'the run', general: 'everything evenly' };
// phase-gated verb: a focus clause never claims building during a taper
export function focusClause(phase, focus) {
  if (!focus || focus === 'general') return phase === 'Maintain' ? 'keeping everything ticking' : null;
  const name = FOCUS_OPTIONS[focus];
  if (!name) return null;
  if (phase === 'Base' || phase === 'Build') return 'building ' + name;
  if (phase === 'Peak') return 'sharpening ' + name;
  if (phase === 'Maintain') return 'minding ' + name;
  return null; // Taper and Recovery are not about any one discipline
}
// The effective focus: declared wins for LABELS; the derived limiter keeps
// actuating regardless. Returns {focus, derived, diverges}.
export function resolveFocus(profile, wl) {
  const derived = wl && wl.weakest ? wl.weakest : 'general';
  const declared = profile && profile.blockFocus && FOCUS_OPTIONS[profile.blockFocus] ? profile.blockFocus : null;
  const focus = declared || derived;
  return { focus, derived, declared, diverges: !!declared && declared !== derived && derived !== 'general' };
}

/* ---- completion classification (spec section 4, derived not asked) ---- */

// One planned session → a completion status string. Pure; the missed reason
// comes from the athlete's stored one-tap answer, never from wellness.
export function classifyCompletion({ workout, entry, adjustEntry, missedReason, day, todayISO }) {
  if (!workout || workout.race || workout.discipline === 'rest') return null;
  if (entry && entry.done) {
    if (adjustEntry && (adjustEntry.kind === 'ease' || adjustEntry.kind === 'trim')) return 'modified';
    if (entry.actualMin != null && workout.durationMin
      && entry.actualMin < workout.durationMin * PARTIAL_FRACTION) return 'completed-partial';
    return 'completed';
  }
  // day is the move-resolved effective date; a rescheduled session must be
  // judged against the day it actually lives on.
  const effective = day || workout.date;
  if (effective >= todayISO) return 'upcoming';
  return missedReason && MISSED_REASONS[missedReason] ? 'missed-' + missedReason : 'missed-unknown';
}

/* ---- the weekly decision ---- */

const week = (weekMonday, d) => iso(addDays(weekMonday, d));

// Sessions of the reviewed week with their classifications, by discipline.
function weekSessions({ plan, log, moves, adjust, missedReasons, weekMonday, todayISO }) {
  const weekEnd = week(weekMonday, 6);
  const out = { run: [], bike: [], swim: [], brick: [], strength: [] };
  if (!plan || !Array.isArray(plan.weeks)) return out;
  plan.weeks.flatMap(w => w.workouts).forEach(w => {
    if (w.race || w.discipline === 'rest' || !out[w.discipline]) return;
    const day = effDate(w, moves);
    if (day < weekMonday || day > weekEnd) return;
    const status = classifyCompletion({
      workout: w, entry: (log || {})[w.id], adjustEntry: (adjust || {})[w.id],
      missedReason: (missedReasons || {})[w.id] && missedReasons[w.id].reason, day, todayISO,
    });
    if (status) out[w.discipline].push({ id: w.id, key: !!w.key, status, title: w.title || w.type, day });
  });
  return out;
}

const doneish = s => s.status === 'completed' || s.status === 'completed-partial' || s.status === 'modified';

// Red readiness days inside the reviewed week, scored by the same
// no-hindsight history the readiness surfaces use: each day against the
// baseline as it stood that day, empty days scoring nothing.
function redDays(wellness, weekMonday) {
  const weekEnd = week(weekMonday, 6);
  return W.history(wellness, 60)
    .filter(r => r.date >= weekMonday && r.date <= weekEnd && r.band === 'red').length;
}

// The trim/boost proposal that governed the reviewed week: an ACCEPTED entry
// from the adjust log wins (quoted verbatim, the digest's own rule); else the
// engine's live proposal as of the week's last day. `targets` tells us who it
// was aimed at: all-run targets make it a run-scoped call.
function weekProposal({ plan, log, moves, adjust, adjustLog, wellness, weekMonday }) {
  // The engine proposes for NEXT week (its own contract), so the call that
  // governed the reviewed week was accepted DURING the week before it. The
  // journaled week index is exact where present; older entries fall back to
  // that timestamp window (gauntlet catch 2026-07-20: searching the reviewed
  // week itself was off by one and never found anything real).
  const prevMonday = week(weekMonday, -7);
  const prevEnd = week(weekMonday, -1);
  const planWeek = plan && Array.isArray(plan.weeks) ? plan.weeks.find(w => w.start === weekMonday) : null;
  const planId = (plan && plan.createdAt) || null;
  // Plan identity guards both match paths: an entry journaled under another
  // plan must never be quoted as this week's governing call (re-verify catch
  // 2026-07-20). Legacy entries without the stamp qualify only through the
  // narrow timestamp window, never the index.
  const idOk = e => e.planCreatedAt == null ? null : e.planCreatedAt === planId;
  const accepted = (adjustLog || []).find(e => e && e.headline && idOk(e) !== false && (
    (e.week != null && planWeek && e.week === planWeek.index && idOk(e) === true
      && e.at && e.at.slice(0, 10) >= prevMonday && e.at.slice(0, 10) <= week(weekMonday, 6))
    || (e.week == null && e.at && e.at.slice(0, 10) >= prevMonday && e.at.slice(0, 10) <= prevEnd)));
  // Older journal entries carry only {at, kind, headline, why}; factor and
  // targets were added for this layer. Missing means unknown, and unknown
  // maps to the generic reduction, never to the stronger recover call.
  if (accepted) return { source: 'accepted', headline: accepted.headline, why: accepted.why || null, kind: accepted.kind || 'trim-week', factor: accepted.factor ?? null, targets: accepted.targets || [] };
  const live = proposeWeek({ wellness, plan, log, moves, adjust, todayISO: prevEnd });
  if (live) return { source: 'open', headline: live.headline, why: live.why, kind: live.kind, factor: live.factor, targets: live.targets || [] };
  return null;
}

function runScoped(proposal, sessions) {
  if (!proposal || !proposal.targets || !proposal.targets.length) return false;
  const runIds = new Set(sessions.run.map(s => s.id));
  return proposal.targets.every(id => runIds.has(id));
}

// decideWeek: the whole week → { weekMonday, ruleVersion, overall,
// disciplines: {run, bike, swim}, progression }. Every decision is
// { decision, headline, evidence: [{signal, reading}], conflicting: [] }.
// `prevWeeks` is an array of earlier stored decisions (newest first), used
// only for the repeat rule. Pure and deterministic.
export function decideWeek({ plan, log, moves, adjust, adjustLog, wellness, activities, missedReasons, todayISO, weekMonday, prevWeeks, durabilityByDiscipline }) {
  const tracker = !plan || plan.race === 'tracker' || !Array.isArray(plan.weeks) || !plan.weeks.length;
  if (tracker) return decideTrackerWeek({ activities, wellness, plan, todayISO, weekMonday });

  const sessions = weekSessions({ plan, log, moves, adjust, missedReasons, weekMonday, todayISO });
  const reds = redDays(wellness, weekMonday);
  const proposal = weekProposal({ plan, log, moves, adjust, adjustLog, wellness, weekMonday });
  const wl = weakestLink({ profile: plan.profile });

  const allSessions = Object.values(sessions).flat();
  const missedTired = allSessions.filter(s => s.status === 'missed-tired').length;
  const missedNiggle = allSessions.filter(s => s.status === 'missed-niggle').length;
  const keyPlanned = allSessions.filter(s => s.key);
  const keyDone = keyPlanned.filter(doneish);
  const evidence = [];
  const conflicting = [];

  if (keyPlanned.length) evidence.push({
    signal: 'key sessions',
    reading: keyDone.length + ' of ' + keyPlanned.length + ' completed',
  });
  if (reds) evidence.push({ signal: 'readiness', reading: reds + (reds === 1 ? ' day' : ' days') + ' in the red this week' });
  if (missedTired) evidence.push({ signal: 'your answers', reading: missedTired + ' session' + (missedTired === 1 ? '' : 's') + ' missed feeling run down' });
  if (missedNiggle) evidence.push({ signal: 'your answers', reading: 'an injury niggle came up ' + missedNiggle + (missedNiggle === 1 ? ' time' : ' times') });
  if (proposal) evidence.push({
    signal: proposal.source === 'accepted' ? 'engine call you accepted' : 'engine call that week',
    reading: proposal.headline,
  });
  // identity of the quoted accepted entry, so the digest can hide exactly
  // that engine row and no other (headlines are reused templates; matching
  // on text alone hid unrelated calls, re-verify catch 2026-07-20)
  const quotedEngine = proposal && proposal.source === 'accepted'
    ? { headline: proposal.headline, why: proposal.why } : null;

  // Overall, in the spec's priority order: strain first, progression last,
  // hold by default.
  let overall;
  let boostClean = false;
  if (missedNiggle >= 2) {
    overall = { decision: 'recover', headline: 'Ease right off and let that niggle settle' };
    evidence.push({ signal: 'pattern', reading: 'the same kind of answer twice in one week is worth taking seriously; if it keeps coming up, a professional opinion beats pushing through' });
  } else if (proposal && proposal.kind === 'trim-week' && proposal.factor != null && proposal.factor <= 0.6) {
    overall = { decision: 'recover', headline: 'A recovery week is the right call' };
  } else if (proposal && proposal.kind === 'trim-week' && runScoped(proposal, sessions)) {
    overall = { decision: 'hold', headline: 'Hold overall, with the run pulled back' };
  } else if (proposal && proposal.kind === 'trim-week') {
    overall = { decision: 'reduce-volume', headline: 'Pull the volume back before building again' };
  } else if (reds >= 2 || missedTired >= 2) {
    overall = { decision: 'recover', headline: 'The week is asking for recovery' };
  } else if (proposal && proposal.kind === 'boost-week') {
    if (keyPlanned.length && keyDone.length === keyPlanned.length && !reds) {
      // provisional: confirmed below only if a discipline actually earns
      // progression, so the overall pill never contradicts every row under it
      boostClean = true;
      overall = { decision: 'hold', headline: 'The load is landing well' };
    } else {
      overall = { decision: 'hold', headline: 'Room to build soon, not yet' };
      conflicting.push('form shows room to absorb more, but the week was not clean enough to progress on');
    }
  } else {
    overall = { decision: 'hold', headline: 'This workload is doing its job' };
    if (!evidence.length) evidence.push({ signal: 'the week', reading: 'nothing here argues for changing course' });
  }

  // Per-discipline lines. Run may earn its own reduction (its own strain
  // signal); swim and bike only ever progress or hold at this scope.
  const disciplines = {};
  ['run', 'bike', 'swim'].forEach(d => {
    const ss = sessions[d].concat(d !== 'swim' ? sessions.brick.map(s => ({ ...s })) : []);
    if (!ss.length) return;
    const done = ss.filter(doneish).length;
    // Clean is about the work that matters: every key session done, and no
    // miss the athlete attributed to strain. A skipped easy spin does not
    // break a week (gauntlet catch: all-sessions cleanliness quietly blocked
    // progression for anyone who ever missed one easy session).
    const keys = ss.filter(x => x.key);
    const strained = ss.some(x => x.status === 'missed-tired' || x.status === 'missed-niggle');
    const clean = !strained && (keys.length ? keys.every(doneish) : done === ss.length);
    const ev = [{ signal: 'sessions', reading: done + ' of ' + ss.length + ' completed' + (keys.length ? ', key work ' + keys.filter(doneish).length + ' of ' + keys.length : '') }];
    let decision = 'hold', headline = 'Doing its job';

    if (d === 'run' && proposal && proposal.kind === 'trim-week' && runScoped(proposal, sessions)) {
      decision = 'reduce-volume'; headline = 'Pull the running back';
      ev.push({ signal: 'run load', reading: 'building faster than your own recent normal' });
    } else if (overall.decision === 'recover') {
      headline = 'Easy week here too';
    } else if (wl && wl.weakest === d && clean && overall.decision !== 'reduce-volume') {
      // the repeat rule: this discipline also completed everything in the
      // previously reviewed weeks (REPEAT_WEEKS including this one)
      // The prior week must be the literal previous calendar week, from the
      // SAME plan, in plan mode: a clean flag from months ago or another
      // plan must never unlock progression (gauntlet catch 2026-07-20).
      const prev = (prevWeeks || [])[0];
      const priorClean = prev && prev.weekMonday === week(weekMonday, -7)
        && !prev.tracker && prev.planCreatedAt === (plan.createdAt || null)
        && prev.disciplines && prev.disciplines[d] && prev.disciplines[d].clean;
      if (priorClean) {
        decision = 'progress'; headline = 'Ready to progress: ' + PROGRESSION[d];
        ev.push({ signal: 'repeatability', reading: 'this is your limiter and the work has been landing for ' + REPEAT_WEEKS + ' weeks straight' });
      } else {
        headline = 'Landing well. One more clean week opens progression';
        ev.push({ signal: 'repeatability', reading: 'your limiter needs ' + REPEAT_WEEKS + ' clean weeks in a row to progress; this one counts' });
      }
    }
    if (wl && wl.weakest === d && !clean && strained) {
      ev.push({ signal: 'repeatability', reading: 'a session missed under strain resets the clean-week count' });
    }
    // Durability context, pass 2: EVIDENCE ONLY. The read never changes a
    // decision here; using it as a decision input needs its own design
    // panel first (documented in docs/COACH_BRAIN.md).
    const du = durabilityByDiscipline && durabilityByDiscipline[d];
    if (du && du.read) {
      ev.push({ signal: 'late-session durability', reading: ({ 'held-strong': 'your long session held up strongly to the end', 'faded-a-little': 'your long session faded a little in its final stretch', 'faded-hard': 'your long session faded hard in its final stretch' })[du.read.band] });
    }
    disciplines[d] = { decision, headline, evidence: ev, clean };
  });

  const progressed = Object.entries(disciplines).find(([, v]) => v.decision === 'progress');
  // The overall call agrees with its rows: progress only when a discipline
  // actually earned it (gauntlet catch: a content-free overall progress next
  // to three hold rows read as the app contradicting itself).
  if (progressed && (overall.decision === 'hold') && boostClean) {
    overall = { decision: 'progress', headline: 'The load is landing well' };
  }
  const planWeek = plan.weeks.find(w2 => w2.start === weekMonday);
  return {
    weekMonday, ruleVersion: COACH_RULE_VERSION, tracker: false, planCreatedAt: plan.createdAt || null,
    // the phase as it stood when the week froze: block boundaries derive
    // from stored decisions, never re-derived against a since-reshaped plan.
    // The terminal post-race week freezes as 'Recovery' so the stamp matches
    // what the athlete sees, and so a recovery tail never reads as Maintain.
    phase: weekPhaseLabel(plan, planWeek),
    quotedEngine,
    overall: { ...overall, evidence, conflicting },
    disciplines,
    progression: progressed ? { discipline: progressed[0], what: PROGRESSION[progressed[0]] } : null,
  };
}

// Tracker mode is honestly narrower (design panel 2026-07-20): no plan means
// no completion classification and no ramp/form guardrails. What remains:
// readiness bands, the run diary's own ramp signal, and the limiter board.
function decideTrackerWeek({ activities, wellness, plan, todayISO, weekMonday }) {
  const reds = redDays(wellness, weekMonday);
  const evidence = [];
  const conflicting = [];
  let overall;
  if (reds >= 2) {
    overall = { decision: 'recover', headline: 'The week is asking for recovery' };
    evidence.push({ signal: 'readiness', reading: reds + ' days in the red this week' });
  } else {
    overall = { decision: 'hold', headline: 'Ticking over nicely' };
    evidence.push({ signal: 'the week', reading: 'nothing here argues for changing course' });
  }
  const disciplines = {};
  const run = runLoadFromActivities({ activities, todayISO: week(weekMonday, 6) });
  if (run && run.rampPct > RUN_RAMP_RULES.riskPct) {
    disciplines.run = {
      decision: 'reduce-volume', headline: 'Pull the running back', clean: false,
      evidence: [{ signal: 'run load', reading: 'your running has jumped well past its recent normal' }],
    };
  }
  const wl = plan && plan.profile ? weakestLink({ profile: plan.profile }) : null;
  return {
    phase: null,
    // the tracker sentinel carries a real createdAt, and the freeze guard
    // and digest read compare against it: a null stamp made every stored
    // tracker decision look foreign, refreezing forever and never rendering
    // (gauntlet catch 2026-07-20)
    weekMonday, ruleVersion: COACH_RULE_VERSION, tracker: true, planCreatedAt: (plan && plan.createdAt) || null,
    overall: { ...overall, evidence, conflicting },
    disciplines,
    progression: wl && wl.weakest ? { discipline: wl.weakest, what: PROGRESSION[wl.weakest] } : null,
  };
}

// User-facing vocabulary: the spec's SHOUTED enum in Try's voice.
export const DECISION_LABELS = {
  progress: 'Progress',
  hold: 'Hold steady',
  'reduce-volume': 'Pull back',
  'ease-intensity': 'Ease the intensity',
  recover: 'Recovery',
};
