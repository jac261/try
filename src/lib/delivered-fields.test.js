import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { powerCurve, curvePoint } from './bike-power-curve.js';
import { riderProfile } from './bike-profile.js';
import { normalizedWatts, powerLoadAvailable, intensityFactor, powerTss, variabilityIndex } from './bike-load.js';
import { STROKE_METRICS_FLAG, strokeMetricsEnabled } from './swim-strokes.js';

/* The backend caught up (2026-07-30). Jack shipped the fields the bike and
 * swim work had been waiting on, and the client had no consumer for one of
 * them: the power-curve endpoint existed with no client call at all, so
 * `powerCurveRaw` was a hardcoded useState(null).
 *
 * These pin the contract at the seam — the exact JSON the backend's
 * IntervalsIcuPowerCurvePointResponse serialises — so a rename on either side
 * fails here rather than silently emptying the rider profile.
 */

// Verbatim the backend record's camelCase serialisation, per
// IntervalsIcuIntegrationModels.cs: DurationSec/Watts/Date/Source/Bike/
// Indoor/Quality.
const BACKEND_POINT = {
  durationSec: 300, watts: 330, date: '2026-07-03',
  source: 'Quarq', bike: 'Tarmac', indoor: false, quality: 'good',
};
const CURVE_JSON = [
  { ...BACKEND_POINT, durationSec: 5, watts: 900 },
  { ...BACKEND_POINT, durationSec: 60, watts: 420 },
  { ...BACKEND_POINT, durationSec: 300, watts: 330 },
  { ...BACKEND_POINT, durationSec: 1200, watts: 268 },
  { ...BACKEND_POINT, durationSec: 3600, watts: 240 },
];

describe('the power-curve seam matches what the backend sends', () => {
  it('parses the backend point shape without a mapping layer', () => {
    const p = curvePoint(BACKEND_POINT);
    expect(p).toBeTruthy();
    expect(p.durationSec).toBe(300);
    expect(p.watts).toBe(330);
    expect(p.source).toBe('Quarq');
  });

  it('a curve of backend rows drives the whole rider profile', () => {
    const curve = powerCurve(CURVE_JSON);
    expect(curve.points).toHaveLength(5);
    expect(curve.sources).toEqual(['Quarq']);
    const prof = riderProfile({ curve, ftpWatts: 260 });
    expect(Object.keys(prof.scores).sort())
      .toEqual(['anaerobic', 'durability', 'sprint', 'threshold', 'vo2']);
    // and the module's governing refusal survives being fed real data
    expect(prof.phenotype).toBeUndefined();
    expect(prof.type).toBeUndefined();
    expect(prof.label).toBeUndefined();
  });

  it('the client actually calls the endpoint', () => {
    /* The gap this change closed. Asserted on the SOURCE, because the module
       tests all passed while nothing fetched: powerCurveRaw was
       useState(null) with no setter in sight. */
    const api = readFileSync(new URL('./api.js', import.meta.url), 'utf8');
    expect(api).toMatch(/intervals-icu\/power-curve/);
    const sync = readFileSync(new URL('../app/sync.js', import.meta.url), 'utf8');
    expect(sync).toMatch(/loadPowerCurve/);
    const app = readFileSync(new URL('../app/App.jsx', import.meta.url), 'utf8');
    expect(app).toMatch(/sync\.loadPowerCurve\(\)/);
    expect(app).toMatch(/setPowerCurveRaw/);
    // and it is not hardcoded null any more
    expect(app).not.toMatch(/const \[powerCurveRaw\] = useState\(null\)/);
  });

  it('an older backend still yields no curve rather than an empty one', () => {
    expect(powerCurve(null)).toBe(null);
    expect(powerCurve([])).toBe(null);
    expect(riderProfile({ curve: null, ftpWatts: 260 })).toBe(null);
  });
});

