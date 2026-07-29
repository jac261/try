import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generatePlan } from './plan.js';
import { RUN_TYPES, RUN_LADDER_TYPES, RUN_QUALITY_TYPES, isEffortPrescribed, runWorkoutIssues } from './runschema.js';
import {
  RUN_SIZING, RUN_MIN_SESSION_MIN, RUN_HILL_GATE,
  runMainSet, runReps, runHillsAllowed, runSizingIssues,
} from './run-sizing.js';

/* Run phase 3 — the workout library, hills and progression.
 *
 * The sizing numbers were already in the engine, scattered as literals across
 * six branches of buildRun where nothing could read them and nothing could
 * check them. This phase moved them into one table that buildRun now reads,
 * byte-identically, and pins the acceptance criteria the spec lists in §6.
 */

const base = {
  name: 'R', fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const DAYSETS = { 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
const ZONE_RANK = { Z1: 1, Z2: 2, Z3: 3, Z4: 4, Z5: 5 };
const LADDER = ['Easy', 'Fartlek', 'Tempo', 'Threshold', 'VO2 Intervals'];

const planFor = (raceType, fitness, days) => generatePlan({
  ...base, raceType, fitness, daysPerWeek: days, trainingDays: DAYSETS[days], longDay: days >= 3 ? 5 : 1,
});
const runsIn = w => w.workouts.filter(x => x.discipline === 'run' && !x.race);
const raceWeekIdx = p => p.weeks.findIndex(w => w.workouts.some(x => x.race));

describe('the sizing table is the one the engine reads', () => {
  it('covers every built type and nothing else, coherently', () => {
    expect(runSizingIssues()).toEqual([]);
    Object.keys(RUN_SIZING).forEach(t => expect(RUN_TYPES).toContain(t));
    RUN_TYPES.forEach(t => expect(RUN_SIZING[t], 'no sizing for ' + t).toBeTruthy());
  });

  it('buildRun reads the table rather than carrying its own literals', () => {
    /* The point of the extraction. If a warm-up goes back to being a literal
       in one branch, the table stops being authoritative and generation and
       any future judge can drift apart, which is the failure the swim and
       bike arcs hit four times between them. */
    const src = readFileSync(new URL('./plan.js', import.meta.url), 'utf8');
    const buildRun = src.slice(src.indexOf('function buildRun('), src.indexOf('function buildBike('));
    expect(buildRun).toContain('runMainSet(');
    expect(buildRun).toContain('runReps(');
    expect(buildRun).toContain('runHillsAllowed(');
    // no hand-rolled rep arithmetic left behind
    expect(buildRun).not.toMatch(/clamp\(Math\.round\(\(dur - \d+\)/);
    // and no bare warm-up/cool-down minutes in the quality formats
    expect(buildRun).not.toMatch(/label: 'Warm-up', min: \d/);
    expect(buildRun).not.toMatch(/label: 'Cool-down', min: \d/);
  });

  it('the main set is what is left after the format is paid for', () => {
    expect(runMainSet('Tempo', 60)).toEqual({ warmup: 12, main: 38, cooldown: 10, flex: 'tail' });
    expect(runMainSet('Threshold', 60).main).toBe(35);
    expect(runMainSet('Fartlek', 60).main).toBe(42);
    // the floor holds a hard-trimmed session above a stub
    expect(runMainSet('Tempo', 20).main).toBe(RUN_SIZING.Tempo.mainFloor);
  });

  it('rep counts take their lead from the type, not a shared constant', () => {
    // Fartlek derives from dur − 18, Threshold and VO2 from dur − 25. A single
    // hardcoded lead here would give every Fartlek seven minutes less main
    // set than the engine actually builds.
    // (60 − 18) / 3 = 14, which the format's own ceiling of 12 binds
    expect(runReps('Fartlek', 60, 3, 6, 12)).toBe(12);
    expect(runReps('Fartlek', 45, 3, 6, 12)).toBe(Math.round((45 - 18) / 3));
    expect(runReps('Threshold', 60, 12, 2, 4)).toBe(Math.max(2, Math.min(4, Math.round((60 - 25) / 12))));
    expect(RUN_SIZING.Fartlek.lead).not.toBe(RUN_SIZING.Threshold.lead);
    // and the bounds really bind
    expect(runReps('VO2 Intervals', 500, 5, 4, 8)).toBe(8);
    expect(runReps('VO2 Intervals', 0, 5, 4, 8)).toBe(4);
  });

  it('no generated run falls below the minimum useful session', () => {
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        for (const d of [3, 5, 7]) {
          const p = planFor(rt, fit, d);
          p.weeks.forEach((w, i) => {
            if (i >= raceWeekIdx(p)) return; // race week has its own caps
            runsIn(w).forEach(x =>
              expect(x.durationMin, rt + '/' + fit + '/' + d + 'd wk' + i + ' ' + x.type).toBeGreaterThanOrEqual(RUN_MIN_SESSION_MIN));
          });
        }
      }
    }
  });

  it('every generated session still sums to what it claims', () => {
    // the degradation path included: a hard-trimmed session collapses to a
    // single steady block rather than to a broken card
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        planFor(rt, fit, 5).weeks.forEach(w => runsIn(w).forEach(x =>
          expect(runWorkoutIssues(x), rt + '/' + fit + ' ' + x.type).toEqual([])));
      }
    }
  });
});

