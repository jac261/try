import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { isTrainingRide } from './bikeschema.js';
import { bikePowerAnchor } from './domain.js';
import { longRideObjective, longRideMix, LONG_OBJECTIVES, LONG_FOCUSES, MAX_HARD_LONG_SHARE } from './bike-long.js';
import { bikeFuellingPlan, fuellingOutcome, provenIntake, FUELLING_RULES, FUEL_LEVEL_GRAMS } from './bike-fuelling.js';
import { brickExecution, brickPattern, BRICK_RULES } from './brick.js';
import { positionAsk, positionRead, positionTolerance, POSITION_RULES, AERO_SYMPTOMS } from './bike-position.js';

const base = {
  name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-11-01',
};
const plan = generatePlan(base);
const rides = plan.weeks.flatMap(w => w.workouts).filter(isTrainingRide);
const longs = rides.filter(w => w.type === 'Long');

describe('§1: Long rides have rotating objectives', () => {
  it('every generated Long ride knows what it is for', () => {
    expect(longs.length).toBeGreaterThan(4);
    longs.forEach(w => {
      const o = longRideObjective({ workout: w, seed: w.seed });
      expect(o, w.durationMin + ' min Long has no objective').toBeTruthy();
      expect(LONG_OBJECTIVES[o.primary], o.primary).toBeTruthy();
      expect(LONG_FOCUSES[o.focus], o.focus).toBeTruthy();
      expect(o.why.length).toBeGreaterThan(30);
    });
  });

  it('they genuinely rotate rather than all reading the same', () => {
    const objs = longs.map(w => longRideObjective({ workout: w, seed: w.seed }));
    expect(new Set(objs.map(o => o.primary)).size).toBeGreaterThan(1);
    expect(new Set(objs.map(o => o.focus)).size).toBe(Object.keys(LONG_FOCUSES).length);
  });

  it('NOT every Long ride becomes harder', () => {
    // §1's actual constraint, and the failure mode of any durability system:
    // every long ride grows a harder block until the athlete is doing
    // threshold work at hour four every week. Asked of the plans, not asserted.
    ['sprint', 'olympic', 'half', 'full'].forEach(raceType =>
      ['beginner', 'intermediate', 'advanced', 'elite'].forEach(fitness => {
        const p = generatePlan({ ...base, raceType, fitness });
        const objs = p.weeks.flatMap(w => w.workouts).filter(isTrainingRide)
          .filter(w => w.type === 'Long')
          .map(w => longRideObjective({ workout: w, seed: w.seed }));
        const mix = longRideMix(objs);
        if (!mix) return;
        expect(mix.withinGuidance, raceType + '/' + fitness + ': ' + mix.hard + ' of ' + mix.total
          + ' long rides are the harder objectives').toBe(true);
      }));
  });

  it('a ride with a run after it is read as brick preparation', () => {
    const w = longs[0];
    expect(longRideObjective({ workout: w, seed: 0, brickFollows: true }).primary).toBe('brick-preparation');
  });

  it('says nothing about sessions that are not Long rides', () => {
    const other = rides.find(w => w.type === 'Threshold');
    expect(longRideObjective({ workout: other, seed: 0 })).toBe(null);
  });
});

