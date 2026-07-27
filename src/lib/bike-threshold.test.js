import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { intervalRows } from './review.js';
import { bikePowerAnchor, bikeThresholdHistory, hasRealFtp } from './domain.js';
import { tuneFields } from './tuning.js';
import { BIKE_ZONES, ZONE_VARIANTS, bandForType, zoneForType, wattsForZone } from './bike-zones.js';

const base = {
  name: 'B', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
};

describe('one zone table, and the disagreement it fixes (§4)', () => {
  it('the review judges a rep against the band the card prescribed', () => {
    // Before this, a Tempo card read 190-213 W (76-85% of a 250 W FTP) while
    // the review judged the same rep against 83-90%, so a rider at 195 W,
    // inside their own prescribed band, was told they came in under.
    let found = null;
    ['beginner', 'intermediate', 'advanced', 'elite'].forEach(fitness =>
      ['sprint', 'olympic', 'half', 't100', 'full'].forEach(raceType => {
        if (found) return;
        const p = generatePlan({ ...base, fitness, raceType });
        const t = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'bike' && w.type === 'Tempo');
        if (t) found = { p, t };
      }));
    expect(found, 'no Tempo ride generated anywhere').toBeTruthy();
    const { p, t } = found;
    const ftp = p.paces.ftp;
    const toneAt = frac => intervalRows({
      workout: t, paces: p.paces,
      intervals: [{ type: 'WORK', movingTimeSec: 720, averageWatts: Math.round(ftp * frac), distance: 8000 }],
    }).rows[0].tone;
    // anywhere inside the prescribed band reads as on target
    const [lo, hi] = bandForType('Tempo');
    expect(toneAt(lo + 0.01)).toBe('good');
    expect(toneAt((lo + hi) / 2)).toBe('good');
    expect(toneAt(hi - 0.01)).toBe('good');
    // and outside it still reads as off target in the right direction
    expect(toneAt(lo - 0.10)).toBe('info');
    expect(toneAt(hi + 0.10)).toBe('warn');
  });

  it('every judged bike type takes its band from the shared table', () => {
    ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'].forEach(type => {
      const band = bandForType(type);
      expect(band, type).toBeTruthy();
      expect(band[0]).toBeLessThan(band[1]);
      expect(zoneForType(type).label).toBeTruthy();
    });
  });

  it('the zones are ordered and do not leave a gap a rider can fall into', () => {
    const ids = BIKE_ZONES.map(z => z.id);
    expect(new Set(ids).size).toBe(ids.length);
    BIKE_ZONES.forEach(z => expect(z.min, z.id).toBeLessThan(z.max));
    // ascending by intensity
    const mins = BIKE_ZONES.map(z => z.min);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins);
  });

  it('converts a zone to watts only against a threshold that exists', () => {
    expect(wattsForZone(250, 'threshold')).toEqual({ min: 238, max: 263 });
    expect(wattsForZone(null, 'threshold')).toBe(null);
    expect(wattsForZone(250, 'nonsense')).toBe(null);
  });

  it('the bands generation uses that are not canonical are documented, not lost', () => {
    expect(ZONE_VARIANTS.length).toBeGreaterThan(0);
    ZONE_VARIANTS.forEach(v => {
      expect(v.lo).toBeLessThan(v.hi);
      expect(v.why.length, JSON.stringify(v)).toBeGreaterThan(10);
    });
  });
});

describe('FTP provenance at every write point (§1, §8)', () => {
  it('a manual entry, a model retarget and a feel tune each say what they are', () => {
    expect(bikePowerAnchor({ ftp: 250, ftpMeta: { source: 'manual' } }).source).toBe('manual');
    expect(bikePowerAnchor({ ftp: 250, ftpMeta: { source: 'activity-model' } }).source).toBe('activity-model');
    // an unknown source falls back rather than being echoed
    expect(bikePowerAnchor({ ftp: 250, ftpMeta: { source: 'invented' } }).source).toBe('manual');
  });

  it('a feel-based tune stops the threshold claiming it was tested', () => {
    // the fifth write point, and the one the swim module missed first time
    const fields = tuneFields({ fitness: 'intermediate', ftp: 250, fivekSec: 1200, css100Sec: 120 },
      [{ discipline: 'bike', direction: 'faster' }]);
    expect(fields.ftp).toBe(255);
    expect(fields.ftpMeta.source).toBe('activity-model');
    expect(fields.ftpMeta.confidence).toBe('low');
    // a run-only tune leaves bike provenance alone
    const runOnly = tuneFields({ fitness: 'intermediate', ftp: 250, fivekSec: 1200 },
      [{ discipline: 'run', direction: 'faster' }]);
    expect('ftpMeta' in runOnly).toBe(false);
  });

  it('an estimate never gains provenance, because it is never a threshold', () => {
    const est = bikePowerAnchor({ fitness: 'elite', weightKg: 75 });
    expect(est.kind).toBe('estimated');
    expect(est.source).toBeUndefined();
    expect(hasRealFtp({ fitness: 'elite', weightKg: 75 })).toBe(false);
  });
});

describe('threshold history (§3)', () => {
  it('reads the shared fitness history and ends on the current value', () => {
    const h = bikeThresholdHistory({
      ftp: 265, ftpMeta: { source: 'activity-model', measuredAt: '2026-07-05', confidence: 'medium' },
      fitnessHistory: [{ date: '2026-05-01', ftp: 240 }, { date: '2026-06-01', ftp: 250 }, { date: '2026-06-15', css100Sec: 120 }],
    });
    expect(h.map(x => x.ftpWatts)).toEqual([240, 250, 265]);
    expect(h[h.length - 1].current).toBe(true);
    expect(h[h.length - 1].source).toBe('activity-model');
  });

  it('an athlete on an estimate has no threshold history at all', () => {
    expect(bikeThresholdHistory({ fitness: 'elite', weightKg: 75 })).toEqual([]);
    expect(bikeThresholdHistory({})).toEqual([]);
    expect(bikeThresholdHistory(null)).toEqual([]);
  });
});
