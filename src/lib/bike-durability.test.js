import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { trimWorkout } from './plan.js';
import { brickHistory } from './brick.js';
import { generatePlan } from './plan.js';
import { isTrainingRide } from './bikeschema.js';
import { bikePowerAnchor } from './domain.js';
import { longRideObjective, LONG_OBJECTIVES, LONG_FOCUSES, MAX_HARD_LONG_SHARE } from './bike-long.js';

/* §1's sequence property lives here rather than in the module: nothing in the
   app renders it, and a function exported only for its own test is the shape
   of the defect this file guards against further down. */
function longRideMix(objectives) {
  const list = (objectives || []).filter(Boolean);
  if (!list.length) return null;
  const hard = list.filter(o => o.harder).length;
  return { total: list.length, hard, withinGuidance: hard / list.length <= MAX_HARD_LONG_SHARE };
}
import { bikeFuellingPlan, fuellingOutcome, FUELLING_RULES, FUEL_LEVEL_GRAMS } from './bike-fuelling.js';
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
    expect(untrained.provenGrams).toBe(30);
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
    const w = { discipline: 'bike', durationMin: 300, segments: [{ min: 300, zone: 'Z2' }] };
    const fresh = bikeFuellingPlan({ workout: w, profile, fuelLog: {} });
    expect(fresh.provenGrams).toBe(null);
    expect(bikeFuellingPlan({ workout: w, profile, fuelLog: null }).provenGrams).toBe(null);
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


describe('the adapt paths, which sweeps that only GENERATE always miss', () => {
  it('a trimmed long ride does not keep prescribing the untrimmed fuel load', () => {
    const long = longs.find(w => w.durationMin >= 150) || longs[longs.length - 1];
    const profile = { ...base };
    const full = bikeFuellingPlan({ workout: long, profile });
    [0.6, 0.7, 0.8, 0.9].forEach(f => {
      const t = trimWorkout(long, plan, f);
      if (!t || t.durationMin === long.durationMin) return;
      const cut = bikeFuellingPlan({ workout: t, profile });
      if (!cut) return;   // trimmed below the threshold for needing a plan at all
      expect(cut.carbsTotal, 'trim ' + f + ' still asks for the full load')
        .toBeLessThan(full.carbsTotal);
      expect(cut.hours).toBeLessThan(full.hours);
    });
  });

  it('a trim does not flip what the long ride is FOR', () => {
    // the swim module shipped exactly this: a category salted on duration, so
    // trimming a session silently swapped it for a different one
    longs.forEach(w => {
      const before = longRideObjective({ workout: w, seed: w.seed });
      [0.7, 0.85].forEach(f => {
        const t = trimWorkout(w, plan, f);
        if (!t || t.durationMin === w.durationMin) return;
        const after = longRideObjective({ workout: t, seed: t.seed });
        if (!after) return;
        expect(after.focus, 'trim ' + f + ' changed the rehearsal focus').toBe(before.focus);
      });
    });
  });
});

describe('nothing here is a model without a caller', () => {
  it('every phase 6 export is consumed outside its own module', () => {
    /* This phase shipped brickExecution, brickPattern, positionRead and
       positionTolerance with ZERO consumers on the first cut — the position
       tap wrote answers to a store that nothing ever read, which is worse
       than dead code because it asks the athlete a question and then ignores
       it. The phase before shipped its load model the same way. So the guard
       is generalised rather than the four cases being fixed and forgotten. */
    const MODULES = ['bike-fuelling.js', 'bike-long.js', 'bike-position.js', 'brick.js'];
    const srcFiles = [];
    const walk = dir => readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const full = dir + '/' + e.name;
      if (e.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) srcFiles.push(full);
    });
    walk(new URL('..', import.meta.url).pathname.replace(/\/$/, ''));

    const prodUses = name => srcFiles.filter(f => !/\/(bike-fuelling|bike-long|bike-position|brick)\.js$/.test(f)
      && !f.endsWith('/index.js')
      && new RegExp('\\b' + name + '\\b').test(readFileSync(f, 'utf8'))).length;

    MODULES.forEach(mod => {
      const src = readFileSync(new URL('./' + mod, import.meta.url), 'utf8');
      /* FUNCTIONS only. The defect this guards against is a model with no
         caller — brickExecution, positionTolerance, bikeLoad — not a data
         table. An exported catalogue or threshold set is read by the module
         itself and asserted by tests, and that IS its consumer; requiring a
         production reference for it would only invite pointless re-exports. */
      const exported = [...src.matchAll(/export function (\w+)/g)].map(m => m[1]);
      expect(exported.length, mod + ' exports no functions').toBeGreaterThan(0);
      /* The defect is a module with no PATH INTO THE APP. brick.js shipped
         with none: every function in it was reachable only from its own
         tests. So the module-level assertion is the real one, and each
         function must then be reachable either from production directly or
         through a sibling in its own module that is. */
      expect(exported.some(n => prodUses(n) > 0),
        mod + ' has no export the app actually calls: it is a model with no caller')
        .toBe(true);
      exported.forEach(name => {
        const internal = new RegExp('\\b' + name + '\\b\\s*\\(').test(
          src.replace(new RegExp('export function ' + name + '[^]*?\\n}', 'm'), ''));
        expect(prodUses(name) > 0 || internal,
          mod + ' exports ' + name + ', which nothing in the app and nothing in its own module calls')
          .toBe(true);
      });
    });
  });

  it('the brick evidence has a real path from the plan to the athlete', () => {
    // not just importable: callable with the shapes the app actually holds
    const r = brickHistory({ plan, activities: [], log: {}, moves: {}, paces: plan.paces, fuelLog: {} });
    expect(r.executions).toEqual([]);
    expect(r.pattern).toBe(null);
    expect(brickHistory({ plan: null, activities: [] }).pattern).toBe(null);
  });
});
