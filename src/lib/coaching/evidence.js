/* Try — shared coaching layer: the evidence vocabulary (phase 2 §2).
 *
 * Hoisted, not invented: SOURCE_KINDS/SOURCE_WORDS/metric are the swim
 * dashboard's §7 vocabulary verbatim (it now imports them back from here,
 * byte-identically), because the spec's five evidence kinds already existed
 * there. PROPOSAL_SOURCE_WORDS is the union of the two proposal sheets'
 * private prose maps — which had drifted: the bike's lacked 'estimated',
 * so an estimated source would have fallen to the generic "a new reading".
 *
 * Raw identifiers (sourceId: a workout or activity id) live BESIDE the
 * athlete-facing copy, never inside it; the UI label is prose, the data
 * model is the fields.
 */

export const SOURCE_KINDS = ['recorded', 'derived', 'reported', 'estimated', 'missing'];

export const SOURCE_WORDS = {
  recorded: 'from your recordings',
  derived: 'worked out from your plan and logs',
  reported: 'your own answer',
  estimated: 'an estimate',
  missing: 'not enough data yet',
};

/* Where a proposed number came from, in the athlete's words. Keyed by the
   meta source enums (domain.js): a per-discipline override first, the shared
   entry as fallback. */
export const PROPOSAL_SOURCE_WORDS = {
  'try-test': 'your test result',
  'try-test:swim': 'your swum 400/200 test',
  'try-test:bike': 'your bike test',
  'try-test:run': 'your run 5 km test',
  'activity-model': 'the rolling estimate from your rides',
  'intervals-icu': 'your intervals.icu threshold',
  'recorded-race': 'a recorded race',
  manual: 'a manual entry',
  estimated: 'an estimate',
};
export function proposalSourceWord(source, discipline) {
  return PROPOSAL_SOURCE_WORDS[source + ':' + discipline]
    || PROPOSAL_SOURCE_WORDS[source]
    || 'a new reading';
}

/* A metric with provenance: 'missing' is a first-class answer rather than a
   zero pretending to be data, and an unknown kind IS missing. */
export function metric(value, kind, note) {
  const k = SOURCE_KINDS.includes(kind) ? kind : 'missing';
  return { value: value == null ? null : value, kind: value == null ? 'missing' : k, note: note || null };
}

/* A decision-evidence item (spec §2). The constructor is the guard:
   - an unknown kind is 'missing', never a silent upgrade;
   - 'estimated' can never be re-kinded by later code because the item is
     frozen — provenance survives by construction. */
export function evidenceItem({ id, discipline, label, value, unit, kind, sourceId, observedAt, confidence, explanation }) {
  return Object.freeze({
    id: id || null,
    discipline: discipline || undefined,
    label: String(label || ''),
    value: value === undefined ? undefined : value,
    unit: unit || undefined,
    kind: SOURCE_KINDS.includes(kind) ? kind : 'missing',
    sourceId: sourceId || undefined,
    observedAt: observedAt || undefined,
    confidence: ['low', 'medium', 'high'].includes(confidence) ? confidence : 'low',
    explanation: explanation || undefined,
  });
}