describe('the ladder is stable and hills stay gated', () => {
  it('the ladder is exactly the shipped five, in order', () => {
    // the LADDER, not the quality category: phase 7 added 'Race Pace' to
    // the latter, and it is deliberately not a rung
    expect(['Easy', ...RUN_LADDER_TYPES]).toEqual(LADDER);
  });

  it('the hill gate is phase and level only, never duration', () => {
    // Both survive an ease or trim rebuild; duration does not, and gating on
    // it would flip a stored session's format across a trim.
    expect(runHillsAllowed('Build', 0)).toBe(true);
    expect(runHillsAllowed('Peak', 2)).toBe(true);
    expect(runHillsAllowed('Base', 2)).toBe(false);
    expect(runHillsAllowed('Taper', 2)).toBe(false);
    expect(runHillsAllowed('Build', -1)).toBe(false); // beginner
    expect(RUN_HILL_GATE.phases).toEqual(['Build', 'Peak']);
  });

  it('generated hills appear only inside the gate', () => {
    let hills = 0;
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        for (const d of [3, 5, 7]) {
          const p = planFor(rt, fit, d);
          p.weeks.forEach(w => runsIn(w).forEach(x => {
            if (!(x.segments || []).some(isEffortPrescribed)) return;
            hills++;
            expect(['Build', 'Peak'], rt + '/' + fit + ' hill in ' + w.phase).toContain(w.phase);
            expect(fit, 'beginner got a hill session').not.toBe('beginner');
          }));
        }
      }
    }
    expect(hills).toBeGreaterThan(0); // a sweep that found no hills proves nothing
  });

  it('only Threshold and VO2 carry hills, as sustained climbs and repetitions', () => {
    const seen = new Set();
    for (const rt of SOLO) {
      for (const fit of ['advanced', 'elite']) {
        planFor(rt, fit, 5).weeks.forEach(w => runsIn(w).forEach(x => {
          if ((x.segments || []).some(isEffortPrescribed)) seen.add(x.type);
        }));
      }
    }
    expect([...seen].sort()).toEqual(['Threshold', 'VO2 Intervals']);
  });
});

