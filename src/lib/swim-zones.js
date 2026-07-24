/* Try — swim CSS training zones (swim build-out phase 3, 2026-07-23).
 *
 * The one place swim pace zones live. Every zone is an offset from the
 * athlete's CSS pace in seconds per 100 m (canonical); positive is SLOWER.
 * Generation, display, review, export and retarget all derive their swim
 * paces from here, so a zone is defined once and never duplicated in a
 * workout template.
 *
 * Offsets signed off by Jon 2026-07-23. This recalibration deliberately moves
 * cool-downs and recovery swimming to a true Recovery zone (+20, was the old
 * +12 easy); endurance (Aerobic +6), threshold (CSS 0) and fast work
 * (Above CSS -6) keep their paces, and Tempo (+3) is newly available.
 */

// min = the faster edge (smaller offset), max = the slower edge.
export const SWIM_ZONES = [
  { id: 'recovery',  label: 'Recovery',  target: 20, min: 16,  max: 24 },
  { id: 'technique', label: 'Technique', target: 12, min: 9,   max: 15 },
  { id: 'aerobic',   label: 'Aerobic',   target: 6,  min: 3,   max: 9 },
  { id: 'tempo',     label: 'Tempo',     target: 3,  min: 1,   max: 5 },
  { id: 'css',       label: 'CSS',       target: 0,  min: -2,  max: 2 },
  { id: 'above',     label: 'Above CSS', target: -6, min: -10, max: -2 },
];
const BY_ID = Object.fromEntries(SWIM_ZONES.map(z => [z.id, z]));

/** The single target pace for a zone (sec/100 m). Unknown id falls back to CSS. */
export function zoneTarget(css100mSec, zoneId) {
  const z = BY_ID[zoneId];
  return z ? css100mSec + z.target : css100mSec;
}

/** The pace RANGE for a zone: { minSecondsPer100m (faster), maxSecondsPer100m (slower) }. */
export function targetPaceForZone(css100mSec, zoneId) {
  const z = BY_ID[zoneId] || BY_ID.css;
  return { minSecondsPer100m: css100mSec + z.min, maxSecondsPer100m: css100mSec + z.max };
}

/** Every zone's target keyed by id, the shape computePaces stores on pc.swim. */
export function swimZoneTargets(css100mSec) {
  const out = {};
  for (const z of SWIM_ZONES) out[z.id] = css100mSec + z.target;
  return out;
}
