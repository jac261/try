import { runAnchor, bikePowerAnchor, swimThreshold, FITNESS, RACES, FTP_CONFIDENCE } from './domain.js';

/* The Assumption Center's one selector (phase 4, spec stage 6 "Consolidated
 * More"): what does Try currently BELIEVE about this athlete, per anchor,
 * and is each belief a measurement or a guess?
 *
 * This module narrates facts the domain anchors already own — it composes
 * runAnchor, bikePowerAnchor and swimThreshold and never recomputes them, so
 * it can never disagree with the dashboards reading the same anchors. The
 * view formats; this decides. Nothing here touches plan generation.
 *
 * kind semantics are the anchors' own:
 *   'real'       a number the athlete supplied or measured
 *   'estimated'  a guess — from the level table, or a feel-based tuning
 *                nudge (the two carry different sourceLabels; conflating
 *                them mislabelled a nudged number as a level estimate,
 *                gauntlet 2026-07-31)
 *   'none'       nothing at all — only the bike can be here (no FTP and no
 *                usable weight fails closed rather than projecting a number)
 */

// Athlete-facing provenance labels for MEASURED sources. The bike
// dashboard's own map stays local to it (its 'try-test' says "your bike
// test"); these are the discipline-neutral phrasings for the Settings card.
export const SOURCE_LABELS = {
  manual: 'Entered by hand',
  'try-test': 'Measured in a Try test',
  'recorded-race': 'From a recorded race',
  'activity-model': 'From the rolling estimate of your rides',
  'intervals-icu': 'From intervals.icu',
};
// Estimated provenance is not one thing: a level-table guess and a stored
// number written by a feel-based tuning nudge (fivekMeta/cssMeta source
// 'estimated') have different origins and must say so.
export const EST_LEVEL_LABEL = 'Estimated from your level';
export const EST_FELT_LABEL = 'Estimated from how your training felt';
export const EST_LEVEL_WEIGHT_LABEL = 'Estimated from your level and weight';

/* One row per discipline the plan actually trains, in the app's
 * swim/bike/run order. Solo plans collapse to their sport and an excluded
 * (injured) discipline is skipped — the engine sizes nothing for it, so a
 * row claiming otherwise would lie (both the Settings statline rule).
 * opts.tracker shows all three regardless: the numbers outlive the plan,
 * and a tracker profile KEEPS its old raceType (buildTrackerPlan only nulls
 * the date), so the solo collapse must not follow it into tracker mode. */
export function anchorAssumptions(profile, opts) {
  const p = profile || {};
  const tracker = !!(opts && opts.tracker);
  const solo = tracker ? null : (RACES[p.raceType] || {}).solo || null;
  const excluded = tracker ? null : p.excludedDiscipline || null;
  const on = d => (!solo || solo === d) && excluded !== d;
  const rows = [];

  if (on('swim')) {
    const s = swimThreshold(p);
    rows.push({
      discipline: 'swim',
      kind: s.kind,
      // An estimated swim may have no stored number at all; the level
      // table's guess is what actually sizes the sessions, so it is the
      // honest number to show (the statline does the same).
      css100Sec: s.cssSecondsPer100m || (FITNESS[p.fitness] || FITNESS.intermediate).estCss,
      source: s.source,
      // css present with source 'estimated' means a feel nudge WROTE that
      // number; css absent means the level table is guessing.
      sourceLabel: s.kind === 'real' ? (SOURCE_LABELS[s.source] || null)
        : s.cssSecondsPer100m ? EST_FELT_LABEL : EST_LEVEL_LABEL,
      measuredAt: s.measuredAt,
      confidence: s.confidence,
    });
  }

  if (on('bike')) {
    const b = bikePowerAnchor(p);
    rows.push({
      discipline: 'bike',
      kind: b.kind,
      ftpWatts: b.kind === 'none' ? null : b.ftpWatts,
      source: b.kind === 'real' ? b.source : b.kind === 'estimated' ? 'estimated' : null,
      sourceLabel: b.kind === 'real' ? (SOURCE_LABELS[b.source] || null)
        : b.kind === 'estimated' ? EST_LEVEL_WEIGHT_LABEL : null,
      measuredAt: b.kind === 'real' ? b.measuredAt : null,
      // bikePowerAnchor does not surface confidence; read it the way
      // bikeThresholdHistory does, validated against the closed set.
      confidence: b.kind === 'real' && FTP_CONFIDENCE.includes(((p.ftpMeta || {}).confidence))
        ? p.ftpMeta.confidence : null,
    });
  }

  if (on('run')) {
    const r = runAnchor(p);
    rows.push({
      discipline: 'run',
      kind: r.kind,
      timeSec: r.timeSec,
      source: r.source,
      // source 'estimated' is the stored feel-nudge number; the two level
      // sources are the table guessing from scratch.
      sourceLabel: r.kind === 'real' ? (SOURCE_LABELS[r.source] || null)
        : r.source === 'estimated' ? EST_FELT_LABEL : EST_LEVEL_LABEL,
      measuredAt: r.measuredAt || null,
      confidence: r.confidence || null,
    });
  }

  return rows;
}
