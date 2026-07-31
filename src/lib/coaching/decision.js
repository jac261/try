import { evidenceItem } from './evidence.js';
import { COACH_RULE_VERSION } from '../coach.js';

/* Try — shared coaching layer: the decision model (phase 2 §3, stage 1).
 *
 * ADAPTERS, NOT JUDGES. Every function here normalises the OUTPUT of an
 * existing producer — decideWeek, the weekly/race proposals, the threshold
 * proposals, the retest recommendations, the readiness day-proposal — into
 * one decision shape for presentation and history. No metric is read, no
 * verdict recomputed, no threshold consulted; the athlete-facing copy
 * (headline, why) passes through byte-identical, which the tests pin. A
 * generic layer must never weaken a discipline guardrail, and the surest
 * way to guarantee that is to give it no opinions of its own.
 *
 * Identity is deterministic: id = sourceEngine + ':' + the producer's own
 * signature (the dismissal-signature concept, generalised), so journal
 * writes are idempotent and a re-derived unchanged proposal is the SAME
 * decision, not a new one.
 *
 * Two honesty rules the constructors enforce:
 * - low confidence cannot carry a strong action (progress/reduce/replace):
 *   it degrades to collect-data. No current producer emits such a
 *   combination; this is the fence the spec asks for, so a future one
 *   cannot.
 * - reversible is stated truthfully: weekly overlays have restore paths;
 *   a retarget has none today, and the decision says so rather than
 *   implying an undo that does not exist.
 */

export const COACHING_ACTIONS = ['progress', 'repeat', 'reduce', 'hold', 'reschedule', 'replace', 'retest', 'collect-data', 'no-change'];
export const DECISION_STATUSES = ['proposed', 'accepted', 'rejected', 'applied', 'superseded', 'expired'];

const STRONG_ACTIONS = ['progress', 'reduce', 'replace'];

export function coachingDecision(fields) {
  const action = COACHING_ACTIONS.includes(fields.action) ? fields.action : 'no-change';
  const confidence = ['low', 'medium', 'high'].includes(fields.confidence) ? fields.confidence : 'low';
  return Object.freeze({
    id: fields.id,
    createdAt: fields.createdAt || undefined,
    discipline: fields.discipline || undefined,
    // the fence: low confidence may ask for data, never move training
    action: confidence === 'low' && STRONG_ACTIONS.includes(action) ? 'collect-data' : action,
    status: DECISION_STATUSES.includes(fields.status) ? fields.status : 'proposed',
    headline: String(fields.headline || ''),
    explanation: String(fields.explanation || ''),
    evidence: Object.freeze((fields.evidence || []).map(e => (Object.isFrozen(e) ? e : evidenceItem(e)))),
    confidence,
    affectedWorkoutIds: Object.freeze(fields.affectedWorkoutIds || []),
    requiresAcceptance: !!fields.requiresAcceptance,
    reversible: !!fields.reversible,
    sourceEngine: fields.sourceEngine,
    sourceEngineVersion: fields.sourceEngineVersion || undefined,
  });
}

/* ---- decideWeek (coach.js) ---- */

// Evidence kind by the coach's own signal label. 'reported' is the athlete's
// word, 'recorded' is a measurement of a session, 'derived' is the engine
// reading its own state. Unknown signals are derived — the coach only ever
// speaks from its inputs — but 'missing' entries stay missing.
const COACH_SIGNAL_KINDS = {
  'your answers': 'reported',
  'late-session durability': 'recorded',
  'worth noting': 'recorded',
  'the week': 'missing',
};
const COACH_ACTIONS = {
  progress: 'progress', hold: 'hold', 'reduce-volume': 'reduce',
  'ease-intensity': 'reduce', recover: 'reduce',
};

export function fromCoachWeek(decision, { discipline } = {}) {
  if (!decision) return null;
  const d = discipline ? decision.disciplines && decision.disciplines[discipline] : decision.overall;
  if (!d) return null;
  const evidence = (d.evidence || []).map(e => evidenceItem({
    label: e.signal, explanation: e.reading,
    kind: COACH_SIGNAL_KINDS[e.signal] || 'derived',
    discipline: discipline || 'plan',
    confidence: 'medium',
  }));
  const hasRecorded = evidence.some(e => e.kind === 'recorded');
  return coachingDecision({
    id: 'coach:' + decision.weekMonday + (discipline ? ':' + discipline : ''),
    createdAt: decision.weekMonday,
    discipline: discipline || 'multisport',
    action: COACH_ACTIONS[d.decision] || 'hold',
    headline: d.headline,
    explanation: (d.evidence || []).map(e => e.reading).join(' '),
    evidence,
    confidence: hasRecorded ? 'high' : 'medium',
    requiresAcceptance: false,   // the weekly verdict is a reading, not a mutation
    reversible: true,
    sourceEngine: 'coach',
    sourceEngineVersion: String(decision.ruleVersion ?? COACH_RULE_VERSION),
  });
}

