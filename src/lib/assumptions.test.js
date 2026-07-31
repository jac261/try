import { describe, it, expect } from 'vitest';
import { anchorAssumptions, SOURCE_LABELS, EST_LEVEL_LABEL, EST_FELT_LABEL, EST_LEVEL_WEIGHT_LABEL } from './assumptions.js';
import { FITNESS, RUN_5K_SOURCES, FTP_SOURCES, CSS_SOURCES } from './domain.js';
import { generatePlan, buildTrackerPlan } from './plan.js';

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

  it('a blank profile WITH a weight gets an estimated FTP, labelled as a level-and-weight guess', () => {
    const bike = anchorAssumptions({ raceType: 'olympic', fitness: 'intermediate', weightKg: 70 })
      .find(r => r.discipline === 'bike');
    expect(bike.kind).toBe('estimated');
    expect(bike.ftpWatts).toBe(Math.round(FITNESS.intermediate.estWkg * 70));
    expect(bike.sourceLabel).toBe(EST_LEVEL_WEIGHT_LABEL);
  });

  it('an estimated swim with no stored CSS shows the level number that actually sizes sessions', () => {
    const swim = anchorAssumptions({ raceType: 'olympic', fitness: 'advanced' })
      .find(r => r.discipline === 'swim');
    expect(swim.kind).toBe('estimated');
    expect(swim.css100Sec).toBe(FITNESS.advanced.estCss);
    expect(swim.sourceLabel).toBe(EST_LEVEL_LABEL);
  });
});

describe('anchorAssumptions: estimated provenance is not one thing', () => {
  /* A feel-based tuning nudge WRITES a number with meta source 'estimated'.
     That number did not come from the level table, and labelling it so
     mislabelled a nudged (often previously measured) figure (gauntlet
     2026-07-31). Stored-estimate reads as felt; absent reads as level. */
  it('a feel-nudged 5k stays estimated and says it came from how training felt', () => {
    const run = anchorAssumptions({ ...base, fivekMeta: { source: 'estimated' } })
      .find(r => r.discipline === 'run');
    expect(run.kind).toBe('estimated');
    expect(run.timeSec).toBe(1500); // the number still sizes sessions
    expect(run.sourceLabel).toBe(EST_FELT_LABEL);
  });

  it('a level-table 5k (nothing stored) says it came from the level', () => {
    const run = anchorAssumptions({ raceType: 'olympic', fitness: 'beginner' })
      .find(r => r.discipline === 'run');
    expect(run.sourceLabel).toBe(EST_LEVEL_LABEL);
  });

  it('a feel-nudged CSS reads as felt, not as a level estimate', () => {
    const swim = anchorAssumptions({ ...base, cssMeta: { source: 'estimated' } })
      .find(r => r.discipline === 'swim');
    expect(swim.kind).toBe('estimated');
    expect(swim.css100Sec).toBe(110);
    expect(swim.sourceLabel).toBe(EST_FELT_LABEL);
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

  it('every measured closed-set source has a label: an unknown provenance never renders blank', () => {
    const covered = Object.keys(SOURCE_LABELS);
    [...RUN_5K_SOURCES, ...FTP_SOURCES, ...CSS_SOURCES].filter(s => s !== 'estimated')
      .forEach(s => expect(covered, 'no label for source ' + s).toContain(s));
  });
});

describe('anchorAssumptions: discipline filtering', () => {
  it('a solo run plan collapses to the run row only', () => {
    const rows = anchorAssumptions({ ...base, raceType: 'runhalf' });
    expect(rows.map(r => r.discipline)).toEqual(['run']);
  });

  it('an excluded (injured) discipline gets no row: the engine sizes nothing for it', () => {
    const rows = anchorAssumptions({ ...base, excludedDiscipline: 'swim' });
    expect(rows.map(r => r.discipline)).toEqual(['bike', 'run']);
  });

  it('tracker shows all three even when the retained raceType is solo: the numbers outlive the plan', () => {
    /* buildTrackerPlan preserves raceType (only the date is nulled), so a
       runner who taps "End plan and just track" carries raceType 'runhalf'
       into tracker mode. Without the tracker flag the card collapsed to one
       row while the statline above showed all three (gauntlet 2026-07-31).
       Exercise the REAL shape, not a raceType the transition never makes. */
    const t = buildTrackerPlan(generatePlan({
      ...base, trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
      startDate: '2026-06-01', raceDate: '2026-08-30', raceType: 'runhalf',
    }), '2026-07-13T10:00:00.000Z');
    expect(t.profile.raceType).toBe('runhalf'); // the premise this guards
    expect(anchorAssumptions(t.profile, { tracker: true }).map(r => r.discipline))
      .toEqual(['swim', 'bike', 'run']);
    // and tracker ignores a retained exclusion for the same reason
    expect(anchorAssumptions({ ...base, excludedDiscipline: 'swim' }, { tracker: true })
      .map(r => r.discipline)).toEqual(['swim', 'bike', 'run']);
  });
});