describe('§3: fuelling plans are workout specific', () => {
  const profile = { ...base };
  it('a short ride gets no fuelling plan at all', () => {
    expect(bikeFuellingPlan({ workout: { discipline: 'bike', durationMin: 45, segments: [] }, profile })).toBe(null);
  });

  it('scales with duration, intensity and a run to follow', () => {
    const at = (durationMin, over = {}) => bikeFuellingPlan({
      workout: { discipline: 'bike', durationMin, segments: [{ min: durationMin, zone: 'Z2' }], ...over }, profile,
    });
    expect(at(90).carbsPerHour).toBeLessThan(at(180).carbsPerHour);
    expect(at(180).carbsPerHour).toBeLessThan(at(300).carbsPerHour);
    const steady = at(180);
    const quality = bikeFuellingPlan({
      workout: { discipline: 'bike', durationMin: 180, segments: [{ min: 30, zone: 'Z4' }] }, profile,
    });
    expect(quality.carbsPerHour).toBeGreaterThan(steady.carbsPerHour);
    const brick = bikeFuellingPlan({
      workout: { discipline: 'bike', durationMin: 180, segments: [{ min: 180, zone: 'Z2' }] }, profile, brickFollows: true,
    });
    expect(brick.carbsPerHour).toBeGreaterThan(steady.carbsPerHour);
  });

  it('totals follow the per-hour figure and the length of the ride', () => {
    const p = bikeFuellingPlan({ workout: { discipline: 'bike', durationMin: 240, segments: [{ min: 240, zone: 'Z2' }] }, profile });
    expect(p.carbsTotal).toBe(Math.round(p.carbsPerHour * 4));
    expect(p.fluidTotalLo).toBe(p.fluidLoPerHour * 4);
  });

  it('will not prescribe more than one step above a proven gut', () => {
    // absorbing carbohydrate is trained; 90 g/h to someone who has never held
    // 60 is how a long ride becomes a gastrointestinal event
    const w = { discipline: 'bike', durationMin: 300, segments: [{ min: 300, zone: 'Z2' }] };
    const untrained = bikeFuellingPlan({ workout: w, profile, fuelLog: { a: { level: 'bit' } } });
    expect(provenIntake({ a: { level: 'bit' } })).toBe(30);
    expect(untrained.carbsPerHour).toBe(30 + FUELLING_RULES.gutStepGrams);
    expect(untrained.capped).toBe(true);
    expect(untrained.why).toMatch(/trained/);
    // and a trained gut is not held back
    const trained = bikeFuellingPlan({ workout: w, profile, fuelLog: { a: { level: 'race' } } });
    expect(trained.carbsPerHour).toBeGreaterThan(untrained.carbsPerHour);
    expect(trained.capped).toBe(false);
  });

  it('no history is not the same as no tolerance', () => {
    // an athlete who has never answered must not be rationed like a beginner
    expect(provenIntake({})).toBe(null);
    expect(provenIntake(null)).toBe(null);
    const w = { discipline: 'bike', durationMin: 300, segments: [{ min: 300, zone: 'Z2' }] };
    const fresh = bikeFuellingPlan({ workout: w, profile, fuelLog: {} });
    expect(fresh.capped).toBe(false);
    expect(fresh.why).toMatch(/starting point/);
  });

  it('names sodium as unpersonalised rather than inventing it', () => {
    const p = bikeFuellingPlan({ workout: { discipline: 'bike', durationMin: 180, segments: [{ min: 180, zone: 'Z2' }] }, profile });
    expect(p.sodiumMgPerHour).toBe(null);
    expect(p.sodiumNote).toMatch(/sweat rate/i);
  });

  it('compares planned against what the athlete actually took', () => {
    const p = bikeFuellingPlan({ workout: { discipline: 'bike', durationMin: 240, segments: [{ min: 240, zone: 'Z2' }] }, profile, fuelLog: { x: { level: 'race' } } });
    const short = fuellingOutcome({ plan: p, level: 'bit' });
    expect(short.met).toBe(false);
    expect(short.consumedPerHour).toBe(FUEL_LEVEL_GRAMS.bit);
    expect(short.text).toMatch(/last hour/);
    const hit = fuellingOutcome({ plan: p, level: 'race' });
    expect(hit.met).toBe(true);
  });

  it('an unanswered tap is not scored as a failure', () => {
    const p = bikeFuellingPlan({ workout: { discipline: 'bike', durationMin: 240, segments: [{ min: 240, zone: 'Z2' }] }, profile });
    expect(fuellingOutcome({ plan: p, level: null })).toBe(null);
    expect(fuellingOutcome({ plan: null, level: 'solid' })).toBe(null);
  });
});

describe('§4: the bike is judged on the run that follows', () => {
  const paces = plan.paces;
  const target = paces.run.long || paces.run.easy;
  const runAt = (pct, over = {}) => ({
    id: 'r', type: 'Run', date: '2026-06-10', movingTimeSec: 1800,
    distance: 1800 / (target * pct) * 1000, ...over,
  });
  const ride = (over = {}) => ({ id: 'b', type: 'Ride', date: '2026-06-10', movingTimeSec: 5400, averageWatts: 160, ...over });

  it('a run held near fresh pace is a good brick', () => {
    const e = brickExecution({ ride: ride(), run: runAt(1.0), paces, raceType: 'half' });
    expect(e.ruined).toBe(false);
    expect(e.text).toMatch(/point of a brick/);
  });

  it('a run well down on fresh pace is flagged, with the bike-side reason', () => {
    const e = brickExecution({
      ride: ride({ averageWatts: 250 * 0.9 }), run: runAt(1.35), paces, raceType: 'half',
      fuelLevel: 'none',
    });
    expect(e.ruined).toBe(true);
    expect(e.causes).toContain('ride-hard');
    expect(e.causes).toContain('under-fuelled');
  });

  it('ONE ruined run is never a verdict on how somebody rides', () => {
    const bad = brickExecution({ ride: ride({ averageWatts: 250 * 0.9 }), run: runAt(1.35), paces });
    expect(brickPattern([bad])).toBe(null);
    expect(brickPattern([bad, brickExecution({ ride: ride(), run: runAt(1.0), paces })])).toBe(null);
  });

  it('but a pattern is, and it names the shared cause', () => {
    const bad = () => brickExecution({ ride: ride({ averageWatts: 250 * 0.9 }), run: runAt(1.35), paces });
    const p = brickPattern([bad(), bad()]);
    expect(p.ruined).toBe(BRICK_RULES.minPattern);
    expect(p.causes).toContain('ride-hard');
    expect(p.text).toMatch(/Ride the bike leg easier/);
  });

  it('states that transition duration is not available rather than omitting it', () => {
    const e = brickExecution({ ride: ride(), run: runAt(1.0), paces });
    expect('transitionSec' in e).toBe(true);
    expect(e.transitionSec).toBe(null);
  });

  it('says nothing without a usable run', () => {
    expect(brickExecution({ ride: ride(), run: null, paces })).toBe(null);
    expect(brickExecution({ ride: ride(), run: { movingTimeSec: 0 }, paces })).toBe(null);
    expect(brickExecution({ ride: ride(), run: runAt(1.0), paces: {} })).toBe(null);
  });
});