describe('progression moves one principal dimension at a time', () => {
  it('never raises the ladder rung and the quality volume together', () => {
    /* §5: "avoid simultaneous large increases in distance, intensity and
       density". Compared like for like: recovery weeks are lighter by design,
       a test week spends a quality slot on the test, and a week where the
       NUMBER of quality sessions changed is a different shape rather than a
       bigger one. Without those exclusions the raw sweep reports 22 false
       positives, every one of them a week adjacent to a test. */
    let checked = 0;
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        for (const d of [3, 4, 5, 6, 7]) {
          const p = planFor(rt, fit, d);
          const rwi = raceWeekIdx(p);
          const per = p.weeks.map(w => {
            const runs = runsIn(w);
            const q = runs.filter(x => RUN_QUALITY_TYPES.includes(x.type));
            return {
              rung: q.length ? Math.max(...q.map(x => LADDER.indexOf(x.type))) : -1,
              qmin: q.reduce((t, x) => t + x.durationMin, 0),
              nq: q.length,
              hasTest: runs.some(x => x.type === 'Test'),
              rec: w.isRecovery,
            };
          });
          for (let i = 1; i < rwi; i++) {
            const a = per[i - 1], b = per[i];
            if (a.rec || b.rec || a.hasTest || b.hasTest) continue;
            if (a.rung < 0 || b.rung < 0 || a.nq !== b.nq) continue;
            checked++;
            const rungUp = b.rung > a.rung;
            const volUp = a.qmin > 0 && (b.qmin - a.qmin) / a.qmin > 0.10;
            expect(rungUp && volUp,
              rt + '/' + fit + '/' + d + 'd wk' + (i - 1) + '->' + i
              + ' rung ' + LADDER[a.rung] + '->' + LADDER[b.rung] + ', quality ' + a.qmin + '->' + b.qmin).toBe(false);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300); // the sweep really did sweep
  });

  it('rep count is a function of duration, so nothing else may add reps', () => {
    // The bike arc shipped a progression rung that tried to add reps on top
    // of a count that was already max-fitting, and it was a no-op. Growing
    // the session IS the rep progression.
    const shorter = runReps('Threshold', 50, 7, 3, 6);
    const longer = runReps('Threshold', 78, 7, 3, 6);
    expect(longer).toBeGreaterThan(shorter);
  });
});

describe('level and recovery shape the week', () => {
  it('lower levels get simpler structures, by ceiling and by terrain', () => {
    /* Measured on the MARATHON, whose ladder is uncapped. The half was the
       fixture until the 2026-07-29 threshold bias: its ladder is now capped
       at Threshold for every level (pyramidal on the evidence), so its zone
       ceiling is deliberately flat across levels and no longer demonstrates
       the level-scaling this test is about. */
    const maxZoneFor = fit => {
      const runs = planFor('runmarathon', fit, 5).weeks.flatMap(w => runsIn(w));
      return Math.max(...runs.flatMap(x => (x.segments || []).map(s => ZONE_RANK[s.zone] || 0)));
    };
    const hillsFor = fit => planFor('runmarathon', fit, 5).weeks
      .flatMap(w => runsIn(w)).filter(x => (x.segments || []).some(isEffortPrescribed)).length;
    // the intensity ceiling rises with level and never falls
    const zones = LEVELS.map(maxZoneFor);
    expect(zones).toEqual([...zones].sort((a, b) => a - b));
    expect(zones[0]).toBeLessThan(zones[3]);
    // and terrain demand is earned, not given
    expect(hillsFor('beginner')).toBe(0);
    expect(hillsFor('intermediate')).toBe(0);
    expect(hillsFor('advanced')).toBeGreaterThan(0);
  });

  it('recovery weeks cut load without making every session the same', () => {
    for (const fit of LEVELS) {
      for (const rt of SOLO) {
        const p = planFor(rt, fit, 5);
        const i = p.weeks.findIndex(w => w.isRecovery);
        expect(i, rt + '/' + fit + ' has no recovery week').toBeGreaterThan(0);
        const load = w => runsIn(w).reduce((t, x) => t + x.durationMin, 0);
        expect(load(p.weeks[i]), rt + '/' + fit).toBeLessThan(load(p.weeks[i - 1]));
        // recovery pins seed 0, which is exactly the setting that could make
        // every session collapse onto one canonical format
        const runs = runsIn(p.weeks[i]);
        const sigs = new Set(runs.map(x => JSON.stringify([x.type, x.durationMin, (x.segments || []).map(s => s.label)])));
        expect(sigs.size, rt + '/' + fit + ' recovery week has duplicate sessions').toBe(runs.length);
      }
    }
  });
});

describe('the barrel exports the sizing module', () => {
  it('run-sizing is reachable from the package entry point', async () => {
    const barrel = await import('./index.js');
    ['RUN_SIZING', 'RUN_MIN_SESSION_MIN', 'RUN_HILL_GATE', 'runMainSet', 'runReps', 'runHillsAllowed']
      .forEach(k => expect(barrel[k], k + ' missing from the barrel').toBeTruthy());
  });
});
