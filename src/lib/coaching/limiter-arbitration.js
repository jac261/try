import { swimDashboard } from '../swim-dashboard.js';
import { bikeDashboard } from '../bike-dashboard.js';
import { runDashboard, runStoredReviews } from '../run-dashboard.js';
import { RACES } from '../domain.js';

/* Try — cross-discipline limiter arbitration, SHADOW MODE (phase 2 §8,
 * stage 4).
 *
 * Each discipline dashboard already selects its own limiter with ordered
 * rules. Nothing selected ACROSS them: an athlete with a measured swim fade
 * and an unmeasured bike threshold had two cards and no answer to "so what
 * comes first?". This module answers that one question, and only speaks —
 * it reads state, writes nothing, feeds nothing. weakestLink, weakBias, the
 * frequency swap and generation are untouched, and a test pins the module
 * import-clean of every actuator.
 *
 * NO SCORES. The spec asks for actionability/consequence/confidence and
 * explicitly forbids averaging. Each limiter rule id carries a DECLARED
 * static table entry, and arbitration is ordered rules:
 *   tier 1  measured problems      (presence outranks absence, the rule
 *   tier 2  missing-data asks       every dashboard already enforces
 *   tier 3  all clear / too early   within itself, now applied across)
 * within a tier, higher consequence first; at equal consequence the fixed
 * discipline order run, bike, swim — the order the disciplines end a race
 * in reverse: a run limiter costs the most on race day because it lands
 * last, on the most fatigue, with the highest injury cost (the durability
 * rationale the run module documents).
 *
 * The candidates come from the SAME dashboard builders the components
 * render (swimDashboard/bikeDashboard/runDashboard attach their own
 * limiter), with the same solo/excluded gates — a discipline whose
 * dashboard does not render cannot be the priority. Adapted, not
 * recomputed: headlines pass through verbatim.
 */

// tier 1 measured, 2 missing-data, 3 clear. Consequence/actionability are
// declared per rule id, never computed.
export const LIMITER_TABLE = {
  'swim:consistency': { tier: 1, consequence: 'high', actionability: 'high', confidence: 'high' },
  'swim:threshold': { tier: 1, consequence: 'medium', actionability: 'high', confidence: 'high' },
  'swim:endurance': { tier: 1, consequence: 'medium', actionability: 'medium', confidence: 'high' },
  'swim:open-water': { tier: 1, consequence: 'high', actionability: 'high', confidence: 'medium' },
  'swim:technique': { tier: 2, consequence: 'low', actionability: 'high', confidence: 'medium' },
  'swim:threshold-unknown': { tier: 2, consequence: 'medium', actionability: 'high', confidence: 'low' },
  'swim:too-early': { tier: 3, consequence: 'low', actionability: 'low', confidence: 'low' },
  'swim:none': { tier: 3, consequence: 'low', actionability: 'low', confidence: 'high' },
  'bike:consistency': { tier: 1, consequence: 'high', actionability: 'high', confidence: 'high' },
  'bike:bike-to-run': { tier: 1, consequence: 'high', actionability: 'medium', confidence: 'high' },
  'bike:durability': { tier: 1, consequence: 'high', actionability: 'medium', confidence: 'high' },
  'bike:fuelling': { tier: 1, consequence: 'high', actionability: 'high', confidence: 'medium' },
  'bike:threshold': { tier: 1, consequence: 'medium', actionability: 'high', confidence: 'high' },
  'bike:aero-tolerance': { tier: 1, consequence: 'medium', actionability: 'medium', confidence: 'medium' },
  'bike:data-confidence': { tier: 2, consequence: 'medium', actionability: 'high', confidence: 'low' },
  'bike:too-early': { tier: 3, consequence: 'low', actionability: 'low', confidence: 'low' },
  'bike:none': { tier: 3, consequence: 'low', actionability: 'low', confidence: 'high' },
  // the run's limiter is a readiness component in one of two states
  'run:at-risk': { tier: 1, consequence: 'high', actionability: 'medium', confidence: 'high' },
  'run:building': { tier: 2, consequence: 'medium', actionability: 'medium', confidence: 'medium' },
};

