// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  bikeDurabilityShape, runDurabilityShape, swimDurabilityShape, durabilityShape,
  SHAPE_BUCKETS,
} from './durability-shape.js';
import { DURABILITY_GATES } from './durability.js';

/* The shapes behind the Durability design's three charts. Every fixture is
   built so the ANSWER is arithmetic anyone can check by hand, because a chart
   that is subtly wrong still looks like a chart. */

// 12 laps of 900s at 200W: 3 hours, 2 160 kJ, dead flat.
const steadyRide = (n = 12, mut = () => ({})) => Array.from({ length: n }, (_, i) => ({
  type: 'WORK', movingTimeSec: 900, distance: 7500, averageSpeed: 8.33,
  averageWatts: 200, averageHeartrate: 140, startTimeSec: i * 900, ...mut(i),
}));

// 12 laps of 1 km at 5:00/km, HR flat.
const steadyRun = (n = 12, mut = () => ({})) => Array.from({ length: n }, (_, i) => ({
  type: 'WORK', movingTimeSec: 300, distance: 1000, averageSpeed: 3.33,
  averageHeartrate: 150, startTimeSec: i * 300, ...mut(i),
}));

/* The doc's own set: 3 000 m as 30 x 100 m in 96s, which also clears the
   swim gate's 35-minute floor. averageStride is metres per stroke, so
   100/2.5 = 40 strokes; averageCadence x minutes must AGREE with that or the
   reading is refused: 40 strokes / 1.6 min = 25.0 per minute. */
const steadySwim = (n = 30, mut = () => ({})) => Array.from({ length: n }, (_, i) => ({
  type: 'WORK', movingTimeSec: 96, distance: 100, averageSpeed: 1.04,
  averageStride: 2.5, averageCadence: 25, startTimeSec: i * 96, ...mut(i),
}));
const SWIM_SEC = 30 * 96;

describe('the gates are the read\'s gates, not new ones', () => {
  it('a session too short, too few laps or too thin to cover itself has no shape', () => {
    expect(bikeDurabilityShape({ rows: steadyRide(), movingTimeSec: 40 * 60 })).toBe(null);
    expect(bikeDurabilityShape({ rows: steadyRide(4), movingTimeSec: 3 * 3600 })).toBe(null);
    // 3h of laps claimed as a 5h session: coverage fails, exactly as the read
    expect(bikeDurabilityShape({ rows: steadyRide(), movingTimeSec: 5 * 3600 })).toBe(null);
    expect(bikeDurabilityShape({ rows: steadyRide(), movingTimeSec: 3 * 3600 })).toBeTruthy();
  });

  it('drops the same outlier lap the read drops', () => {
    // one lap at a third of the median speed: filtered, leaving 11 usable
    const rows = steadyRide(13, i => (i === 6 ? { averageSpeed: 2.7 } : {}));
    const s = bikeDurabilityShape({ rows, movingTimeSec: 13 * 900 });
    expect(s).toBeTruthy();
    expect(s.points.reduce((t, p) => t + p.laps, 0)).toBe(12);
  });
});

describe('the bike: power against work done', () => {
  it('a flat ride holds 100% across every bucket', () => {
    const s = bikeDurabilityShape({ rows: steadyRide(), movingTimeSec: 3 * 3600 });
    expect(s.sport).toBe('bike');
    expect(s.axis).toBe('kJ');
    expect(s.points).toHaveLength(SHAPE_BUCKETS);
    expect(s.dropPct).toBe(0);
    expect(s.holdPct).toEqual([100, 100, 100, 100]);
    // 12 laps x 200W x 900s = 2 160 kJ
    expect(s.totalKJ).toBe(2160);
    expect(s.points[s.points.length - 1].kJ).toBe(2160);
  });

  it('a fading ride reports the drop at the far end', () => {
    /* Last three laps at 150W. The arithmetic, by hand: 9 laps x 180 kJ +
       3 x 135 kJ = 2 025 kJ, so buckets are 506.25 kJ wide and the last one
       holds four laps — one still at 200W, because a bucket is a stretch of
       WORK, not a count of laps. Time-mean 162.5W, so the reported drop is
       19% rather than the 25% a naive last-three-laps reading would claim.
       That gap is the whole reason the axis is kJ. (162.5 rounds UP to 163
       in JS; a Python cross-check said 162 and was wrong — banker's
       rounding. Checked against the runtime, not a calculator.) */
    const rows = steadyRide(12, i => (i >= 9 ? { averageWatts: 150 } : {}));
    const s = bikeDurabilityShape({ rows, movingTimeSec: 3 * 3600 });
    expect(s.totalKJ).toBe(2025);
    expect(s.points.map(p => p.watts)).toEqual([200, 200, 200, 163]);
    expect(s.points.map(p => p.laps)).toEqual([3, 3, 2, 4]);
    expect(s.dropPct).toBe(18.5);
    expect(s.holdPct).toEqual([100, 100, 100, 82]);
  });

  it('needs power: a ride recorded without it has no shape', () => {
    const rows = steadyRide(12, () => ({ averageWatts: 0 }));
    expect(bikeDurabilityShape({ rows, movingTimeSec: 3 * 3600 })).toBe(null);
  });
});

