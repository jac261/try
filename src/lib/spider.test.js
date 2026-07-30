import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SPIDER_SOURCES, LEVEL_ORDER, LEVEL_RINGS, levelPosition,
  SWIM_SPIDER_DISTANCES, criticalSpeed, swimSpider,
  RUN_SPIDER_AXES, runBestEfforts, runSpider,
  bikeSpider, BIKE_RING_RADII,
} from './spider.js';
import { FITNESS } from './domain.js';
import { tuneFields } from './tuning.js';

/* The performance spider (2026-07-30). The two rules that govern it:
 * no percentile claims until a real population exists (the rings are Try's
 * own named levels), and no polygon from an estimated anchor (phase 5's
 * rule on one more surface). */

const REAL_RUN = { fivekSec: 1500, fivekMeta: { source: 'try-test' }, raceType: 'runhalf' };
const REAL_SWIM = {
  css100Sec: 110,
  cssMeta: { source: 'try-test', t400Sec: 460, t200Sec: 218, d400: 400, d200: 200 },
};

describe('the reference is named, never a percentile', () => {
  it('no source or module text claims a percentile', () => {
    Object.values(SPIDER_SOURCES).forEach(src =>
      expect(/percentile|\d+(st|nd|rd|th)/i.test(src.label + src.blurb)).toBe(false));
    // the module itself may only use the word to say why it does NOT claim one
    const src = readFileSync(new URL('./spider.js', import.meta.url), 'utf8');
    const claims = src.split('\n').filter(l => /percentile/i.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    expect(claims).toEqual([]);
  });

  it('rings are the four named levels for swim and run', () => {
    expect(swimSpider(REAL_SWIM).rings.map(r => r.label)).toEqual(['Beginner', 'Intermediate', 'Advanced', 'Elite']);
    expect(runSpider(REAL_RUN, []).rings.map(r => r.label)).toEqual(['Beginner', 'Intermediate', 'Advanced', 'Elite']);
    expect(LEVEL_RINGS[0]).toBeGreaterThan(0); // the centre means off-ladder, not beginner
  });

  it('the population source exists as a seam and nothing constructs with it', () => {
    expect(SPIDER_SOURCES.population).toBeTruthy();
    expect(swimSpider(REAL_SWIM).source).toBe('try-levels');
    expect(runSpider(REAL_RUN, []).source).toBe('try-levels');
  });
});

describe('levelPosition', () => {
  const anchors = LEVEL_ORDER.map(l => FITNESS[l].estCss); // 140,120,105,90
  it('lands exactly on rings at the anchors and between them elsewhere', () => {
    expect(levelPosition(140, anchors, true)).toBeCloseTo(0.25, 5);
    expect(levelPosition(90, anchors, true)).toBeCloseTo(1.0, 5);
    const mid = levelPosition(112.5, anchors, true); // halfway int..adv
    expect(mid).toBeCloseTo(0.625, 5);
  });
  it('degrades toward the centre below beginner and caps past elite', () => {
    expect(levelPosition(200, anchors, true)).toBeGreaterThanOrEqual(0.08);
    expect(levelPosition(200, anchors, true)).toBeLessThan(0.25);
    expect(levelPosition(60, anchors, true)).toBeLessThanOrEqual(1.08);
    expect(levelPosition(null, anchors, true)).toBe(null);
  });
  it('handles higher-is-better axes without special-casing callers', () => {
    const wkg = LEVEL_ORDER.map(l => FITNESS[l].estWkg); // 2.0..4.0 ascending
    expect(levelPosition(2.0, wkg, false)).toBeCloseTo(0.25, 5);
    expect(levelPosition(4.0, wkg, false)).toBeCloseTo(1.0, 5);
  });
});

describe('an estimated anchor never draws a polygon', () => {
  it('run: level guess and feel-nudged estimate both refuse, with the reason', () => {
    expect(runSpider({ fitness: 'intermediate', raceType: 'runhalf' }, []).axes).toBe(null);
    const nudged = { fitness: 'intermediate', raceType: 'runhalf',
      ...tuneFields({ fitness: 'intermediate', raceType: 'runhalf' }, [{ discipline: 'run', direction: 'faster' }]) };
    const sp = runSpider(nudged, []);
    expect(sp.axes).toBe(null);
    expect(sp.reason).toMatch(/5 km test/);
  });
  it('swim: an estimated CSS refuses', () => {
    expect(swimSpider({ fitness: 'intermediate' }).axes).toBe(null);
    expect(swimSpider({ css100Sec: 118, cssMeta: { source: 'estimated' } }).axes).toBe(null);
  });
  it('bike: an estimated FTP refuses even with a curve', () => {
    const sp = bikeSpider({ fitness: 'advanced', weightKg: 70 }, { points: [] });
    expect(sp.axes).toBe(null);
    expect(sp.reason).toMatch(/real FTP/);
  });
});

describe('the swim projects only from swum evidence', () => {
  it('recovers CS and D-prime from the stored splits', () => {
    const m = criticalSpeed(REAL_SWIM.cssMeta);
    // CS = 200/242 m/s; D' = 400 − cs·460
    expect(m.cs).toBeCloseTo(200 / 242, 5);
    expect(m.dPrime).toBeCloseTo(400 - (200 / 242) * 460, 3);
    expect(m.dPrime).toBeGreaterThan(0);
  });
  it('uses recorded distances so a yard-pool test is not corrupted', () => {
    const yd = criticalSpeed({ t400Sec: 460, t200Sec: 218, d400: 366, d200: 183 });
    expect(yd.cs).toBeCloseTo(183 / 242, 5);
  });
  it('an implausible test falls back to flat CSS rather than projecting nonsense', () => {
    // t200 slower than t400 is not a test; D' of 200 m is not a swimmer
    expect(criticalSpeed({ t400Sec: 400, t200Sec: 420 })).toBe(null);
    expect(criticalSpeed({ t400Sec: 300, t200Sec: 50 })).toBe(null);
    const flat = swimSpider({ css100Sec: 110, cssMeta: { source: 'try-test' } });
    expect(flat.model).toBe('flat-css');
    expect(new Set(flat.axes.map(a => a.value)).size).toBe(1);   // honest flat
    flat.axes.forEach(a => expect(a.measured).toBe(false));      // and hollow
  });
  it('with the model, short distances are faster than long ones', () => {
    const sp = swimSpider(REAL_SWIM);
    expect(sp.model).toBe('cs-dprime');
    const v = sp.axes.map(a => a.value);
    expect(v[0]).toBeLessThan(v[v.length - 1]);
    expect(SWIM_SPIDER_DISTANCES[0]).toBe(100);
    sp.axes.forEach(a => expect(a.measured).toBe(true));
  });
});

describe('the run polygon is projection floor plus measured overrides', () => {
  it('with no recorded races every axis is a hollow projection', () => {
    const sp = runSpider(REAL_RUN, []);
    sp.axes.forEach(a => expect(a.measured).toBe(false));
    // and, projected through one exponent both sides, positions are equal —
    // which is exactly why measured overrides exist
    const pos = sp.axes.map(a => a.position);
    pos.forEach(p => expect(p).toBeCloseTo(pos[0], 5));
  });
  it('a recorded race overrides its axis as a measured point', () => {
    const acts = [{ type: 'Run', date: '2026-07-01', distance: 10120, movingTimeSec: 2900 }];
    const sp = runSpider(REAL_RUN, acts);
    const tenK = sp.axes.find(a => a.key === '10k');
    expect(tenK.measured).toBe(true);
    expect(tenK.value).toBeLessThan(3000);
    expect(sp.axes.find(a => a.key === '5k').measured).toBe(false);
  });
  it('best efforts ignore other disciplines, hopeless outliers and long days out', () => {
    const bests = runBestEfforts([
      { type: 'Ride', date: 'x', distance: 10000, movingTimeSec: 1200 },   // a ride
      { type: 'Run', date: 'x', distance: 12000, movingTimeSec: 3600 },    // 12 km is not a 10 km
      { type: 'Run', date: 'x', distance: 10050, movingTimeSec: 2800 },
      { type: 'Run', date: 'x', distance: 10050, movingTimeSec: 3000 },    // slower duplicate
    ]);
    expect(Object.keys(bests)).toEqual(['10k']);
    expect(bests['10k']).toBeLessThan(2810);
    // a jog far slower than the athlete's own projection is a day out with a
    // race number on it, not evidence against them
    const sp = runSpider(REAL_RUN, [{ type: 'Run', date: 'x', distance: 21200, movingTimeSec: 4 * 3600 }]);
    expect(sp.axes.find(a => a.key === 'half').measured).toBe(false);
  });
  it('solo run plans are placed against the runner ladder, triathlon against est5k', () => {
    const solo = runSpider(REAL_RUN, []);
    const tri = runSpider({ ...REAL_RUN, raceType: 'olympic' }, []);
    // same athlete, different reference ladder, so different ring positions
    expect(solo.axes[0].position).not.toBeCloseTo(tri.axes[0].position, 5);
  });
});

describe('the bike spider is dormant, honestly', () => {
  it('a real FTP with no curve explains what is missing', () => {
    const sp = bikeSpider({ ftp: 250, weightKg: 70 }, null);
    expect(sp.axes).toBe(null);
    expect(sp.reason).toMatch(/power curve/);
    expect(sp.reason).toMatch(/backend/);
  });
  it('its rings are shape bands, never the level ladder', () => {
    // the profile's scores are deviations from the rider's own mean; level
    // rings would claim the cross-athlete comparison it refuses to make
    expect(BIKE_RING_RADII.even).toBeGreaterThan(BIKE_RING_RADII.limiter);
    expect(BIKE_RING_RADII.strength).toBeGreaterThan(BIKE_RING_RADII.even);
    expect(SPIDER_SOURCES['own-shape'].label).toMatch(/your own/);
  });
});

describe('the splits that feed the swim model are persisted and die honestly', () => {
  it('the test retarget carries them and every other CSS write drops them', () => {
    const src = readFileSync(new URL('./eftp.js', import.meta.url), 'utf8');
    expect(src).toMatch(/t400Sec: cssTest\.test\.t400Sec/);
    // the manual and intervals.icu writes replace cssMeta wholesale with no
    // splits, which is what keeps the model from outliving its evidence
    expect(src).toMatch(/cssMeta: \{ source: 'intervals-icu', measuredAt: todayISO, confidence: 'medium' \}/);
    const nudge = tuneFields({ css100Sec: 110, cssMeta: REAL_SWIM.cssMeta }, [{ discipline: 'swim', direction: 'faster' }]);
    expect(nudge.cssMeta.t400Sec).toBeUndefined();
    expect(criticalSpeed(nudge.cssMeta)).toBe(null);
  });
});

describe('the dashboards actually mount it', () => {
  it('all three dashboards render a SpiderChart from the engine', async () => {
    const { readFileSync: rf } = await import('node:fs');
    const swim = rf(new URL('../features/progress/SwimDashboard.jsx', import.meta.url), 'utf8');
    const run = rf(new URL('../features/progress/RunDashboard.jsx', import.meta.url), 'utf8');
    const bike = rf(new URL('../features/progress/BikeDashboard.jsx', import.meta.url), 'utf8');
    expect(swim).toMatch(/swimSpider\(plan\.profile\)/);
    expect(run).toMatch(/runSpider\(profile, activities\)/);
    expect(bike).toMatch(/bikeSpider\(plan\.profile, powerCurve\)/);
    // and the curve prop really arrives from ProgressView
    const pv = rf(new URL('../features/progress/ProgressView.jsx', import.meta.url), 'utf8');
    expect(pv).toMatch(/powerCurve=\{powerCurve\}/);
  });
});
