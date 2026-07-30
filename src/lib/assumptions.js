import { runAnchor, bikePowerAnchor, swimThreshold, FITNESS, RACES } from './domain.js';

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
 *   'estimated'  a level-table or feel-nudged guess: it may size sessions
 *                and display targets, it may never judge a session or drive
 *                a race projection (the engine already enforces both; this
 *                surface just says so out loud)
 *   'none'       nothing at all — only the bike can be here (no FTP and no
 *                usable weight fails closed rather than projecting a number)
 */

// Athlete-facing provenance labels, one per closed-set source. The bike
// dashboard's own map stays local to it (its 'try-test' says "your bike
// test"); these are the discipline-neutral phrasings for the Settings card.
export const SOURCE_LABELS = {
  manual: 'Entered by hand',
  'try-test': 'Measured in a Try test',
  'recorded-race': 'From a recorded race',
  'activity-model': 'From the rolling estimate of your rides',
  'intervals-icu': 'From intervals.icu',
  estimated: 'Estimated from your level',
  'runner-level': 'Estimated from your level',
  'triathlete-level': 'Estimated from your level',
};

/* One row per discipline the profile trains, in the app's swim/bike/run
 * order. Solo plans collapse to their sport (the Settings statline rule);
 * tracker and triathlon profiles show all three. Each row carries the raw
 * value fields (the view formats them with the shared formatters) plus
 * kind/source/measuredAt/confidence straight from the anchor. */
export function anchorAssumptions(profile) {
  const p = profile || {};
  const solo = (RACES[p.raceType] || {}).solo || null;
  const rows = [];

  if (!solo || solo === 'swim') {
    const s = swimThreshold(p);
    rows.push({
      discipline: 'swim',
      kind: s.kind,
      // An estimated swim may have no stored number at all; the level
      // table's guess is what actually sizes the sessions, so it is the
      // honest number to show (the statline does the same).
      css100Sec: s.cssSecondsPer100m || (FITNESS[p.fitness] || FITNESS.intermediate).estCss,
      source: s.source,
      sourceLabel: SOURCE_LABELS[s.source] || null,
      measuredAt: s.measuredAt,
      confidence: s.confidence,
    });
  }

  if (!solo || solo === 'bike') {
    const b = bikePowerAnchor(p);
    rows.push({
      discipline: 'bike',
      kind: b.kind,
      ftpWatts: b.kind === 'none' ? null : b.ftpWatts,
      source: b.kind === 'real' ? b.source : b.kind === 'estimated' ? 'estimated' : null,
      sourceLabel: b.kind === 'real' ? (SOURCE_LABELS[b.source] || null)
        : b.kind === 'estimated' ? SOURCE_LABELS.estimated : null,
      measuredAt: b.kind === 'real' ? b.measuredAt : null,
      confidence: null,
    });
  }

  if (!solo || solo === 'run') {
    const r = runAnchor(p);
    rows.push({
      discipline: 'run',
      kind: r.kind,
      timeSec: r.timeSec,
      source: r.source,
      sourceLabel: SOURCE_LABELS[r.source] || null,
      measuredAt: r.measuredAt || null,
      confidence: r.confidence || null,
    });
  }

  return rows;
}
