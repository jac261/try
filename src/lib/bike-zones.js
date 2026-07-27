/* Try — the bike power zones, in one place.
 *
 * Percentages of FTP. Before this, generation carried twelve band literals
 * scattered through buildBike and the review carried four of its own, and
 * they disagreed: a Tempo session prescribed 190 to 213 W (76 to 85% of a
 * 250 W FTP) while the review judged the same reps against 83 to 90%, so a
 * rider riding at 195 W, squarely inside the band on their own card, was
 * told they came in under target. One table now answers both.
 *
 * Generation is deliberately NOT rewritten to these numbers (Jon,
 * 2026-07-27): several of its bands are considered variations rather than
 * mistakes, and normalising them would change prescribed watts in most bike
 * sessions for every athlete. They are listed in ZONE_VARIANTS so they are
 * documented rather than mysterious.
 */

/* The canonical zones. min/max are fractions of FTP, and the ranges are the
   ones generation already prescribes for each named session type, so the
   review agrees with the card by construction. */
export const BIKE_ZONES = [
  { id: 'recovery', label: 'Recovery', zone: 'Z1', min: 0.50, max: 0.60 },
  { id: 'endurance', label: 'Endurance', zone: 'Z2', min: 0.60, max: 0.75 },
  { id: 'tempo', label: 'Tempo', zone: 'Z3', min: 0.76, max: 0.85 },
  { id: 'sweet-spot', label: 'Sweet Spot', zone: 'Z3', min: 0.84, max: 0.90 },
  { id: 'threshold', label: 'Threshold', zone: 'Z4', min: 0.95, max: 1.05 },
  { id: 'vo2', label: 'VO2', zone: 'Z5', min: 1.06, max: 1.20 },
];

/* The bands generation uses that are NOT one of the six above. Each is a
   deliberate variation, and writing them down is the point: an undocumented
   outlier is indistinguishable from a bug.
     0.55-0.65 Z2  a warm-up, deliberately below endurance proper
     0.83-0.90 Z3  the tempo surges inside a long ride, which sit high on
                   purpose because they are short and late
     0.72-0.80 Z3  low-cadence torque work, deliberately sub-tempo because
                   the load is muscular rather than metabolic
     0.90-1.05 Z4  a threshold variant with a softer floor
     0.98-1.08 Z4  a threshold variant with a firmer floor
     1.06-1.15 Z5  a shorter VO2 variant */
export const ZONE_VARIANTS = [
  { lo: 0.55, hi: 0.65, zone: 'Z2', why: 'warm-up, below endurance proper' },
  { lo: 0.83, hi: 0.90, zone: 'Z3', why: 'tempo surges inside a long ride' },
  { lo: 0.72, hi: 0.80, zone: 'Z3', why: 'low-cadence torque work, sub-tempo on purpose' },
  { lo: 0.90, hi: 1.05, zone: 'Z4', type: 'Threshold', why: 'over-unders: the honest rep average sits near the floor by design' },
  { lo: 0.98, hi: 1.08, zone: 'Z4', type: 'Threshold', why: 'threshold with a firmer floor' },
  { lo: 1.06, hi: 1.15, zone: 'Z5', type: 'VO2 Intervals', why: 'shorter VO2 variant' },
];

/* The band the REVIEW judges a rep against: the union of every card that
   session type actually prescribes. The canonical band alone re-created the
   Tempo defect on the over-under Threshold variant, whose card reads 90 to
   105 percent: a perfectly executed over-under rep averages near 90 by
   design (two minutes under for every minute over) and was being told it
   came in under. Where variants differ, the judge must be at least as
   permissive as the most permissive card: erring lenient on the strict
   variant is a smaller wrong than contradicting the athlete's own card. */
export function judgeBandForType(type) {
  const z = zoneForType(type);
  if (!z) return null;
  let lo = z.min, hi = z.max;
  ZONE_VARIANTS.filter(v => v.type === type).forEach(v => {
    lo = Math.min(lo, v.lo);
    hi = Math.max(hi, v.hi);
  });
  return [lo, hi];
}

// Which zone a session type trains. The review reads this so it judges a
// rep against the band the card actually asked for.
export const TYPE_ZONE = {
  Endurance: 'endurance',
  Tempo: 'tempo',
  'Sweet Spot': 'sweet-spot',
  Threshold: 'threshold',
  'VO2 Intervals': 'vo2',
  Long: 'endurance',
};

export function bikeZone(id) {
  return BIKE_ZONES.find(z => z.id === id) || null;
}

export function zoneForType(type) {
  return bikeZone(TYPE_ZONE[type]);
}

/* The watt range a zone means for this athlete, or null when there is no
   real FTP to anchor it to. Callers that need a number for display may pass
   an estimated FTP knowingly; callers that make judgements must not. */
export function wattsForZone(ftpWatts, id) {
  const z = bikeZone(id);
  if (!z || !ftpWatts) return null;
  return { min: Math.round(ftpWatts * z.min), max: Math.round(ftpWatts * z.max) };
}

// The percentage band a session type is judged against, as [min, max]
// fractions. Returns null for types with no power target.
export function bandForType(type) {
  const z = zoneForType(type);
  return z ? [z.min, z.max] : null;
}
