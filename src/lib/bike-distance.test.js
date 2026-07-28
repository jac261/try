import { describe, it, expect } from 'vitest';
import { generatePlan, upgradePlanSegments } from './plan.js';
import { reviewActivity, intervalRows, REP_TOLERANCE, OUTDOOR_REP_TOLERANCE } from './review.js';
import { isIndoor } from './autolog.js';
import { bikeDistanceEstimate, bikeDistance, zoneMixLabel, REF_WKG } from './bike-distance.js';
import { isTrainingRide } from './bikeschema.js';

const base = {
  name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-11-01',
};
const rides = plan => plan.weeks.flatMap(w => w.workouts).filter(isTrainingRide);

describe('§1: the distance estimate is preserved, and stays strength-sensitive', () => {
  it('a stronger rider covers more ground in the same session', () => {
    const segs = [{ label: 'Steady', min: 60, zone: 'Z2' }];
    const weak = bikeDistance(segs, { bikeWkg: 2.0 });
    const ref = bikeDistance(segs, { bikeWkg: REF_WKG });
    const strong = bikeDistance(segs, { bikeWkg: 4.0 });
    expect(weak).toBeLessThan(ref);
    expect(ref).toBeLessThan(strong);
    // and on a cube root, so the gain is far smaller than the power gain:
    // double the watts per kilo must not double the distance
    expect(bikeDistance(segs, { bikeWkg: 5.2 })).toBeLessThan(ref * 1.5);
  });

  it('a harder session covers more ground than an easy one of equal length', () => {
    const easy = bikeDistance([{ min: 60, zone: 'Z1' }], { bikeWkg: REF_WKG });
    const hard = bikeDistance([{ min: 60, zone: 'Z4' }], { bikeWkg: REF_WKG });
    expect(hard).toBeGreaterThan(easy);   // the point of the zone mix model
  });

  it('every generated bike distance stays flagged as an estimate', () => {
    const p = generatePlan(base);
    rides(p).filter(w => w.distance != null).forEach(w => {
      expect(w.distEst, w.type + ' lost its tilde').toBe(true);
    });
  });
});

describe('§2: the estimate says what it assumed', () => {
  it('carries its source, its estimated-ness and its inputs', () => {
    const p = generatePlan(base);
    const w = rides(p).find(x => x.distance != null && (x.segments || []).some(s => s.zone || s.blocks));
    const est = bikeDistanceEstimate(w, p.paces);
    expect(est.source).toBe('zone-mix-estimate');
    expect(est.isEstimated).toBe(true);
    expect(est.distanceKm).toBe(w.distance);            // the same number the card shows
    expect(est.assumptions.bikeWkg).toBe(p.paces.bikeWkg);
    expect(est.assumptions.zoneMix.length).toBeGreaterThan(0);
  });

  it('refuses to describe anything that is not a modelled bike distance', () => {
    const p = generatePlan(base);
    const swim = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'swim');
    // a swim's distance is summed prescribed metres, not a model, and must
    // never be presentable as one
    expect(bikeDistanceEstimate(swim, p.paces)).toBe(null);
    expect(bikeDistanceEstimate(null, p.paces)).toBe(null);
    expect(bikeDistanceEstimate({ discipline: 'bike', segments: [] }, p.paces)).toBe(null);
  });

  it('the reported zone mix is the mix the number was computed from', () => {
    const segs = [{ min: 15, zone: 'Z2' }, { min: 30, zone: 'Z3' }, { min: 10, zone: 'Z1' }];
    const label = zoneMixLabel(segs);
    expect(label).toContain('Z3 30 min');
    expect(label).toContain('Z2 15 min');
    expect(label).toContain('Z1 10 min');
  });
});

describe('§3: re-derivation is deterministic, and is a contract not a convention', () => {
  it('the same input always produces the same estimate', () => {
    const p = generatePlan(base);
    rides(p).forEach(w => {
      const a = bikeDistanceEstimate(w, p.paces);
      const b = bikeDistanceEstimate(w, p.paces);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      if (a) expect(bikeDistance(w.segments, p.paces)).toBe(a.distanceKm);
    });
  });

  it('hydrate re-derives exactly what generation produced', () => {
    // The wire drops fields it does not type — that is how distEst went
    // missing and had to be backfilled. So: strip it the way the DTO does,
    // hydrate, and require the numbers to come back identical. A plan that
    // re-derived a DIFFERENT distance would move an athlete's card on sync
    // without anybody touching anything.
    const p = generatePlan(base);
    const stripped = {
      ...p,
      weeks: p.weeks.map(wk => ({
        ...wk,
        workouts: wk.workouts.map(w => { const c = { ...w }; delete c.distEst; return c; }),
      })),
    };
    const back = upgradePlanSegments(stripped);
    const before = rides(p), after = rides(back);
    expect(after.length).toBe(before.length);
    before.forEach((w, i) => {
      expect(after[i].distance, w.type + ' distance moved on hydrate').toBe(w.distance);
      expect(after[i].distEst, w.type + ' lost its tilde on hydrate').toBe(w.distEst);
      expect(after[i].durationMin).toBe(w.durationMin);
    });
  });

  it('hydrating twice changes nothing further', () => {
    const p = generatePlan(base);
    const once = upgradePlanSegments(p);
    const twice = upgradePlanSegments(once);
    expect(rides(twice).map(w => w.distance)).toEqual(rides(once).map(w => w.distance));
  });
});

