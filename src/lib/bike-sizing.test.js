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

const TYPES = ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'];

describe('§3: progression moves one variable at a time', () => {
  it('each step changes exactly one thing against the base', () => {
    const b = PROGRESSION_STEPS[0];
    expect(b.id).toBe('base');
    PROGRESSION_STEPS.slice(1).forEach(s => {
      const moved = [s.reps || 0, s.off || 0].filter(x => x !== 0).length;
      expect(moved, s.id + ' moves ' + moved + ' variables').toBe(1);
      expect(s.why.length).toBeGreaterThan(10);
    });
  });

  it('every step is OBSERVABLE: it changes the session, not just the table', () => {
    // The test above asserts the table. The table can be perfectly coherent
    // and still describe nothing: an earlier ladder added a repetition to a
    // count that was already the largest one that fits, so the fitting
    // arithmetic took it straight back off and two of the five rungs were
    // byte-identical to the base rung at every legal input. A rung has to
    // change the session an athlete is handed, so that is what is asserted.
    const shape = m => (m ? m.reps + 'x' + m.on + '/' + m.off : 'none');
    PROGRESSION_STEPS.forEach((st, i) => {
      if (i === 0) return;
      let differs = 0;
      TYPES.forEach(type => [-1, 0, 1, 2].forEach(intensity => {
        for (let mainMin = 10; mainMin <= 120; mainMin++) {
          const base0 = bikeMainSet({ type, intensity, seed: 0, mainMin });
          if (!base0) continue;
          if (shape(bikeMainSet({ type, intensity, seed: i, mainMin })) !== shape(base0)) differs += 1;
        }
      }));
      expect(differs, st.id + ' never changes the session it is given').toBeGreaterThan(0);
    });
  });

  it('no step can change whether the session is intervals at all', () => {
    // Progression changes the shape of a set at constant time. It must never
    // decide there IS no set: a rung that pushed the session past the point
    // where two efforts fit dropped the card through to the continuous
    // fallback, so progressing DELETED the intervals, and a trim could flip
    // a session's format on its way down. Buildability is judged on the base
    // recovery, so the answer is the same on every rung.
    TYPES.forEach(type => [-1, 0, 1, 2].forEach(intensity => {
      for (let mainMin = 1; mainMin <= 150; mainMin++) {
        const built = PROGRESSION_STEPS.map((_, i) =>
          bikeMainSet({ type, intensity, seed: i, mainMin }) !== null);
        expect(new Set(built).size, type + ' lv' + intensity + ' mainMin ' + mainMin
          + ' builds a set on some rungs and not others').toBe(1);
      }
    }));
  });

  it('never prescribes an effort longer than the type can be ridden at', () => {
    // A flat "+3 minutes to the effort" rung turned four-minute VO2
    // repetitions into eight-minute ones still stamped at 106-120% FTP:
    // not a harder session, an impossible one, and the review engine would
    // then mark every repetition off target for the rest of the block.
    const CEILING = { Tempo: 20, 'Sweet Spot': 20, Threshold: 18, 'VO2 Intervals': 6 };
    TYPES.forEach(type => [-1, 0, 1, 2].forEach(intensity =>
      PROGRESSION_STEPS.forEach((st, i) => {
        for (let mainMin = 10; mainMin <= 200; mainMin++) {
          const m = bikeMainSet({ type, intensity, seed: i, mainMin });
          if (!m) continue;
          expect(m.on, type + ' ' + st.id + ' asks for a ' + m.on + ' min effort').toBeLessThanOrEqual(CEILING[type]);
          expect(m.on).toBeGreaterThanOrEqual(3);
          expect(m.off).toBeGreaterThanOrEqual(1);
          expect(m.minutes).toBeLessThanOrEqual(mainMin);
        }
      })));
  });

  it('consecutive weeks advance the ladder, and a recovery week resets it', () => {
    const at = seed => bikeMainSet({ type: 'Sweet Spot', intensity: 1, seed, mainMin: 60 });
    const steps = PROGRESSION_STEPS.map((_, i) => at(i).step);
    expect(new Set(steps).size).toBe(PROGRESSION_STEPS.length);   // distinct, not a shuffle
    // a recovery week pins the seed to 0, which is the base step
    expect(at(0).step).toBe('base');
    expect(at(PROGRESSION_STEPS.length).step).toBe('base');       // and the ladder cycles
  });

  it('every step is actually reachable, at every level, in a real plan', () => {
    // The index is the week and recovery weeks pin it to zero, so the ladder
    // length has to be coprime with the recovery cadence or some steps are
    // dead. A four-step ladder against the four-week cadence left density
    // unreachable for three of the four levels, and the table-level test
    // above still passed. This one asks the plans.
    LEVELS.forEach(fitness => {
      const p = generatePlan({ ...base, fitness });
      const seen = new Set();
      p.weeks.forEach(wk => {
        const seed = wk.isRecovery ? 0 : wk.index;
        const ridesQuality = wk.workouts.some(w => isTrainingRide(w)
          && ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'].includes(w.type));
        if (ridesQuality) seen.add(PROGRESSION_STEPS[seed % PROGRESSION_STEPS.length].id);
      });
      PROGRESSION_STEPS.forEach(st =>
        expect(seen.has(st.id), fitness + ' never reaches the ' + st.id + ' step').toBe(true));
    });
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

describe('every interval type is wired, not just the first one', () => {
  const RACES = ['sprint', 'olympic', 'half', 't100', 'full'];
  const ridesOfType = (fitness, type) => RACES.flatMap(raceType =>
    generatePlan({ ...base, fitness, raceType }).weeks.flatMap(w => w.workouts)
      .filter(w => isTrainingRide(w) && w.type === type));

  it('a beginner and an elite get different efforts in every interval type', () => {
    // the shape knobs the gate moves are on and off, so compare the rep
    // labels that carry them
    ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'].forEach(type => {
      const beg = new Set(ridesOfType('beginner', type).flatMap(w => w.segments.map(s => s.label)));
      const eli = new Set(ridesOfType('elite', type).flatMap(w => w.segments.map(s => s.label)));
      if (!beg.size || !eli.size) return;                 // not every level reaches every type
      expect([...eli].some(l => !beg.has(l)), type).toBe(true);
    });
  });

  it('over-unders are unlocked at advanced and never given below it', () => {
    const ou = fitness => ridesOfType(fitness, 'Threshold')
      .filter(w => w.segments.some(s => /over-under/.test(s.label || ''))).length;
    // measured: intermediate has 22 threshold sessions and none of them
    // over-unders; before the gate about a third of them were
    expect(ridesOfType('intermediate', 'Threshold').length).toBeGreaterThan(0);
    expect(ou('beginner')).toBe(0);
    expect(ou('intermediate')).toBe(0);
    expect(ou('advanced')).toBeGreaterThan(0);
  });

  it('every wired type still sums, at every level and race', () => {
    LEVELS.forEach(fitness => ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'].forEach(type => {
      ridesOfType(fitness, type).forEach(w =>
        expect(bikeWorkoutIssues(w), fitness + ' ' + type + ' ' + w.durationMin + 'min').toEqual([]));
    }));
  });

  it('the progression reaches the card for each type somewhere', () => {
    // Each type should show more than one distinct main-set shape, which is
    // what progression plus the variant menu produces. Which LEVEL rides a
    // given type is decided by the ladder, not by us: an elite never sees
    // Tempo because their quality sessions sit higher up it, so each type is
    // checked at whichever levels actually receive it.
    ['Tempo', 'Sweet Spot', 'Threshold', 'VO2 Intervals'].forEach(type => {
      const labels = new Set(LEVELS.flatMap(f => ridesOfType(f, type))
        .filter(w => w.segments.some(s => s.blocks))
        .flatMap(w => w.segments.filter(s => s.blocks).map(s => s.label)));
      expect(labels.size, type + ' produced ' + labels.size + ' distinct shapes').toBeGreaterThan(1);
    });
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
