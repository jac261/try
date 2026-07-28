import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { BIKE_TYPES, isTrainingRide } from './bikeschema.js';
import {
  bikeExecution, bikeTargetMode, bikeEnvironmentNote, TYPE_SUITS, ENVIRONMENTS,
} from './bike-execution.js';

const base = {
  name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-11-01',
};

describe('§5: every workout has explicit execution variants', () => {
  it('covers the whole bike ladder, with a declared suitability', () => {
    BIKE_TYPES.forEach(t => {
      expect(TYPE_SUITS[t], t + ' has no declared environment').toBeTruthy();
      expect(['indoor', 'outdoor', 'either']).toContain(TYPE_SUITS[t]);
    });
  });

  it('every generated ride supports BOTH environments, whichever it suits', () => {
    const p = generatePlan(base);
    const seen = new Set();
    p.weeks.flatMap(w => w.workouts).filter(isTrainingRide).forEach(w => {
      const ex = bikeExecution(w, p.profile);
      expect(ex, w.type).toBeTruthy();
      expect(ex.variants.map(v => v.environment).sort()).toEqual([...ENVIRONMENTS].sort());
      ex.variants.forEach(v => {
        expect(v.instructions.length, w.type + ' ' + v.environment).toBeGreaterThan(0);
        v.instructions.forEach(line => expect(line.length).toBeGreaterThan(20));
      });
      seen.add(w.type);
    });
    expect(seen.size).toBeGreaterThan(2);
  });

  it('says nothing about disciplines it does not model', () => {
    const p = generatePlan(base);
    const swim = p.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'swim');
    expect(bikeExecution(swim, p.profile)).toBe(null);
    expect(bikeExecution(null, p.profile)).toBe(null);
  });

  it('only flags an environment when it actually matters', () => {
    expect(bikeEnvironmentNote({ discipline: 'bike', type: 'Long' })).toMatch(/outdoors/);
    expect(bikeEnvironmentNote({ discipline: 'bike', type: 'VO2 Intervals' })).toMatch(/indoors/);
    // "either is fine" is not worth the pixels
    expect(bikeEnvironmentNote({ discipline: 'bike', type: 'Endurance' })).toBe(null);
    expect(bikeEnvironmentNote({ discipline: 'run', type: 'Long' })).toBe(null);
  });

  it('does not change the session, only how it is described', () => {
    const p = generatePlan(base);
    const w = p.weeks.flatMap(x => x.workouts).find(isTrainingRide);
    const before = JSON.stringify(w);
    bikeExecution(w, p.profile);
    expect(JSON.stringify(w)).toBe(before);
  });
});

describe('§5: the target mode follows the power anchor, not the wish', () => {
  it('asks for power only when the threshold was actually measured', () => {
    expect(bikeTargetMode({ ftp: 250 })).toBe('power');
    // no FTP: the anchor is derived from the athlete's LEVEL, so watts would
    // be presenting a guess about their category as a number about them
    expect(bikeTargetMode({ fitness: 'intermediate', weightKg: 75 })).toBe('rpe');
    expect(bikeTargetMode({})).toBe('rpe');
    expect(bikeTargetMode(null)).toBe('rpe');
  });

  it('never emits heart-rate, because no measured HR threshold exists to judge against', () => {
    // The union in the spec allows it; Try stores no threshold heart rate, so
    // emitting it would grade an athlete against a number nobody established.
    // If a threshold HR is ever stored, this test is the thing that should
    // fail and be updated deliberately.
    const profiles = [{ ftp: 250 }, { fitness: 'elite', weightKg: 70 }, {}, { averageHeartrate: 150 }];
    profiles.forEach(pr => {
      const ex = bikeExecution({ discipline: 'bike', type: 'Threshold' }, pr);
      ex.variants.forEach(v => expect(v.targetMode).not.toBe('heart-rate'));
    });
  });
});

describe('§5: the instructions are athlete-facing copy', () => {
  it('leaks no engine parameters', () => {
    // the engine is proprietary: no percentages of threshold, no zone codes,
    // no scaling factors in anything the athlete reads
    const p = generatePlan(base);
    p.weeks.flatMap(w => w.workouts).filter(isTrainingRide).forEach(w => {
      bikeExecution(w, p.profile).variants.forEach(v =>
        v.instructions.forEach(line => {
          expect(line, w.type).not.toMatch(/\d+\s*%/);
          expect(line, w.type).not.toMatch(/\bZ[1-5]\b/);
          expect(line, w.type).not.toMatch(/\bFTP\b/i);
        }));
    });
  });

  it('tells an indoor rider what the plan does with their virtual distance', () => {
    const ex = bikeExecution({ discipline: 'bike', type: 'Endurance' }, { ftp: 250 });
    const indoor = ex.variants.find(v => v.environment === 'indoor').instructions.join(' ');
    expect(indoor).toMatch(/distance/i);        // §4, said to the athlete rather than only enforced
  });

  it('warns an outdoor rider that the road pulls an average down', () => {
    const ex = bikeExecution({ discipline: 'bike', type: 'Threshold' }, { ftp: 250 });
    const outdoor = ex.variants.find(v => v.environment === 'outdoor').instructions.join(' ');
    expect(outdoor).toMatch(/junction|descent|coast/i);   // §7's reasoning, in the athlete's words
  });
});
