import { describe, it, expect } from 'vitest';
import { toMetres, fromMetres, poolLengthM, poolLengths, roundToPoolLength, unitShort, poolDisplay, poolLabel, pacePer100ForDisplay, css100mFromDisplay, swimPaceLabel } from './swim-units.js';

/* Phase 2 pool maths. The load-bearing property is that for a 25 m or 50 m
   pool every helper is the identity on the current output (all distances are
   multiples of 50 m), which is what keeps existing athletes byte-identical. */

const M25 = { length: 25, unit: 'metres' };
const M50 = { length: 50, unit: 'metres' };
const Y25 = { length: 25, unit: 'yards' };

describe('unit conversion', () => {
  it('converts yards to metres and back', () => {
    expect(toMetres(100, 'metres')).toBe(100);
    expect(toMetres(100, 'yards')).toBeCloseTo(91.44, 2);
    expect(fromMetres(91.44, 'yards')).toBeCloseTo(100, 2);
    expect(poolLengthM(Y25)).toBeCloseTo(22.86, 2);
    expect(poolLengthM(M50)).toBe(50);
  });
});

describe('rounding to pool length', () => {
  it('is the identity for 25 m and 50 m pools on every distance a plan uses', () => {
    [50, 100, 200, 300, 400, 800, 1000, 1700, 3000].forEach(m => {
      expect(roundToPoolLength(m, M25)).toBe(m);
      expect(roundToPoolLength(m, M50)).toBe(m);
      expect(poolLabel(m, M25)).toBe(m + ' m');
      expect(poolLabel(m, M50)).toBe(m + ' m');
    });
  });
  it('always returns a whole number of lengths, never fewer than one, never partial', () => {
    [30, 100, 137, 400].forEach(m => {
      const lengths = poolLengths(m, Y25);
      expect(Number.isInteger(lengths)).toBe(true);
      expect(lengths).toBeGreaterThanOrEqual(1);
      expect(roundToPoolLength(m, Y25)).toBeCloseTo(lengths * poolLengthM(Y25), 6);
    });
    expect(poolLengths(1, Y25)).toBe(1); // never zero
  });
  it('rounds an odd custom metre pool to whole lengths', () => {
    const P33 = { length: 33, unit: 'metres' };
    expect(roundToPoolLength(100, P33)).toBe(99); // 3 lengths, not a 100 m partial
    expect(poolLabel(100, P33)).toBe('99 m');
  });
});

describe('display', () => {
  it('labels in the pool unit, showing round pool-unit numbers', () => {
    expect(poolLabel(100, Y25)).toBe('100 yd');   // 4 lengths of 25 yd
    expect(poolLabel(50, Y25)).toBe('50 yd');
    expect(unitShort(Y25)).toBe('yd');
    expect(unitShort(M25)).toBe('m');
    expect(poolDisplay(100, Y25)).toBe(100);
  });
  it('shows CSS per 100 of the pool unit without changing the stored value', () => {
    expect(pacePer100ForDisplay(120, M25)).toBe(120);          // per 100 m unchanged
    expect(pacePer100ForDisplay(120, Y25)).toBeCloseTo(109.7, 1); // per 100 yd is faster clock
  });
});

describe('CSS display / storage round-trip', () => {
  const Y25 = { length: 25, unit: 'yards' };
  const M25 = { length: 25, unit: 'metres' };
  it('per-100-unit entry converts back to canonical per-100 m, identity for metres', () => {
    // a yard swimmer enters their per-100-yd time; it must store slower per-100 m
    expect(css100mFromDisplay(100, Y25)).toBeCloseTo(109.36, 1);
    expect(css100mFromDisplay(120, M25)).toBe(120); // metre pool untouched
    // round-trips: display(store(x)) === x
    [90, 110, 130].forEach(css => {
      expect(css100mFromDisplay(pacePer100ForDisplay(css, Y25), Y25)).toBeCloseTo(css, 6);
    });
  });
});

describe('swimPaceLabel (the one shared display helper)', () => {
  it('renders per-100-pool-unit, identity for metres', () => {
    expect(swimPaceLabel(120, { length: 25, unit: 'metres' })).toBe('2:00 /100m');
    expect(swimPaceLabel(120, { length: 25, unit: 'yards' })).toBe('1:50 /100yd'); // 120 * 0.9144 = 109.7 -> 1:50
    expect(swimPaceLabel(120, { length: 50, unit: 'metres' })).toBe('2:00 /100m');
  });
});