describe('§5: aero tolerance, tracked separately from FTP', () => {
  it('is only asked about rides long enough for position to be the limiter', () => {
    expect(positionAsk({ discipline: 'bike', type: 'Long', durationMin: 180 })).toBe(true);
    expect(positionAsk({ discipline: 'bike', type: 'Long', durationMin: 45 })).toBe(false);
    expect(positionAsk({ discipline: 'run', type: 'Long', durationMin: 180 })).toBe(false);
    expect(positionAsk(null)).toBe(false);
  });

  it('one or two answers are never a verdict', () => {
    const r = positionRead({ comfort: 'bad', minutes: 180 });
    expect(positionTolerance([r]).verdict).toBe('unknown');
    expect(positionTolerance([r, r]).verdict).toBe('unknown');
    expect(positionTolerance([]).verdict).toBe('unknown');
  });

  it('a comfortable run of long rides earns more time in position', () => {
    const reads = [1, 2, 3].map(() => positionRead({ comfort: 'easy', minutes: 180 }));
    const t = positionTolerance(reads);
    expect(t.verdict).toBe('build');
    expect(t.text).toMatch(/extending/);
  });

  it('coming out of position repeatedly shortens the blocks instead', () => {
    const reads = [1, 2, 3].map(() => positionRead({ comfort: 'bad', minutes: 150 }));
    const t = positionTolerance(reads);
    expect(t.verdict).toBe('back-off');
    expect(t.text).toMatch(/shorter blocks/);
  });

  it('a recurring symptom is reported, never diagnosed', () => {
    // §5: "This should guide progression, not diagnose bike fit."
    const reads = [1, 2, 3].map(() => positionRead({ comfort: 'hard', symptoms: ['neck'], minutes: 150 }));
    const t = positionTolerance(reads);
    expect(t.recurring).toContain('neck');
    expect(t.text).toMatch(/bike fitter/);
    Object.keys(AERO_SYMPTOMS).forEach(() => {
      expect(t.text).not.toMatch(/saddle is too|bars are too|stem|too high|too low/i);
    });
  });

  it('nothing in the position model touches the power anchor', () => {
    // §5 and §6 both require these stay separate: a rider who holds less
    // power on the bars does not have a threshold problem
    const before = bikePowerAnchor({ ftp: 250 });
    positionTolerance([1, 2, 3].map(() => positionRead({ comfort: 'bad', minutes: 200 })));
    expect(bikePowerAnchor({ ftp: 250 })).toEqual(before);
  });
});

describe('§6: the shipped caps survive', () => {
  it('far-out maintenance long rides are still capped', () => {
    // phase 1 pinned this; phase 6 is the one most likely to break it, since
    // it is the phase that makes long rides interesting
    const far = generatePlan({ ...base, raceType: 'full', startDate: '2026-06-01', raceDate: '2027-08-01' });
    const early = far.weeks.slice(0, 8).flatMap(w => w.workouts)
      .filter(w => isTrainingRide(w) && w.type === 'Long');
    expect(early.length).toBeGreaterThan(0);
    const build = far.weeks.filter(w => w.phase === 'Build').flatMap(w => w.workouts)
      .filter(w => isTrainingRide(w) && w.type === 'Long');
    if (build.length) {
      const maxEarly = Math.max(...early.map(w => w.durationMin));
      const maxBuild = Math.max(...build.map(w => w.durationMin));
      expect(maxEarly).toBeLessThan(maxBuild);
    }
  });
});