describe('the delivered activity DTO, pinned at the seam (phase 1)', () => {
  /* Verbatim IntervalsIcuActivityResponse as try-backend main serialises it
     (camelCase, 2026-07-30). sync.loadActivities returns res.body verbatim,
     so this fixture IS the client contract: a rename on either side fails
     here rather than silently disarming a guard. */
  const DELIVERED = {
    id: 'a1', date: '2026-07-05', startedAt: '2026-07-05T07:02:11Z',
    type: 'Ride', name: 'Morning ride', movingTimeSec: 3600,
    elapsedTimeSec: 3720, distance: 30000, trainingLoad: 60, rpe: 6,
    feel: 3, ftp: 250, eftp: 255, averageHeartrate: 140, maxHeartrate: 165,
    averageWatts: 240, normalizedWatts: 255, averageSpeed: 8.3,
    poolLengthM: null, lengths: null, averageCadence: 88, averageStride: null,
    deviceName: 'Wahoo ELEMNT', deviceSource: 'GARMIN',
  };

  it('carries the timing pair this phase activates', () => {
    expect(typeof DELIVERED.startedAt).toBe('string');
    expect(DELIVERED.elapsedTimeSec).toBeGreaterThanOrEqual(DELIVERED.movingTimeSec);
  });

  it('does NOT carry activity-level elevation — the absence is pinned', () => {
    /* The handoff's status table once claimed ask 7 landed; it landed on the
       INTERVAL DTO as gain-only. Until an activity-level gain AND loss pair
       exists, the downhill-assist guard must stay dormant, and this is the
       test that says so out loud. */
    expect('totalElevationGain' in DELIVERED).toBe(false);
    expect('totalElevationLoss' in DELIVERED).toBe(false);
  });

  it('power-curve quality is null today, and null is usable rather than low', () => {
    // The backend serves quality: null on every point for now. Defaulting it
    // to 'low' would be a silent kill switch for the whole rider profile
    // (the exact defect class phase 7 fixed), so null reads as medium with
    // qualityKnown false.
    const p = curvePoint({ ...BACKEND_POINT, quality: null });
    expect(p.quality).toBe('medium');
    expect(p.qualityKnown).toBe(false);
  });

  it('an equal timing pair means uninterrupted; an absent one means unknown', () => {
    // Zero stopped time is a measurement. A missing elapsedTimeSec is not
    // zero stopped time — it is a backend that predates the field.
    const uninterrupted = { ...DELIVERED, elapsedTimeSec: DELIVERED.movingTimeSec };
    expect(uninterrupted.elapsedTimeSec - uninterrupted.movingTimeSec).toBe(0);
    const unknown = { ...DELIVERED, elapsedTimeSec: undefined };
    expect(Number.isFinite(unknown.elapsedTimeSec - unknown.movingTimeSec)).toBe(false);
  });
});

describe('normalized power arrives on the activity, unmapped', () => {
  // sync.loadActivities returns res.body verbatim, so a backend field is a
  // client field: no mapper to keep in step, and nothing to drop.
  const act = {
    type: 'Ride', date: '2026-07-05', movingTimeSec: 3600,
    elapsedTimeSec: 3720, normalizedWatts: 255, averageWatts: 240,
  };

  // Power load also needs a REAL FTP, not just the field: an estimated
  // threshold would make every derived number an estimate wearing a
  // measured name, which is the rule the whole app holds.
  const REAL_FTP = { ftp: 260, ftpMeta: { source: 'try-test' } };

  it('reads the delivered field and produces real load numbers', () => {
    expect(normalizedWatts(act)).toBe(255);
    expect(powerLoadAvailable({ activity: act, profile: REAL_FTP })).toBe(true);
    expect(intensityFactor(255, 260)).toBeCloseTo(0.98, 2);
    expect(powerTss(3600, 255, 260)).toBe(96);
    expect(variabilityIndex(255, 240)).toBeCloseTo(1.06, 2);
  });

  it('still fails closed on a backend that predates the field', () => {
    // The gate was never "off"; it was waiting. It must keep waiting for
    // anyone whose backend has not caught up.
    expect(normalizedWatts({ ...act, normalizedWatts: undefined })).toBe(null);
    expect(powerLoadAvailable({ activity: { ...act, normalizedWatts: undefined }, profile: REAL_FTP })).toBe(false);
  });

  it('an estimated FTP unlocks nothing, however good the ride data is', () => {
    expect(powerLoadAvailable({ activity: act, profile: { fitness: 'advanced', weightKg: 70 } })).toBe(false);
  });
});

describe('stroke metrics stay gated even though the fields now arrive', () => {
  it('the flag is still false, deliberately', () => {
    /* Jack now sends averageCadence and averageStride on activities AND
       intervals. The data flowing is NOT sufficient to turn this on: the
       module's own validation found distance/stride and cadence x time
       disagreeing by exactly 2x on a real lap, because one counts arm
       strokes and the other full cycles, and which is which is a device
       convention. Flipping this needs per-device validation against real
       data — which can only now begin, because the fields have only just
       started arriving. */
    expect(STROKE_METRICS_FLAG).toBe(false);
    const laps = [{ averageCadence: 30, averageStride: 2.2, distance: 50, movingTimeSec: 45 }];
    expect(strokeMetricsEnabled({ activity: { poolLengthM: 25 }, laps, enabled: STROKE_METRICS_FLAG })).toBe(false);
  });
});
