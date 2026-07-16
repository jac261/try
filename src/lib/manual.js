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

// The matcher's own acceptance window, anchored on the manual entry's
// duration, so "shadowed" and "would have auto-matched" mean the same thing
// everywhere; discipline equivalence comes from the same DISCIPLINE map the
// matcher uses, so a treadmill VirtualRun shadows a logged run too.
function isShadowed(entry, feed) {
  return feed.some(a => a && a.date === entry.date && DISCIPLINE[a.type] === entry.sport
    && a.movingTimeSec != null
    && a.movingTimeSec / 60 >= entry.durationMin * MATCH_WINDOW.lo
    && a.movingTimeSec / 60 <= entry.durationMin * MATCH_WINDOW.hi);
}

// feed (the intervals.icu list or null) + stored manual entries → one
// date-sorted display list. Pure and null-safe on both sides.
export function mergeActivities(feed, manualEntries) {
  const feedList = (feed || []).filter(Boolean);
  const survivors = (manualEntries || []).filter(m => m && !isShadowed(m, feedList));
  return feedList.concat(survivors.map(manualToActivity)).sort((a, b) => (a.date < b.date ? -1 : 1));
}
