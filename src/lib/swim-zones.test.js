import { describe, it, expect } from 'vitest';
import { SWIM_ZONES, zoneTarget, targetPaceForZone, swimZoneTargets } from './swim-zones.js';
import { swimThreshold, CSS_SOURCES } from './domain.js';

/* Phase 3: swim CSS zones as the single source of pace offsets, and the
   canonical threshold model alongside css100Sec. Offsets signed off by Jon. */

describe('the swim zone table (signed off 2026-07-23)', () => {
  it('holds the six zones at their agreed offsets from CSS', () => {
    const t = Object.fromEntries(SWIM_ZONES.map(z => [z.id, z.target]));
    expect(t).toEqual({ recovery: 20, technique: 12, aerobic: 6, tempo: 3, css: 0, above: -6 });
  });
  it('each zone target sits inside its own range, and ranges run fast to slow', () => {
    SWIM_ZONES.forEach(z => {
      expect(z.min).toBeLessThanOrEqual(z.target);
      expect(z.target).toBeLessThanOrEqual(z.max);
    });
    // zones descend in pace order recovery(slowest) -> above(fastest), no target overlap
    const targets = SWIM_ZONES.map(z => z.target);
    expect(targets).toEqual([...targets].sort((a, b) => b - a));
  });
});

describe('targetPaceForZone / zoneTarget', () => {
  it('returns a fast..slow range around CSS in sec/100 m', () => {
    expect(targetPaceForZone(120, 'aerobic')).toEqual({ minSecondsPer100m: 123, maxSecondsPer100m: 129 });
    expect(targetPaceForZone(120, 'css')).toEqual({ minSecondsPer100m: 118, maxSecondsPer100m: 122 });
    expect(targetPaceForZone(120, 'above')).toEqual({ minSecondsPer100m: 110, maxSecondsPer100m: 118 });
  });
  it('zoneTarget is the single target; recovery is +20, unknown falls back to CSS', () => {
    expect(zoneTarget(120, 'recovery')).toBe(140);
    expect(zoneTarget(120, 'css')).toBe(120);
    expect(zoneTarget(120, 'nonsense')).toBe(120);
  });
  it('swimZoneTargets carries every zone keyed by id', () => {
    expect(swimZoneTargets(120)).toEqual({ recovery: 140, technique: 132, aerobic: 126, tempo: 123, css: 120, above: 114 });
  });
});

describe('the canonical swim threshold model', () => {
  it('keeps css100Sec as the number and records provenance without replacing it', () => {
    const measured = swimThreshold({ css100Sec: 118, cssMeta: { source: 'try-test', measuredAt: '2026-07-01', confidence: 'high' } });
    expect(measured).toEqual({ cssSecondsPer100m: 118, source: 'try-test', measuredAt: '2026-07-01', confidence: 'high' });
  });
  it('an existing athlete with a css but no meta reads as a manual source', () => {
    expect(swimThreshold({ css100Sec: 120 })).toEqual({ cssSecondsPer100m: 120, source: 'manual', measuredAt: null, confidence: null });
  });
  it('no css reads as estimated; a bad source falls back', () => {
    expect(swimThreshold({}).source).toBe('estimated');
    expect(swimThreshold({ css100Sec: 120, cssMeta: { source: 'garbage' } }).source).toBe('manual');
    expect(CSS_SOURCES).toContain('try-test');
  });
});
