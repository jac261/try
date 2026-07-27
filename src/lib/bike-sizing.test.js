import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import {
  BIKE_SIZING, bikeSizing, LEVEL_GATES, levelGate,
  PROGRESSION_STEPS, bikeMainSet,
} from './bike-sizing.js';
import { BIKE_TYPES, isTrainingRide, bikeWorkoutIssues } from './bikeschema.js';

const base = {
  name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-11-01',
};
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];

describe('§2: every session type has sizing and a degradation rule', () => {
  it('covers the whole ladder, with coherent numbers', () => {
    BIKE_TYPES.forEach(t => {
      const z = bikeSizing(t);
      expect(z, t).toBeTruthy();
      expect(z.minimum).toBeGreaterThan(0);
      expect(z.standard[0]).toBeLessThan(z.standard[1]);
      expect(z.standard[0]).toBeGreaterThanOrEqual(z.minimum);
      expect(z.ceiling).toBeGreaterThanOrEqual(z.standard[1]);
      expect(z.degrade.length, t).toBeGreaterThan(20);   // a real rule, not a word
    });
    expect(Object.keys(BIKE_SIZING).sort()).toEqual([...BIKE_TYPES].sort());
  });
});

describe('§4: level gates are explicit and monotonic', () => {
  it('lower levels get shorter efforts, more recovery and fewer reps', () => {
    const g = i => levelGate(i);
    [-1, 0, 1, 2].forEach(i => expect(LEVEL_GATES[String(i)], String(i)).toBeTruthy());
    // effort length rises with level, recovery falls, ceiling rises
    expect(g(-1).onScale).toBeLessThan(g(0).onScale);
    expect(g(0).onScale).toBeLessThan(g(1).onScale);
    expect(g(1).onScale).toBeLessThan(g(2).onScale);
    expect(g(-1).offScale).toBeGreaterThan(g(0).offScale);
    expect(g(1).offScale).toBeGreaterThan(g(2).offScale);
    expect(g(-1).maxReps).toBeLessThan(g(2).maxReps);
  });

  it('over-unders and cadence constraints stay locked below advanced', () => {
    expect(levelGate(-1).overUnder).toBe(false);
    expect(levelGate(0).overUnder).toBe(false);
    expect(levelGate(1).overUnder).toBe(true);
    expect(levelGate(2).cadence).toBe(true);
    expect(levelGate(-1).cadence).toBe(false);
  });

  it('an unknown level falls back rather than throwing', () => {
    expect(levelGate(undefined).label).toBe('intermediate');
    expect(levelGate(99).label).toBe('intermediate');
  });

  it('a beginner and an elite get genuinely different work at the same length', () => {
    const beg = bikeMainSet({ type: 'Sweet Spot', intensity: -1, seed: 0, mainMin: 60 });
    const eli = bikeMainSet({ type: 'Sweet Spot', intensity: 2, seed: 0, mainMin: 60 });
    expect(eli.on).toBeGreaterThan(beg.on);       // longer efforts
    expect(eli.off).toBeLessThan(beg.off);        // less recovery
    expect(eli.cadence).toBeTruthy();
    expect(beg.cadence).toBe(null);
  });
});

