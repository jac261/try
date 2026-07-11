import { describe, it, expect } from 'vitest';
import { reviewActivity } from './review.js';

const paces = { run: { easy: 360, long: 340, tempo: 300, threshold: 285, interval: 265 },
  swim: { easy: 132, steady: 126, css: 120, fast: 114 }, ftp: 222 };
const act = (over = {}) => ({ id: 'i1', date: '2026-07-11', movingTimeSec: 3000, distance: 8000, trainingLoad: 45, rpe: 3, ...over });

describe('reviewActivity (post-session analysis)', () => {
  it('an easy run kept easy earns the good verdict; pushed too fast earns the warning', () => {
    const w = { discipline: 'run', type: 'Easy', durationMin: 50 };
    // 3000s / 8km = 375 s/km vs easy 360 → in band
    const good = reviewActivity({ workout: w, activity: act(), paces });
    expect(good.verdicts.some(v => v.tone === 'good' && /in the band/i.test(v.text))).toBe(true);
    // 3000s / 10km = 300 s/km, 60s quicker than easy → warned
    const fast = reviewActivity({ workout: w, activity: act({ distance: 10000 }), paces });
    expect(fast.verdicts.some(v => v.tone === 'warn' && /easy/i.test(v.text))).toBe(true);
  });

  it('interval sessions never get a pace verdict, only the rep-by-rep pointer', () => {
    const w = { discipline: 'run', type: 'Threshold', durationMin: 55 };
    const rv = reviewActivity({ workout: w, activity: act({ distance: 11000 }), paces });
    expect(rv.verdicts.some(v => /rep by rep/i.test(v.text))).toBe(true);
    expect(rv.verdicts.some(v => /in the band|quicker than/i.test(v.text))).toBe(false);
  });

  it('an easy ride with power is judged by intensity; without power it stays quiet', () => {
    const w = { discipline: 'bike', type: 'Endurance', durationMin: 60 };
    const hot = reviewActivity({ workout: w, activity: act({ avgWatts: 190, distance: 30000, movingTimeSec: 3600 }), paces });
    expect(hot.verdicts.some(v => v.tone === 'warn' && /FTP/.test(v.text))).toBe(true);
    const calm = reviewActivity({ workout: w, activity: act({ avgWatts: 150, distance: 30000, movingTimeSec: 3600 }), paces });
    expect(calm.verdicts.some(v => v.tone === 'good' && /easy/i.test(v.text))).toBe(true);
    const noPower = reviewActivity({ workout: w, activity: act({ distance: 30000, movingTimeSec: 3600 }), paces });
    expect(noPower.verdicts.some(v => /FTP/.test(v.text))).toBe(false); // no data, no guess
  });

  it('duration and effort mismatches surface honestly', () => {
    const w = { discipline: 'run', type: 'Easy', durationMin: 60 };
    const short = reviewActivity({ workout: w, activity: act({ movingTimeSec: 1800, distance: 4800 }), paces });
    expect(short.verdicts.some(v => /cut short/i.test(v.text))).toBe(true);
    const hardEasy = reviewActivity({ workout: w, activity: act({ rpe: 8 }), paces });
    expect(hardEasy.verdicts.some(v => /felt hard/i.test(v.text))).toBe(true);
  });

  it('stats render from available fields only, and no activity means no review', () => {
    const w = { discipline: 'run', type: 'Easy', durationMin: 50 };
    const rv = reviewActivity({ workout: w, activity: act(), paces });
    expect(rv.stats.map(s => s[0])).toEqual(['Time', 'Distance', 'Avg pace', 'Load', 'RPE']);
    expect(reviewActivity({ workout: w, activity: null, paces })).toBe(null);
    expect(reviewActivity({ workout: w, activity: { id: 'x', date: 'd' }, paces })).toBe(null); // no moving time
  });
});

import { intervalRows } from './review.js';

describe('intervalRows (the rep table)', () => {
  const iv = (over = {}) => ({ type: 'WORK', movingTimeSec: 540, distance: 2000, avgSpeed: 3.51, avgHr: 165, avgWatts: 320, ...over });

  it('judges run reps by pace, never by average_watts (running power)', () => {
    const w = { discipline: 'run', type: 'Threshold' };
    // avgSpeed 3.51 m/s = 285 s/km = exactly the threshold target
    const it = intervalRows({ workout: w, intervals: [iv(), iv({ avgSpeed: 3.1 })], paces });
    expect(it.rows[0].tone).toBe('good');
    expect(it.rows[0].watts).toBe(null);       // watts suppressed for runs
    expect(it.rows[1].tone).toBe('info');      // 322 s/km, slower than band
    expect(it.summary).toBe('1 of 2 reps on target');
  });

  it('judges bike reps by watts against the FTP band', () => {
    const w = { discipline: 'bike', type: 'Sweet Spot' };
    const it = intervalRows({ workout: w, intervals: [
      iv({ avgWatts: 192, avgSpeed: null }),   // 86% FTP → in band
      iv({ avgWatts: 230, avgSpeed: null }),   // 104% → hot
    ], paces });
    expect(it.rows.map(r => r.tone)).toEqual(['good', 'warn']);
  });

  it('unstructured laps render as plain splits: no target, no verdicts', () => {
    const w = { discipline: 'run', type: 'Easy' };
    const it = intervalRows({ workout: w, intervals: [iv(), iv(), iv()], paces });
    expect(it.judged).toBe(0);
    expect(it.rows.every(r => !r.tone)).toBe(true);
    expect(it.summary).toBe('3 splits');
  });

  it('drops sub-30-second lap-button stubs and returns null with nothing to show', () => {
    const w = { discipline: 'run', type: 'Threshold' };
    const it = intervalRows({ workout: w, intervals: [iv(), iv({ movingTimeSec: 7 })], paces });
    expect(it.rows.length).toBe(1);
    expect(intervalRows({ workout: w, intervals: [iv({ movingTimeSec: 7 })], paces })).toBe(null);
    expect(intervalRows({ workout: w, intervals: null, paces })).toBe(null);
  });
});
