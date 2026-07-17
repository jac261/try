/* Try — manually logged sessions (the sensor-less diary).
 *
 * A manual entry is a session the athlete DID but no watch recorded: logged
 * by hand in tracker mode, stored per-user on this device (storage.js
 * manualActivities; local-only until the backend grows a free-standing
 * activities endpoint), and merged into the activities feed shape so every
 * existing consumer — the Recorded list, the calendar diary, the weekly
 * digest, the tracker load model — counts it without learning a new type.
 *
 * Honesty rules baked in:
 *   - the merge produces a DISPLAY list only; the raw feed keeps driving the
 *     "connected" flag, auto-matching (spotted), eFTP proposals and brick
 *     pairing — a manual entry can never claim to be watch data
 *   - a manual entry's trainingLoad is machine-estimated at save time and
 *     carries estimated: true, so every surface can wear the tilde
 *   - shadowing: if the watch later syncs a recording that would have
 *     auto-matched the manual entry (same day, same sport, duration within
 *     the matcher's own acceptance window), the manual row silently steps
 *     aside in the merged view — never deleted, so it returns if the feed
 *     row ever disappears. No double-counting survives a reload.
 */

import { DISCIPLINE, MATCH_WINDOW } from './autolog.js';

// Manual sport → the feed's activity type vocabulary (autolog's DISCIPLINE
// map inverts this, so merged rows flow through every existing type lookup).
export const SPORT_FEED_TYPE = { run: 'Run', bike: 'Ride', swim: 'Swim', strength: 'WeightTraining' };

export function manualToActivity(entry) {
  return {
    id: 'manual-' + entry.id,
    date: entry.date,
    type: SPORT_FEED_TYPE[entry.sport],
    name: entry.sessionType,
    movingTimeSec: entry.durationMin * 60,
    trainingLoad: entry.trainingLoad,
    manual: true,
    estimated: true,
    manualId: entry.id,
    feel: entry.feel || null,
  };
}

// feed (the intervals.icu list or null) + stored manual entries → one
// date-sorted display list. Pure and null-safe on both sides.
// Shadowing is ONE TO ONE and BEST FIT, exactly like the matcher it mirrors:
// each recording hides at most the single closest-duration entry (window:
// the matcher's own, anchored on the entry's duration; discipline
// equivalence via the same DISCIPLINE map, so a treadmill VirtualRun shadows
// a logged run too). One-to-one because a synced recording once swallowed
// BOTH of a day's logged runs (sim catch 2026-07-17); best-fit by global
// closest-pair greedy because first-fit made the survivor depend on stored
// order, which editing an entry silently re-shuffles (re-verify catch).
export function mergeActivities(feed, manualEntries) {
  const feedList = (feed || []).filter(Boolean);
  const entries = (manualEntries || []).filter(Boolean);
  const pairs = [];
  entries.forEach((m, mi) => {
    feedList.forEach((a, ai) => {
      if (a.date === m.date && DISCIPLINE[a.type] === m.sport && a.movingTimeSec != null
        && a.movingTimeSec / 60 >= m.durationMin * MATCH_WINDOW.lo
        && a.movingTimeSec / 60 <= m.durationMin * MATCH_WINDOW.hi) {
        pairs.push({ mi, ai, diff: Math.abs(a.movingTimeSec / 60 - m.durationMin) });
      }
    });
  });
  pairs.sort((x, y) => x.diff - y.diff || x.ai - y.ai || x.mi - y.mi);
  const usedM = new Set(), usedA = new Set();
  pairs.forEach(p => {
    if (usedM.has(p.mi) || usedA.has(p.ai)) return;
    usedM.add(p.mi);
    usedA.add(p.ai);
  });
  const survivors = entries.filter((m, mi) => !usedM.has(mi));
  return feedList.concat(survivors.map(manualToActivity)).sort((a, b) => (a.date < b.date ? -1 : 1));
}
