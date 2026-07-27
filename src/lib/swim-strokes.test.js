import { describe, it, expect } from 'vitest';
import {
  strokeDataQuality, lapStrokeMetrics, strokeSessionSummary,
  strokeMetricsEnabled, STROKE_RULES,
} from './swim-strokes.js';

/* Phase 8. The fixture is REAL: laps from a Garmin fenix 7 Pro pool swim in
   the athlete's own intervals.icu account (2026-07-22, 25 m pool), mapped
   into the shape the backend would have to pass through. Using real values
   is the point — the factor-of-two stroke-count disagreement below is a
   property of actual device data, not something invented for a test. */

const realLaps = [
  { type: 'WORK', distance: 100, movingTimeSec: 114, averageCadence: 25.5, averageStride: 1.032 },
  { type: 'RECOVERY', distance: null, movingTimeSec: 32, averageCadence: null, averageStride: 0 },
  { type: 'WORK', distance: 125, movingTimeSec: 126, averageCadence: 24.333334, averageStride: 1.223 },
  { type: 'RECOVERY', distance: null, movingTimeSec: 105, averageCadence: null, averageStride: 0 },
  { type: 'WORK', distance: 100, movingTimeSec: 180, averageCadence: 18.877777, averageStride: 0.883 }, // drill
  { type: 'RECOVERY', distance: null, movingTimeSec: 21, averageCadence: null, averageStride: 0 },
  { type: 'WORK', distance: 50, movingTimeSec: 62, averageCadence: 24.35484, averageStride: 0.993 },
];
const realActivity = {
  type: 'Swim', poolLengthM: 25, lengths: 75,
  averageCadence: 24.740303, averageStride: 1.0755053,
  deviceName: 'Garmin fenix 7 Pro', deviceSource: 'GARMIN_CONNECT',
};

describe('the gate: nothing runs until the backend carries the fields (§8)', () => {
  it('today backend shape produces no analysis at all', () => {
    // what the client actually receives right now: no stroke fields anywhere
    const bare = { type: 'Swim', movingTimeSec: 2114, distance: 1875 };
    const bareLaps = [{ type: 'WORK', distance: 100, movingTimeSec: 114 }];
    const q = strokeDataQuality({ activity: bare, laps: bareLaps });
    expect(q.available).toBe(false);
    expect(q.reason).toBeTruthy();
    expect(strokeSessionSummary({ activity: bare, laps: bareLaps }).summary).toBe(null);
  });

  it('is opt-in even once the data exists, so it cannot start speaking on its own', () => {
    expect(strokeMetricsEnabled({ activity: realActivity, laps: realLaps, enabled: false })).toBe(false);
    expect(strokeMetricsEnabled({ activity: realActivity, laps: realLaps, enabled: true })).toBe(true);
  });

  it('open water has no pool stroke metrics and says so rather than guessing', () => {
    const q = strokeDataQuality({ activity: { ...realActivity, type: 'OpenWaterSwim' }, laps: realLaps });
    expect(q.available).toBe(false);
    expect(q.openWater).toBe(true);
    expect(q.reason).toMatch(/open-water/i);
  });
});

describe('the factor-of-two problem, found in real device data (§3, §4)', () => {
  it('refuses a single stroke count when the two derivations disagree', () => {
    const m = lapStrokeMetrics(realLaps[0], { poolLengthM: 25 });
    // distance/stride = 96.9 strokes; cadence x time = 48.5. One counts arm
    // strokes, the other counts cycles. Which is a device convention.
    expect(m.mismatch).toBeTruthy();
    expect(m.mismatch.ratio).toBeCloseTo(2, 1);
    expect(m.strokes).toBe(null);
    expect(m.swolf).toBe(null);      // and no SWOLF built on a number we do not have
  });

  it('still reports what each field says, because both are real measurements', () => {
    const m = lapStrokeMetrics(realLaps[0], { poolLengthM: 25 });
    expect(m.strokeRate).toBeCloseTo(25.5, 1);
    expect(m.distancePerStroke).toBeCloseTo(1.032, 3);
    expect(m.pace100).toBeCloseTo(114, 0);
  });

  it('quotes a count only when the two agree', () => {
    // a device whose conventions line up: 50 m, 1.0 m per stroke, 50 strokes
    // over 60 s = 50/min
    const agree = { type: 'WORK', distance: 50, movingTimeSec: 60, averageCadence: 50, averageStride: 1.0 };
    const m = lapStrokeMetrics(agree, { poolLengthM: 25 });
    expect(m.strokes).toBe(50);
    expect(m.strokesPerLength).toBe(25);
    expect(m.swolf).toBe(55);        // 30 s per length + 25 strokes per length
    expect(m.swolfDerived).toBe(true);
  });
});