describe('§3: progression moves one variable at a time', () => {
  it('each step changes exactly one thing against the base', () => {
    const b = PROGRESSION_STEPS[0];
    expect(b.id).toBe('base');
    PROGRESSION_STEPS.slice(1).forEach(s => {
      const moved = [s.on || 0, s.off || 0, s.addReps || 0].filter(x => x !== 0).length;
      expect(moved, s.id + ' moves ' + moved + ' variables').toBe(1);
      expect(s.why.length).toBeGreaterThan(10);
    });
  });

  it('consecutive weeks advance the ladder, and a recovery week resets it', () => {
    const at = seed => bikeMainSet({ type: 'Sweet Spot', intensity: 1, seed, mainMin: 60 });
    const steps = [0, 1, 2, 3].map(s => at(s).step);
    expect(new Set(steps).size).toBe(4);          // four distinct steps, not a shuffle
    // a recovery week pins the seed to 0, which is the base step
    expect(at(0).step).toBe('base');
    expect(at(4).step).toBe('base');              // and the ladder cycles
  });

  it('never lets the main set overrun the time it was given', () => {
    LEVELS.forEach((_, i) => {
      [20, 30, 45, 60, 90].forEach(mainMin => {
        const ms = bikeMainSet({ type: 'Sweet Spot', intensity: i - 1, seed: i, mainMin });
        if (ms) expect(ms.minutes, 'level ' + (i - 1) + ' in ' + mainMin).toBeLessThanOrEqual(mainMin);
      });
    });
  });

  it('returns nothing rather than a set too big for the session', () => {
    // two reps is the floor; below that the caller must build something else
    expect(bikeMainSet({ type: 'Sweet Spot', intensity: 2, seed: 0, mainMin: 10 })).toBe(null);
    expect(bikeMainSet({ type: 'Endurance', intensity: 0, seed: 0, mainMin: 60 })).toBe(null); // no shape
    expect(bikeMainSet({ type: 'Sweet Spot', intensity: 0, seed: 0, mainMin: 0 })).toBe(null);
  });
});

describe('the gating reaches real plans without breaking the card', () => {
  it('every generated ride still sums to its stated duration', () => {
    LEVELS.forEach(fitness => ['sprint', 'olympic', 'half', 't100', 'full'].forEach(raceType => {
      generatePlan({ ...base, fitness, raceType }).weeks
        .flatMap(w => w.workouts).filter(isTrainingRide)
        .forEach(w => expect(bikeWorkoutIssues(w), fitness + '/' + raceType + ' ' + w.type).toEqual([]));
    }));
  });

  it('an elite rider is actually given the unlocked structures somewhere', () => {
    const p = generatePlan({ ...base, fitness: 'elite' });
    const labels = p.weeks.flatMap(w => w.workouts).filter(isTrainingRide)
      .flatMap(w => w.segments.map(s => s.label)).join(' | ');
    expect(labels).toMatch(/rpm/);                 // cadence constraint reaches the card
  });

  it('a beginner is never given a cadence-constrained sweet spot', () => {
    const p = generatePlan({ ...base, fitness: 'beginner' });
    p.weeks.flatMap(w => w.workouts).filter(isTrainingRide)
      .filter(w => w.type === 'Sweet Spot')
      .forEach(w => w.segments.forEach(s => expect(s.label).not.toMatch(/85-95 rpm/)));
  });
});

describe('§6: the long-ride cap holds at every race distance and lead-in', () => {
  const longsIn = (p, phase) => p.weeks.filter(w => w.phase === phase)
    .flatMap(w => w.workouts).filter(w => w.discipline === 'bike' && w.role === 'long')
    .map(w => w.durationMin);

  it('a far-out race of any distance caps its Maintain long rides to maintenance scale', () => {
    ['sprint', 'olympic', 'half', 't100', 'full'].forEach(raceType => {
      LEVELS.forEach(fitness => {
        const farOut = generatePlan({ ...base, fitness, raceType, raceDate: '2027-08-01' });
        const maintain = longsIn(farOut, 'Maintain');
        if (!maintain.length) return;             // not every distance has a lead-in
        const pure = longsIn(generatePlan({ ...base, fitness, raceType: 'maintenance' }), 'Maintain');
        expect(Math.max(...maintain), raceType + '/' + fitness).toBeLessThanOrEqual(Math.max(...pure));
      });
    });
  });

  it('the cap scales with the lead-in length, never with the race distance', () => {
    // the point of the rule: a distant full must not spend months on its
    // full-distance long ride
    ['2026-12-01', '2027-03-01', '2027-08-01'].forEach(raceDate => {
      const p = generatePlan({ ...base, fitness: 'advanced', raceType: 'full', raceDate });
      const maintain = longsIn(p, 'Maintain');
      const build = longsIn(p, 'Build');
      if (!maintain.length || !build.length) return;
      expect(Math.max(...maintain), raceDate).toBeLessThan(Math.max(...build) * 0.6);
    });
  });
});
