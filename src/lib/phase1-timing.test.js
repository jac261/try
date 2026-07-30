import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { transitionSecFor, brickExecution, TRANSITION_RULES } from './brick.js';
import { brickPairFor } from './autolog.js';
import { run5kInterrupted, run5kDownhillAssisted, fivekTestIssues, RUN_5K_RULES } from './run-benchmark.js';
import { rideInterruption, bikeReview, INTERRUPTION_RULES } from './bike-review.js';

/* Phase 1: startedAt and elapsedTimeSec activated. Every consumer here has a
 * missing-field case asserting SILENCE, because the delivered contract's rule
 * is that absence means a backend that predates the field — never zero
 * stopped time, never an unordered pair, never an uninterrupted ride. */

const RIDE_START = '2026-07-05T07:00:00Z';

describe('brick transition (§3.3)', () => {
  const ride = { startedAt: RIDE_START, elapsedTimeSec: 3700, movingTimeSec: 3600 };
  const runAt = gapSec => ({ startedAt: new Date(Date.parse(RIDE_START) + (3700 + gapSec) * 1000).toISOString() });

  it('derives the gap from ride END (start + elapsed), not moving time', () => {
    // 100 sec of the ride was stopped time; a moving-time derivation would
    // report the transition 100 sec too long
    expect(transitionSecFor(ride, runAt(180))).toBe(180);
  });

  it('unknown on any missing piece: starts, or the ride elapsed', () => {
    expect(transitionSecFor({ ...ride, startedAt: undefined }, runAt(180))).toBe(null);
    expect(transitionSecFor(ride, { startedAt: undefined })).toBe(null);
    expect(transitionSecFor({ ...ride, elapsedTimeSec: undefined }, runAt(180))).toBe(null);
    expect(transitionSecFor(ride, { startedAt: 'not a date' })).toBe(null);
  });

  it('refuses implausible gaps rather than reporting them', () => {
    expect(transitionSecFor(ride, runAt(-400))).toBe(null);                        // run began before the ride ended
    expect(transitionSecFor(ride, runAt(TRANSITION_RULES.maxSec + 60))).toBe(null); // separate sessions, not a brick
  });

  it('brickExecution carries it, and stays null for timestampless recordings', () => {
    const paces = { run: { easy: 360, long: 380 } };
    const run = { ...runAt(240), movingTimeSec: 1500, distance: 5000 };
    const withTs = brickExecution({ ride: { ...ride, averageWatts: 180 }, run, paces });
    expect(withTs.transitionSec).toBe(240);
    const without = brickExecution({
      ride: { averageWatts: 180 },
      run: { movingTimeSec: 1500, distance: 5000 }, paces,
    });
    expect(without.transitionSec).toBe(null);
  });
});

describe('brick pairing order (autolog)', () => {
  const workout = { id: '3-5', discipline: 'brick', durationMin: 75, date: '2026-07-05' };
  const base = { date: '2026-07-05', movingTimeSec: 2250 };
  const dev = { deviceName: 'Garmin Forerunner' };
  const pair = (rideExtra, runExtra) => brickPairFor({
    workout,
    activities: [
      { id: 'r1', type: 'Ride', ...base, ...rideExtra },
      { id: 'x1', type: 'Run', ...base, ...runExtra },
    ],
    moves: null, used: null,
  });

  it('rejects a run recorded BEFORE the ride: that is not a brick', () => {
    expect(pair({ startedAt: '2026-07-05T18:00:00Z', ...dev }, { startedAt: '2026-07-05T07:00:00Z', ...dev })).toBe(null);
  });

  it('accepts ride-then-run, and keeps date-only pairing when timestamps are absent', () => {
    expect(pair({ startedAt: '2026-07-05T07:00:00Z', ...dev }, { startedAt: '2026-07-05T08:10:00Z', ...dev })).toBeTruthy();
    expect(pair({}, {})).toBeTruthy();                       // the pre-field behaviour, byte-identical
    expect(pair({ startedAt: '2026-07-05T07:00:00Z', ...dev }, {})).toBeTruthy(); // one timestamp proves nothing
  });

  it('a hand-logged half never un-matches a brick: ordering needs devices on BOTH sides', () => {
    /* Gauntlet catch: an intervals.icu manual entry carries a defaulted
       start time (commonly the start of the day). An evening brick whose
       run half was hand-logged would parse run-before-ride and silently
       lose its match. deviceName marks a real recording; a timestamp
       without one is not evidence of order. */
    expect(pair(
      { startedAt: '2026-07-05T18:00:00Z', ...dev },
      { startedAt: '2026-07-05T00:00:00Z' },              // manual: no device
    )).toBeTruthy();
  });
});

