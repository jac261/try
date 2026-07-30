/* Try — shared coaching layer: the decision journal (phase 2 §9, stage 3
 * client-side).
 *
 * Terminal athlete actions only. Proposals re-derive on every render, so
 * journalling 'proposed' would be noise; what history needs is what the
 * ATHLETE did — accepted, rejected (a dismissal is a rejection, finally
 * recorded instead of overwriting a signature scalar), and superseded
 * (recorded with a reason rather than silently discarded, spec §7.3).
 *
 * Supersession is deterministic: when a decision is journalled and an
 * EARLIER entry of the same family (same engine, same sport for threshold
 * proposals) with a DIFFERENT id sits in the journal with latest status
 * 'rejected', that entry is first marked superseded — the situation moved
 * on, and the old rejection no longer describes a live offer. Rejected
 * rows are never deleted; a superseded row is appended, not rewritten.
 *
 * Device-local by design (COACH_BRAIN rule: a synced decision journal is a
 * backend ask, filed in BACKEND_HANDOFF). planCreatedAt stamps every row so
 * a future reader can tell this plan's story from a previous plan's.
 */

export function decisionFamily(id) {
  const parts = String(id || '').split(':');
  // threshold proposals compete per sport: a bike offer supersedes a
  // rejected bike offer, never a swim one
  if (parts[0] === 'eftp') return 'eftp:' + (parts[2] || '');
  return parts[0];
}

const latestStatusById = log => {
  const m = new Map();
  (log || []).forEach(e => m.set(e.id, e.status));
  return m;
};

/* Returns the rows to append (0..n): any same-family supersessions first,
   then the entry itself. Pure — the caller feeds them to storage. */
export function journalRows(log, decision, status, { at, planCreatedAt } = {}) {
  if (!decision || !decision.id) return [];
  const family = decisionFamily(decision.id);
  const latest = latestStatusById(log);
  const rows = [];
  [...latest.entries()]
    .filter(([id, st]) => id !== decision.id && st === 'rejected' && decisionFamily(id) === family)
    .forEach(([id]) => rows.push({
      id, at, planCreatedAt: planCreatedAt ?? null, status: 'superseded',
      headline: null, why: 'A newer proposal replaced it.',
      sourceEngine: decision.sourceEngine,
    }));
  rows.push({
    id: decision.id,
    at,
    planCreatedAt: planCreatedAt ?? null,
    status,
    action: decision.action,
    headline: decision.headline,
    why: decision.explanation,
    confidence: decision.confidence,
    sourceEngine: decision.sourceEngine,
    engineVersion: decision.sourceEngineVersion,
  });
  return rows;
}
