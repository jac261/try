/* Try — bike distance, and what that number is actually claiming (phase 4
 * §1, §2, §3).
 *
 * The model itself is unchanged and deliberately so: §1 asks that it be
 * preserved, and every stored plan on every device already carries distances
 * built from it. What this module adds is provenance. A distance on a bike
 * card is not a measurement, it is the output of a zone-mix model under
 * stated assumptions, and until now the only thing recording that was a
 * boolean called distEst and a tilde in the UI.
 *
 * WHY THE ESTIMATE IS DERIVED AND NOT STORED. The plan DTO drops any field
 * it does not type, so a synced workout comes back without it: that is
 * exactly how distEst went missing and had to be backfilled on hydrate, and
 * how terrain tags went missing before it. A metadata object stored on the
 * workout would take the same route and be re-derived on arrival anyway, so
 * it is re-derived on read instead, from inputs that do round-trip. That
 * choice is the same one the swim and bike stabilise phases made against
 * their own §3 schema proposals, and for the same reason: the wire format is
 * the constraint, not a preference.
 *
 * §3's requirement then falls out of it. Because the estimate is a pure
 * function of the segments and the athlete's watts per kilo, "the same input
 * always produces the same estimate" is a property that can be tested rather
 * than a convention that has to be maintained, and a hydrated plan is
 * required to re-derive the number generation produced, exactly.
 */

/* Flat-to-rolling road speeds for the intermediate rung, by zone. */
export const ZONE_KMH = { Z1: 24, Z2: 28, Z3: 32, Z4: 35, Z5: 37 };
export const REF_WKG = 2.6;   // the rung ZONE_KMH is written for

/* Speed rises far more slowly than power (aerodynamic drag), so scale on a
   cube root: double the watts per kilo is about a quarter more speed. */
export function wkgScale(bikeWkg) {
  return Math.pow(((bikeWkg || REF_WKG) / REF_WKG), 1 / 3);
}

/* The distance model. Kept byte-identical to the shipped one: this phase
   documents the estimate, it does not move anybody's numbers. */
export function bikeDistance(segs, pc) {
  const wkg = (pc && pc.bikeWkg) || REF_WKG;
  const scale = wkgScale(wkg);
  let km = 0;
  const add = (min, zone) => { km += (min || 0) / 60 * (ZONE_KMH[zone] || ZONE_KMH.Z2) * scale; };
  (segs || []).forEach(s => { if (s.blocks) s.blocks.forEach(b => add(b.min, b.zone)); else add(s.min, s.zone); });
  return Math.round(km);
}

/* The zone mix the estimate was computed from, as minutes per zone. This is
   an ASSUMPTION and is reported as one: the athlete is credited with riding
   each zone at its table speed for the prescribed time, which is the part of
   the model most likely to be wrong on any given road. */
export function zoneMix(segs) {
  const mix = {};
  const add = (min, zone) => {
    const z = ZONE_KMH[zone] ? zone : 'Z2';
    mix[z] = (mix[z] || 0) + (min || 0);
  };
  (segs || []).forEach(s => { if (s.blocks) s.blocks.forEach(b => add(b.min, b.zone)); else add(s.min, s.zone); });
  return mix;
}

/* The zone mix in a form that can go in a sentence, hardest zone first, so
   the assumption is legible rather than a nested object nobody opens. */
export function zoneMixLabel(segs) {
  const mix = zoneMix(segs);
  return Object.keys(mix)
    .filter(z => mix[z] > 0)
    .sort((a, b) => b.localeCompare(a))
    .map(z => z + ' ' + Math.round(mix[z]) + ' min')
    .join(' · ');
}

/* §2: the estimate and everything it rests on.
 *
 * Returns null for anything that is not a modelled bike distance, so a
 * caller cannot accidentally present a swim's summed metres or a run's
 * pace-anchored distance as though it came from this model. isEstimated is
 * hardcoded true rather than computed, because there is no input to this
 * function that would make a zone-mix distance a measurement. */
export function bikeDistanceEstimate(workout, paces) {
  if (!workout || workout.discipline !== 'bike') return null;
  const segs = workout.segments || [];
  if (!segs.some(s => s && (s.zone || s.blocks))) return null;
  const bikeWkg = (paces && paces.bikeWkg) || REF_WKG;
  return {
    distanceKm: bikeDistance(segs, paces),
    source: 'zone-mix-estimate',
    isEstimated: true,
    assumptions: { bikeWkg, zoneMix: zoneMixLabel(segs) },
  };
}