const CONSEQ_RANK = { high: 2, medium: 1, low: 0 };
const DISC_ORDER = { run: 0, bike: 1, swim: 2 };

const disciplineAllowed = (plan, disc) => {
  if (!plan || plan.race === 'tracker') return false;
  const race = RACES[plan.race] || {};
  if (race.solo && race.solo !== disc) return false;
  if (plan.profile && plan.profile.excludedDiscipline === disc) return false;
  return true;
};

/* The candidates, from the same builders the dashboard components render. */
export function limiterCandidates({ plan, log, moves, activities, todayISO, retest, ftpRetest, durabilityReads, fuelLog, positionLog }) {
  const out = [];
  if (disciplineAllowed(plan, 'swim')) {
    const d = swimDashboard({ plan, log, moves, activities, todayISO, retest });
    if (d && d.limiter) out.push({ discipline: 'swim', id: 'swim:' + d.limiter.id, label: d.limiter.headline, evidence: d.limiter.evidence || [] });
  }
  if (disciplineAllowed(plan, 'bike')) {
    const d = bikeDashboard({ plan, log, moves, activities, todayISO, retest: ftpRetest, durabilityReads, fuelLog, positionLog });
    if (d && d.limiter) out.push({ discipline: 'bike', id: 'bike:' + d.limiter.id, label: d.limiter.headline, evidence: d.limiter.evidence || [] });
  }
  if (disciplineAllowed(plan, 'run')) {
    const profile = plan.profile || {};
    const reviews = runStoredReviews(plan, log, moves);
    const runFuelLogs = Object.values(fuelLog || {}).filter(f => f && f.discipline === 'run');
    const d = runDashboard({ profile, plan, activities, log, reviews, fuelLogs: runFuelLogs, todayISO, raceKey: plan.race });
    const lim = d && d.nextAction && d.nextAction.limiter;
    if (lim) out.push({ discipline: 'run', id: 'run:' + lim.state, label: lim.why, component: lim.component, evidence: [lim.why] });
  }
  return out;
}

/* Why the winner wins, in the athlete's words: composed from declared
   fragments, never from numbers. */
const CONSEQ_WORDS = {
  high: 'it costs the most on race day',
  medium: 'it shapes how the race goes',
  low: 'it is worth tidying when the bigger things are settled',
};
const winnerReason = (c, entry, hadMeasured) => {
  if (entry.tier === 1) {
    return 'because it is actually measured in your recent sessions, ' + CONSEQ_WORDS[entry.consequence]
      + ', and it can be worked on without touching the other disciplines.';
  }
  if (entry.tier === 2) {
    return hadMeasured
      ? 'because nothing measured argues louder, and answering it would unlock the reads that are still dark.'
      : 'because the biggest gap right now is what Try cannot yet see, and it is cheap to fix.';
  }
  return 'because nothing measured argues for attention anywhere: keep training the plan as written.';
};

export function arbitrateLimiters(candidates) {
  const enriched = (candidates || [])
    .map(c => ({ ...c, entry: LIMITER_TABLE[c.id] || { tier: 2, consequence: 'low', actionability: 'low', confidence: 'low' } }));
  if (!enriched.length) return null;
  const sorted = [...enriched].sort((a, b) =>
    a.entry.tier - b.entry.tier
    || CONSEQ_RANK[b.entry.consequence] - CONSEQ_RANK[a.entry.consequence]
    || DISC_ORDER[a.discipline] - DISC_ORDER[b.discipline]);
  const winner = sorted[0];
  const hadMeasured = enriched.some(c => c.entry.tier === 1);
  const suppressed = sorted.slice(1).map(c => ({
    id: c.id, discipline: c.discipline, label: c.label,
    reason: c.entry.tier > winner.entry.tier
      ? 'a measured problem outranks it'
      : CONSEQ_RANK[c.entry.consequence] < CONSEQ_RANK[winner.entry.consequence]
        ? 'also real, but it costs less on race day'
        : 'also real; the ' + winner.discipline + ' comes first because its cost lands latest in the race',
  }));
  return {
    winner: { id: winner.id, discipline: winner.discipline, label: winner.label },
    reason: winnerReason(winner, winner.entry, hadMeasured),
    suppressed,
    allClear: winner.entry.tier === 3,
  };
}
