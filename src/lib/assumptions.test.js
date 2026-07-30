import { describe, it, expect } from 'vitest';
import { anchorAssumptions, SOURCE_LABELS } from './assumptions.js';
import { FITNESS, RUN_5K_SOURCES, FTP_SOURCES, CSS_SOURCES } from './domain.js';

/* The Assumption Center selector: it narrates the domain anchors and must
   never disagree with them. Real stays real, a guess stays a guess, an
   absent bike anchor is 'none' and never a number. */

const base = {
  name: 'P', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
};

describe('anchorAssumptions: kinds', () => {
  it('an all-real triathlete profile yields three real rows in swim/bike/run order', () => {
    const rows = anchorAssumptions(base);
    expect(rows.map(r => r.discipline)).toEqual(['swim', 'bike', 'run']);
    expect(rows.every(r => r.kind === 'real')).toBe(true);
    expect(rows.find(r => r.discipline === 'run').timeSec).toBe(1500);
    expect(rows.find(r => r.discipline === 'bike').ftpWatts).toBe(250);
    expect(rows.find(r => r.discipline === 'swim').css100Sec).toBe(110);
  });

  it('a blank profile is estimated everywhere except the bike, which is none without a weight', () => {
    const rows = anchorAssumptions({ raceType: 'olympic', fitness: 'beginner' });
    expect(rows.find(r => r.discipline === 'run').kind).toBe('estimated');
    expect(rows.find(r => r.discipline === 'swim').kind).toBe('estimated');
    const bike = rows.find(r => r.discipline === 'bike');
    expect(bike.kind).toBe('none');
    // fail closed: no watts figure at all, not a zero
    expect(bike.ftpWatts).toBe(null);
    expect(bike.sourceLabel).toBe(null);
  });

  it('a blank profile WITH a weight gets an estimated FTP, still labelled a guess', () => {
    const bike = anchorAssumptions({ raceType: 'olympic', fitness: 'intermediate', weightKg: 70 })
      .find(r => r.discipline === 'bike');
    expect(bike.kind).toBe('estimated');
    expect(bike.ftpWatts).toBe(Math.round(FITNESS.intermediate.estWkg * 70));
    expect(bike.sourceLabel).toBe('Estimated from your level');
  });

  it('a feel-nudged 5k (fivekMeta.source estimated) stays estimated: a nudge is not a performance', () => {
    const run = anchorAssumptions({ ...base, fivekMeta: { source: 'estimated' } })
      .find(r => r.discipline === 'run');
    expect(run.kind).toBe('estimated');
    expect(run.timeSec).toBe(1500); // the number still sizes sessions
    expect(run.sourceLabel).toBe('Estimated from your level');
  });

  it('an estimated swim with no stored CSS shows the level number that actually sizes sessions', () => {
    const swim = anchorAssumptions({ raceType: 'olympic', fitness: 'advanced' })
      .find(r => r.discipline === 'swim');
    expect(swim.kind).toBe('estimated');
    expect(swim.css100Sec).toBe(FITNESS.advanced.estCss);
  });
});

describe('anchorAssumptions: provenance', () => {
  it('carries source, label and date for a measured anchor', () => {
    const rows = anchorAssumptions({
      ...base,
      fivekMeta: { source: 'recorded-race', measuredAt: '2026-07-01' },
      ftpMeta: { source: 'try-test', measuredAt: '2026-06-20' },
      cssMeta: { source: 'intervals-icu', measuredAt: '2026-06-10' },
    });
    expect(rows.find(r => r.discipline === 'run')).toMatchObject({
      source: 'recorded-race', sourceLabel: 'From a recorded race', measuredAt: '2026-07-01',
    });
    expect(rows.find(r => r.discipline === 'bike')).toMatchObject({
      source: 'try-test', sourceLabel: 'Measured in a Try test', measuredAt: '2026-06-20',
    });
    expect(rows.find(r => r.discipline === 'swim')).toMatchObject({
      source: 'intervals-icu', sourceLabel: 'From intervals.icu', measuredAt: '2026-06-10',
    });
  });

  it('every closed-set source has a label: an unknown provenance never renders blank', () => {
    const covered = Object.keys(SOURCE_LABELS);
    [...RUN_5K_SOURCES, ...FTP_SOURCES, ...CSS_SOURCES, 'runner-level', 'triathlete-level']
      .forEach(s => expect(covered, 'no label for source ' + s).toContain(s));
  });
});

describe('anchorAssumptions: discipline filtering', () => {
  it('a solo run plan collapses to the run row only', () => {
    const rows = anchorAssumptions({ ...base, raceType: 'runhalf' });
    expect(rows.map(r => r.discipline)).toEqual(['run']);
  });

  it('tracker profiles (no raceType match) keep all three: the numbers outlive the plan', () => {
    const rows = anchorAssumptions({ ...base, raceType: undefined });
    expect(rows.map(r => r.discipline)).toEqual(['swim', 'bike', 'run']);
  });
});
