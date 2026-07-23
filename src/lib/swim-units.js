/* Try — swim pool-unit maths (swim build-out phase 2, 2026-07-22).
 *
 * The physiological truth is canonical and never moves: distance in metres,
 * pace in seconds per 100 metres, duration in seconds. A pool profile only
 * changes how prescribed work is EXPRESSED, at the display / construction
 * boundary. So changing the pool re-rounds the lengths but never re-scales CSS.
 *
 * On the 25 m pool (the default) every function here is the identity on the
 * current output: roundToPoolLength(100, 25 m) is 100, poolLabel(100, 25 m)
 * is '100 m'. That is what keeps existing athletes byte-identical. A 50 m
 * pool is the identity on the whole distances too (all are multiples of 50 m),
 * but NOT on a sub-50 m piece such as a quarter-rep drill split, which a 50 m
 * pool cannot swim and which correctly re-expresses as whole 50 m lengths.
 */

const YARD_M = 0.9144;

/** A pool length converted to metres (the canonical unit). */
export function poolLengthM(pool) {
  return pool.unit === 'yards' ? pool.length * YARD_M : pool.length;
}

/** Convert a distance in the given unit to canonical metres. */
export function toMetres(distance, unit) {
  return unit === 'yards' ? distance * YARD_M : distance;
}

/** Convert canonical metres to the given unit. */
export function fromMetres(metres, unit) {
  return unit === 'yards' ? metres / YARD_M : metres;
}

/** Whole pool lengths nearest to a metre target (never fewer than one). */
export function poolLengths(metres, pool) {
  return Math.max(1, Math.round(metres / poolLengthM(pool)));
}

/**
 * Round a metre target to a whole number of pool lengths, returned in metres.
 * The one guarantee the acceptance criteria hang on: the result is always an
 * exact multiple of the pool length, so no interval ends mid-length.
 */
export function roundToPoolLength(metres, pool) {
  return poolLengths(metres, pool) * poolLengthM(pool);
}

/** 'm' or 'yd'. */
export function unitShort(pool) {
  return pool.unit === 'yards' ? 'yd' : 'm';
}

/** The distance to SHOW, an integer in the pool's own unit (e.g. 100 for '100 yd'). */
export function poolDisplay(metres, pool) {
  return poolLengths(metres, pool) * pool.length;
}

/** A distance label in the pool's unit: '100 m', '100 yd'. */
export function poolLabel(metres, pool) {
  return poolDisplay(metres, pool) + ' ' + unitShort(pool);
}

/**
 * CSS shown per 100 of the pool's unit. CSS is stored per 100 m; a yard pool
 * displays the equivalent per-100-yd time. This is display only and never
 * writes back to the stored css100Sec.
 */
export function pacePer100ForDisplay(css100mSec, pool) {
  return pool.unit === 'yards' ? css100mSec * YARD_M : css100mSec;
}

/**
 * The inverse: take a pace the athlete entered per 100 of the pool's unit and
 * return canonical seconds per 100 m for storage. A yard swimmer who types a
 * per-100-yd time must not have it stored verbatim as per-100-m (that is ~9%
 * too fast); this converts it so css stays canonical whatever the pool.
 */
export function css100mFromDisplay(displaySec, pool) {
  return pool.unit === 'yards' ? displaySec / YARD_M : displaySec;
}