describe('SWOLF is ours, derived, and never invented (§3, §7)', () => {
  it('has no SWOLF without a pool length, because there is no length to count over', () => {
    const agree = { type: 'WORK', distance: 50, movingTimeSec: 60, averageCadence: 50, averageStride: 1.0 };
    expect(lapStrokeMetrics(agree, {}).swolf).toBe(null);
  });
  it('is always labelled derived rather than passed off as the watch figure', () => {
    const agree = { type: 'WORK', distance: 50, movingTimeSec: 60, averageCadence: 50, averageStride: 1.0 };
    expect(lapStrokeMetrics(agree, { poolLengthM: 25 }).swolfDerived).toBe(true);
  });
});

describe('unusable laps produce nothing, not a fabricated estimate (§7)', () => {
  it('drops rests, wall touches and laps shorter than a length', () => {
    expect(lapStrokeMetrics(realLaps[1], { poolLengthM: 25 })).toBe(null);              // RECOVERY
    expect(lapStrokeMetrics({ type: 'WORK', distance: 100, movingTimeSec: 4 }, { poolLengthM: 25 })).toBe(null);
    expect(lapStrokeMetrics({ type: 'WORK', distance: 10, movingTimeSec: 60 }, { poolLengthM: 25 })).toBe(null);
  });
  it('a lap with no stroke fields still reads its pace and simply has no stroke numbers', () => {
    const m = lapStrokeMetrics({ type: 'WORK', distance: 100, movingTimeSec: 120 }, { poolLengthM: 25 });
    expect(m.pace100).toBe(120);
    expect(m.strokeRate).toBe(null);
    expect(m.strokes).toBe(null);
    expect(m.swolf).toBe(null);
  });
  it('partial coverage is visible as partial', () => {
    const mixed = realLaps.concat([{ type: 'WORK', distance: 100, movingTimeSec: 120 }]);
    expect(strokeDataQuality({ activity: realActivity, laps: mixed }).partial).toBe(true);
  });
});

describe('the descriptive summary (§5): ranges, drift, and no verdict', () => {
  const out = strokeSessionSummary({ activity: realActivity, laps: realLaps });

  it('reads the real session and reports ranges rather than a single figure', () => {
    expect(out.quality.available).toBe(true);
    expect(out.readable).toBeGreaterThan(0);
    expect(out.summary.strokeRate.min).toBeLessThanOrEqual(out.summary.strokeRate.max);
    expect(out.summary.distancePerStroke.min).toBeLessThanOrEqual(out.summary.distancePerStroke.max);
  });

  it('excludes the drill lap from the ranges but counts it out loud', () => {
    // the 100 m in 180 s at 18.9 spm is drill work: not comparable swimming
    expect(out.summary.excludedLaps).toBeGreaterThan(0);
    expect(out.summary.strokeRate.min).toBeGreaterThan(20);
  });

  it('surfaces how many laps had the device disagreement', () => {
    expect(out.summary.mismatchedLaps).toBeGreaterThan(0);
  });

  it('offers no better or worse anywhere in the output', () => {
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/better|worse|improv|declin|good|bad/i);
  });

  it('carries the device and source so cross-device differences stay visible (§8)', () => {
    expect(out.quality.device).toBe('Garmin fenix 7 Pro');
    expect(out.quality.source).toBe('GARMIN_CONNECT');
  });
});
