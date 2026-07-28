import { describe, it, expect } from 'vitest';
import {
  bikeLoad, powerLoadAvailable, normalizedWatts, intensityFactor, powerTss,
  variabilityIndex, NP_FIELD, POWER_LOAD_RULES,
} from './bike-load.js';

const HOUR = 3600;
const real = { ftp: 250, weightKg: 75, fitness: 'intermediate' };
const estimated = { weightKg: 75, fitness: 'intermediate' };      // no ftp: derived from level
const ride = (over = {}) => ({ id: 'a', type: 'Ride', movingTimeSec: HOUR, averageWatts: 230, ...over });
const withNp = (np, over = {}) => ride({ [NP_FIELD]: np, ...over });

describe('§6: the formulas are right, so the day the field lands is a wiring day', () => {
  it('an hour at threshold is an intensity factor of 1 and a TSS of 100', () => {
    // the definition both figures are calibrated against
    expect(intensityFactor(250, 250)).toBe(1);
    expect(powerTss(HOUR, 250, 250)).toBe(100);
  });

  it('scales as the definition says it does', () => {
    expect(intensityFactor(200, 250)).toBe(0.8);
    // TSS goes with the SQUARE of intensity: an hour at 0.8 is 64, not 80
    expect(powerTss(HOUR, 200, 250)).toBe(64);
    // and linearly with time
    expect(powerTss(2 * HOUR, 200, 250)).toBe(128);
  });

  it('variability index is normalized over average', () => {
    expect(variabilityIndex(250, 250)).toBe(1);      // held perfectly steady
    expect(variabilityIndex(250, 200)).toBe(1.25);   // ragged
  });

  it('refuses power data that is wrong rather than heroic', () => {
    // 1.5x threshold as a ride-long normalized power is a broken meter or a
    // wrong FTP, not a performance
    expect(intensityFactor(250 * 2, 250)).toBe(null);
    expect(powerTss(HOUR, 250 * 2, 250)).toBe(null);
    expect(intensityFactor(0, 250)).toBe(null);
    expect(intensityFactor(250, 0)).toBe(null);
  });
});

describe('§6/§3: the gate', () => {
  it('is shut today, because no ride carries normalized power', () => {
    expect(normalizedWatts(ride())).toBe(null);
    expect(powerLoadAvailable({ activity: ride(), profile: real })).toBe(false);
    expect(bikeLoad({ activity: ride(), profile: real })).toBe(null);
  });

  it('opens the moment the field arrives', () => {
    const a = withNp(235);
    expect(normalizedWatts(a)).toBe(235);
    expect(powerLoadAvailable({ activity: a, profile: real })).toBe(true);
    const load = bikeLoad({ activity: a, profile: real });
    expect(load.normalizedPowerWatts).toBe(235);
    expect(load.averagePowerWatts).toBe(230);
    expect(load.intensityFactor).toBe(0.94);
    expect(load.powerTss).toBe(88);
    expect(load.variabilityIndex).toBe(1.02);
  });

  it('never opens for an estimated FTP, even with perfect power data', () => {
    // §3: an estimated threshold may not produce TSS or IF. The number would
    // be arithmetic on a guess about the athlete's category.
    expect(powerLoadAvailable({ activity: withNp(235), profile: estimated })).toBe(false);
    expect(bikeLoad({ activity: withNp(235), profile: estimated })).toBe(null);
    expect(bikeLoad({ activity: withNp(235), profile: {} })).toBe(null);
  });

  it('never opens for a ride too short to anchor anything', () => {
    const short = withNp(235, { movingTimeSec: POWER_LOAD_RULES.minRideSec - 1 });
    expect(powerLoadAvailable({ activity: short, profile: real })).toBe(false);
    expect(bikeLoad({ activity: short, profile: real })).toBe(null);
  });
});

describe('§8: missing fields fail safely', () => {
  it('returns null rather than a zero, and never throws', () => {
    [null, undefined, {}, { movingTimeSec: 0 }, ride({ [NP_FIELD]: 'lots' }), ride({ [NP_FIELD]: -5 })]
      .forEach(a => {
        expect(() => bikeLoad({ activity: a, profile: real })).not.toThrow();
        expect(bikeLoad({ activity: a, profile: real })).toBe(null);
      });
    expect(bikeLoad({ activity: withNp(235), profile: null })).toBe(null);
  });

  it('does not invent normalized power from an average', () => {
    // the whole reason the gate exists: an average cannot become a normalized
    // power, and anything that returned one here would be a fiction every
    // downstream figure would inherit
    const a = ride({ averageWatts: 230 });
    expect(normalizedWatts(a)).toBe(null);
    expect(bikeLoad({ activity: a, profile: real })).toBe(null);
  });
});