/* ---- proposeWeek / proposeRace (adapt.js) ---- */

const WEEKLY_ACTIONS = {
  'trim-week': 'reduce', 'trim-long-run': 'reduce',
  'boost-week': 'progress', 'restore-week': 'replace',
};

export function fromWeeklyProposal(p, { at } = {}) {
  if (!p) return null;
  return coachingDecision({
    id: 'adapt:' + p.kind + ':' + (p.week ?? '') + ':' + (p.targets || []).join('.'),
    createdAt: at || undefined,
    discipline: 'multisport',
    action: WEEKLY_ACTIONS[p.kind] || 'hold',
    headline: p.headline,
    explanation: p.why,
    evidence: [evidenceItem({ label: 'readiness', explanation: p.why, kind: 'derived', confidence: 'medium' })],
    confidence: 'medium',
    affectedWorkoutIds: (p.targets || []).concat(p.ease || []),
    requiresAcceptance: true,
    reversible: true,            // restore-week / unEase exist
    sourceEngine: 'adapt',
  });
}

/* ---- eftpProposal (eftp.js): the retarget payloads ---- */

const META_KINDS = { 'try-test': 'recorded', 'activity-model': 'derived', 'intervals-icu': 'reported', manual: 'reported', 'recorded-race': 'recorded', estimated: 'estimated' };

export function fromThresholdProposal(p, { at } = {}) {
  if (!p) return null;
  const meta = p.retarget && (p.retarget.cssMeta || p.retarget.ftpMeta || p.retarget.fivekMeta) || {};
  const proposed = p.retarget && (p.retarget.css100Sec ?? p.retarget.ftp ?? p.retarget.fivekSec);
  return coachingDecision({
    id: 'eftp:' + p.kind + ':' + p.sport + ':' + (proposed ?? ''),
    createdAt: at || meta.measuredAt || undefined,
    discipline: p.sport,
    action: 'replace',
    headline: p.headline,
    explanation: p.why,
    evidence: [evidenceItem({
      label: 'threshold evidence', explanation: p.why,
      kind: META_KINDS[meta.source] || 'derived',
      discipline: p.sport, observedAt: meta.measuredAt,
      confidence: meta.confidence || 'medium',
    })],
    confidence: meta.confidence || 'medium',
    requiresAcceptance: true,
    /* No plan versioning exists, so an accepted retarget cannot be undone;
       fitnessHistory records the superseded value but nothing restores it.
       Saying reversible: true here would be the lie the spec's §3 exists to
       prevent. */
    reversible: false,
    sourceEngine: 'eftp',
  });
}

/* ---- css/ftp retest recommendations: copy-only nudges ---- */

export function fromRetest(rec, { discipline, at } = {}) {
  if (!rec) return null;
  const reason = rec.reason;
  const kind = ['perf-slow', 'perf-fast', 'drift-up', 'drift-down', 'reps-over', 'reps-under'].includes(reason) ? 'recorded'
    : ['missing', 'unverified'].includes(reason) ? 'missing' : 'derived';
  return coachingDecision({
    id: (discipline === 'bike' ? 'ftp-retest:' : 'css-retest:') + rec.sig,
    createdAt: at || undefined,
    discipline,
    action: 'retest',
    headline: rec.headline,
    explanation: rec.why,
    evidence: [evidenceItem({ label: 'retest signal', explanation: rec.why, kind, discipline, confidence: 'medium' })],
    confidence: 'medium',
    requiresAcceptance: false,   // deliberately copy-only: no payload, no mutation
    reversible: true,
    sourceEngine: discipline === 'bike' ? 'ftp-retest' : 'css-retest',
  });
}

/* ---- proposeToday (adapt.js) / the readiness day proposal ---- */

const TODAY_ACTIONS = { ease: 'reduce', restore: 'progress', 'move-test': 'reschedule' };

export function fromTodayProposal(p, { at } = {}) {
  if (!p) return null;
  return coachingDecision({
    id: 'adapt-today:' + p.kind + ':' + ((p.workout && p.workout.id) || ''),
    createdAt: at || undefined,
    discipline: p.workout ? p.workout.discipline : 'multisport',
    action: TODAY_ACTIONS[p.kind] || 'hold',
    headline: p.headline,
    explanation: p.why,
    evidence: [evidenceItem({ label: 'readiness', explanation: p.why, kind: 'derived', confidence: 'medium' })],
    confidence: 'medium',
    affectedWorkoutIds: p.workout ? [p.workout.id] : [],
    requiresAcceptance: true,
    reversible: true,            // restoreToday / unEase
    sourceEngine: 'adapt',
  });
}