describe('interrupted 5 km test (§3.2)', () => {
  const clean = { movingTimeSec: 2700, elapsedTimeSec: 2860 };

  it('flags only heavy interruption, on either bound', () => {
    expect(run5kInterrupted(clean)).toBe(false);             // 160 sec of faff is a test day
    expect(run5kInterrupted({ movingTimeSec: 2700, elapsedTimeSec: 2700 + RUN_5K_RULES.maxStoppedSec + 60 })).toBe(true);
    expect(run5kInterrupted({ movingTimeSec: 900, elapsedTimeSec: 1300 })).toBe(true); // >25% stationary
  });

  it('a missing elapsed time is NOT an interruption', () => {
    expect(run5kInterrupted({ movingTimeSec: 2700 })).toBe(false);
    expect(run5kInterrupted(null)).toBe(false);
  });

  it('fivekTestIssues explains it, ahead of lap parsing', () => {
    const interrupted = { movingTimeSec: 2700, elapsedTimeSec: 3600 };
    const msg = fivekTestIssues(null, interrupted);
    expect(msg).toMatch(/long stops/);
    // and the copy carries no engine thresholds ("5 km" is a distance, not
    // a parameter): neither bound may leak
    expect(msg).not.toMatch(/600|25\s*%|0\.25|minutes?\b.*\d/);
  });

  it('the App call site gates the PARSE on the same guard the ISSUES explain', () => {
    /* fivekFromTestIntervals is deliberately pure on laps (interruption is an
       activity property), so the pair-agreement invariant lives at the one
       call site — the shipped isIndoor pattern. Asserted at the source
       because a value test cannot see which guard produced a null. */
    const app = readFileSync('src/app/App.jsx', 'utf8');
    expect(app).toMatch(/T\.isIndoor\(a\) \|\| T\.run5kInterrupted\(a\) \|\| T\.run5kDownhillAssisted\(a\) \? null : T\.fivekFromTestIntervals\(rows\)/);
  });
});

describe('ride interruption (bike review §4, explanation only)', () => {
  const workout = {
    id: '0-0', discipline: 'bike', type: 'Endurance', durationMin: 60,
    date: '2026-07-06', segments: [{ label: 'Main', min: 60, zone: 'Z2' }],
  };
  const act = extra => ({
    id: 'b1', type: 'Ride', date: '2026-07-06', movingTimeSec: 3600,
    distance: 30000, averageWatts: 150, ...extra,
  });

  it('measures stopped time; absent elapsed is unknown, not zero', () => {
    expect(rideInterruption(act({ elapsedTimeSec: 3900 }))).toEqual({ stoppedSec: 300, stoppedFrac: 0.077 });
    expect(rideInterruption(act({ elapsedTimeSec: 3600 }))).toEqual({ stoppedSec: 0, stoppedFrac: 0 });
    expect(rideInterruption(act({}))).toBe(null);
    expect(rideInterruption(act({ elapsedTimeSec: 3000 }))).toBe(null); // elapsed < moving: glitch, not data
  });

  it('the review stores it and speaks it only when it explains a lenient read', () => {
    const paces = { ftp: 250 };
    const interrupted = bikeReview({ workout, activity: act({ elapsedTimeSec: 3900 }), intervals: null, paces, feel: 'right' });
    expect(interrupted.stoppedSec).toBe(300);
    const unknown = bikeReview({ workout, activity: act({}), intervals: null, paces, feel: 'right' });
    expect(unknown.stoppedSec).toBe(null);
  });

  it('speaking is gated: junction-level stops never reach the copy', () => {
    // The sentence exists to explain the outdoor allowance on a shortfall,
    // and every outdoor ride has junctions — two minutes of lights must not
    // become a line on every review.
    expect(INTERRUPTION_RULES.minSpokenSec).toBeGreaterThanOrEqual(120);
    const src = readFileSync('src/lib/bike-review.js', 'utf8');
    expect(src).toMatch(/stoppedSec >= INTERRUPTION_RULES\.minSpokenSec/);
  });
});

describe('downhill-assisted 5 km guard (dormant until elevation LOSS ships)', () => {
  it('fires only on a present PAIR showing a material net drop', () => {
    expect(run5kDownhillAssisted({ totalElevationGain: 5, totalElevationLoss: 40 })).toBe(true);
    expect(run5kDownhillAssisted({ totalElevationGain: 30, totalElevationLoss: 38 })).toBe(false); // rolling, not a descent
    expect(run5kDownhillAssisted({ totalElevationGain: 60, totalElevationLoss: 60 })).toBe(false); // hilly loop, fair
  });

  it('absence of either field is absence of a claim', () => {
    // The delivered DTO carries neither field today (pinned in
    // delivered-fields.test.js), and gain alone cannot tell a descent from
    // rolling terrain. Missing elevation is not a flat course, and it is
    // not a downhill one either.
    expect(run5kDownhillAssisted({ totalElevationGain: 5 })).toBe(false);
    expect(run5kDownhillAssisted({ totalElevationLoss: 400 })).toBe(false);
    expect(run5kDownhillAssisted({})).toBe(false);
    expect(run5kDownhillAssisted(null)).toBe(false);
  });

  it('fivekTestIssues explains it without numbers', () => {
    const msg = fivekTestIssues(null, { totalElevationGain: 0, totalElevationLoss: 60 });
    expect(msg).toMatch(/gravity/);
    expect(msg).not.toMatch(/\d/);
  });

  it('the App call site carries the same gate', () => {
    const app = readFileSync('src/app/App.jsx', 'utf8');
    expect(app).toMatch(/T\.run5kDownhillAssisted\(a\)/);
  });
});