describe('§4: an indoor ride cannot distort anything outdoor', () => {
  const p = generatePlan(base);
  const w = rides(p).find(x => x.type === 'Endurance');
  // a turbo reports a virtual distance: 30 km in an hour that never moved
  const indoor = { id: 'v', type: 'VirtualRide', date: '2026-06-10', movingTimeSec: 3600, distance: 30000, averageWatts: 180, trainingLoad: 60 };
  const outdoor = { ...indoor, id: 'o', type: 'Ride' };

  it('is recognised as indoor', () => {
    expect(isIndoor(indoor)).toBe(true);
    expect(isIndoor(outdoor)).toBe(false);
  });

  it('suppresses derived speed and distance, and keeps duration and power', () => {
    const inside = Object.fromEntries(reviewActivity({ workout: w, activity: indoor, paces: p.paces }).stats);
    const outside = Object.fromEntries(reviewActivity({ workout: w, activity: outdoor, paces: p.paces }).stats);
    expect(inside['Avg speed']).toBeUndefined();     // would be fabricated
    expect(outside['Avg speed']).toBeTruthy();
    expect(inside['Avg power']).toBeTruthy();        // measured, so it counts
    expect(inside['Load']).toBeTruthy();
  });

  it('no stat rendered indoors is derived from the virtual distance', () => {
    const stats = reviewActivity({ workout: w, activity: indoor, paces: p.paces }).stats;
    // 30 km at 30 km/h: any leaked speed or distance would show one of these
    const text = stats.map(([k, v]) => k + ' ' + v).join(' | ');
    expect(text).not.toMatch(/km\/h/);
    expect(text).not.toMatch(/30\.0|30 km/);
  });
});

describe('§7: outdoor rides are not judged by indoor-style adherence', () => {
  const p = generatePlan({ ...base, ftp: 250 });
  const w = rides(p).find(x => x.type === 'Threshold') || rides(p).find(x => x.type === 'Sweet Spot');
  const lap = watts => ({ type: 'WORK', movingTimeSec: 600, averageWatts: watts });
  const rowsFor = (watts, activity) =>
    intervalRows({ workout: w, intervals: [lap(watts), lap(watts)], paces: p.paces, activity });

  it('the allowance is one-sided, and wider than the indoor one', () => {
    expect(OUTDOOR_REP_TOLERANCE).toBeGreaterThan(REP_TOLERANCE);
  });

  it('a rep that junctions pulled low is on target outdoors and under indoors', () => {
    // sits between the two tolerances on the LOW side
    const band = { Threshold: 0.9, 'Sweet Spot': 0.84 }[w.type];
    const watts = Math.round(250 * (band - (REP_TOLERANCE + OUTDOOR_REP_TOLERANCE) / 2));
    const out = rowsFor(watts, { id: 'o', type: 'Ride', movingTimeSec: 3600 });
    const ind = rowsFor(watts, { id: 'v', type: 'VirtualRide', movingTimeSec: 3600 });
    expect(out.rows[0].tone).toBe('good');
    expect(ind.rows[0].tone).toBe('info');
    expect(out.note, 'the allowance changed a verdict and must say so').toBeTruthy();
    expect(ind.note).toBe(null);
  });

  it('riding too hard outdoors is still riding too hard', () => {
    // the road can only ever REMOVE work from an average, so the high side
    // gets no allowance at all
    const hot = rowsFor(400, { id: 'o', type: 'Ride', movingTimeSec: 3600 });
    expect(hot.rows[0].tone).toBe('warn');
    expect(hot.note).toBe(null);
  });

  it('a caller that cannot say where the ride happened gets the old behaviour', () => {
    const band = { Threshold: 0.9, 'Sweet Spot': 0.84 }[w.type];
    const watts = Math.round(250 * (band - (REP_TOLERANCE + OUTDOOR_REP_TOLERANCE) / 2));
    expect(rowsFor(watts, undefined).rows[0].tone).toBe('info');
  });
});