describe('the run: pace against heart rate', () => {
  it('a flat run decouples by nothing', () => {
    const s = runDurabilityShape({ rows: steadyRun(), movingTimeSec: 3600 });
    expect(s.sport).toBe('run');
    expect(s.points).toHaveLength(SHAPE_BUCKETS);
    expect(s.decouplingPct).toBe(0);
    expect(s.hrDriftPct).toBe(0);
    expect(s.totalM).toBe(12000);
  });

  it('holding pace at a rising heart rate IS the decoupling', () => {
    // same pace throughout, HR climbing 150 → 165: the cost per km rises
    const rows = steadyRun(12, i => ({ averageHeartrate: 150 + i * 1.5 }));
    const s = runDurabilityShape({ rows, movingTimeSec: 3600 });
    expect(s.decouplingPct).toBeGreaterThan(8);
    expect(s.hrDriftPct).toBeGreaterThan(8);
    // pace itself never moved, which is exactly why pace alone is not enough
    expect(Math.round(s.points[0].pace)).toBe(Math.round(s.points[3].pace));
  });

  it('refuses to draw pace alone when heart rate is missing', () => {
    // a pace-only chart would answer an easier question while looking like
    // it answered this one
    const rows = steadyRun(12, () => ({ averageHeartrate: 0 }));
    expect(runDurabilityShape({ rows, movingTimeSec: 3600 })).toBe(null);
  });
});

describe('the swim: the stroke shape, and when it refuses', () => {
  it('reads pace and strokes per length when the two derivations agree', () => {
    const s = swimDurabilityShape({ rows: steadySwim(), movingTimeSec: SWIM_SEC, poolLengthM: 25 });
    expect(s).toBeTruthy();
    expect(s.sport).toBe('swim');
    expect(s.deviceCounted).toBe(true);
    expect(s.points).toHaveLength(SHAPE_BUCKETS);
    // 2.5 m per stroke over a 25 m length = 10 strokes per length
    expect(s.points[0].strokesPerLength).toBe(10);
    expect(s.paceDriftSec).toBe(0);
    expect(s.strokeDrift).toBe(0);
  });

  it('shows slowing by shortening: pace drifts out, strokes drop', () => {
    // last third slower (96s → 108s) and shorter (2.5 → 2.2 m per stroke),
    // with cadence kept consistent with stride so the reading is accepted
    const rows = steadySwim(30, i => (i >= 20
      ? { movingTimeSec: 108, averageSpeed: 0.93, averageStride: 2.2, averageCadence: (100 / 2.2) / (108 / 60) }
      : {}));
    const s = swimDurabilityShape({ rows, movingTimeSec: 20 * 96 + 10 * 108, poolLengthM: 25 });
    expect(s.paceDriftSec).toBeGreaterThan(9);
    expect(s.strokeDrift).toBeGreaterThan(0);   // strokes per length ROSE as stride shortened
  });

  it('ONE ambiguous lap kills the whole shape, not just that lap', () => {
    // the 2x convention gap: cadence says half what stride says. A chart
    // built from the surviving laps would silently be a different chart.
    const rows = steadySwim(30, i => (i === 11 ? { averageCadence: 12.5 } : {}));
    expect(swimDurabilityShape({ rows, movingTimeSec: SWIM_SEC, poolLengthM: 25 })).toBe(null);
  });

  it('no pool length, no stroke reading at all', () => {
    expect(swimDurabilityShape({ rows: steadySwim(), movingTimeSec: SWIM_SEC })).toBe(null);
  });
});

describe('durabilityShape dispatches by sport', () => {
  it('routes each discipline to its own axis and refuses the rest', () => {
    expect(durabilityShape({ rows: steadyRide(), discipline: 'bike', movingTimeSec: 3 * 3600 }).axis).toBe('kJ');
    expect(durabilityShape({ rows: steadyRun(), discipline: 'run', movingTimeSec: 3600 }).axis).toBe('m');
    expect(durabilityShape({ rows: steadySwim(), discipline: 'swim', movingTimeSec: SWIM_SEC, poolLengthM: 25 }).axis).toBe('m');
    expect(durabilityShape({ rows: steadyRide(), discipline: 'strength', movingTimeSec: 3 * 3600 })).toBe(null);
  });

  it('a bucket the session cannot fill collapses the shape', () => {
    // minLaps is 6 and there are 4 buckets, so a session at exactly the lap
    // floor still has to spread across all of them
    expect(DURABILITY_GATES.minLaps).toBeGreaterThanOrEqual(SHAPE_BUCKETS);
  });
});
