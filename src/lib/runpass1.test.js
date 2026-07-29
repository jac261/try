import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generatePlan } from './plan.js';
import { intervalRows } from './review.js';
import { predictRaceTimes } from './runstats.js';
import { runAnchor, hasReal5k, FITNESS, RACES } from './domain.js';
import {
  RUN_TYPES, RUN_EASY_TYPE, RUN_QUALITY_TYPES, RUN_PACE_TYPES,
  isRunWorkout, isRunSegment, isEffortPrescribed, runWorkoutIssues, isTrainingRun,
} from './runschema.js';

/* Run phase 1 — stabilise the shipped run engine.
 *
 * The regression matrix and the invariants for behaviour that ALREADY ships.
 * Everything here pins something the engine does today and must keep doing.
 *
 * Two behaviours the phase spec listed as invariants are deliberately NOT
 * pinned here, because the audit found the engine does not honour them and
 * pinning them would enshrine a defect rather than protect a feature:
 *
 *   1. Race week schedules hard intervals inside the final 48 hours (a bike
 *      VO2 session two days before an Olympic, a run Threshold two days
 *      before a marathon).
 *   2. Race week does not stop at race day: the day after the goal race
 *      carries a training session, including a 65-minute Long ride with
 *      sweet-spot blocks the morning after an Olympic triathlon.
 *
 * Both are raised for a decision rather than silently fixed, because fixing
 * them changes generated output for every athlete. See RACE_WEEK_OPEN below,
 * which pins the CURRENT behaviour explicitly so that a future fix has to
 * come here and change it deliberately rather than drift past it.
 */

const base = {
  name: 'R', fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  daysPerWeek: 5, trainingDays: [0, 1, 3, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-10-03', // a Saturday
};
const DAYSETS = { 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const TRI = ['sprint', 'olympic', 'half', 't100', 'full'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];

const mk = (o = {}) => generatePlan({ ...base, ...o });
const planFor = (raceType, fitness, days) => mk({
  raceType, fitness, daysPerWeek: days, trainingDays: DAYSETS[days], longDay: days >= 3 ? 5 : 1,
});
const runsIn = w => w.workouts.filter(x => x.discipline === 'run' && !x.race);
const isLong = w => w.type === 'Long';
const raceWeekIdx = p => p.weeks.findIndex(w => w.workouts.some(x => x.race));
const dayOf = w => Math.round(new Date(w.dateISO || w.date) / 864e5);

describe('run workout schema', () => {
  it('every generated run in every plan shape is structurally well formed', () => {
    let seen = 0;
    for (const rt of [...SOLO, ...TRI]) {
      for (const fit of LEVELS) {
        for (const d of [3, 5, 7]) {
          planFor(rt, fit, d).weeks.forEach(w => w.workouts
            .filter(x => x.discipline === 'run' && !x.race)
            .forEach(x => {
              seen++;
              const issues = runWorkoutIssues(x);
              expect(issues, rt + '/' + fit + '/' + d + 'd ' + x.type + ': ' + issues.join('; ')).toEqual([]);
            }));
        }
      }
    }
    expect(seen).toBeGreaterThan(2000); // the sweep really did sweep
  });

  it('the closed set matches what generation actually emits, Test included', () => {
    const emitted = new Set();
    for (const rt of [...SOLO, ...TRI]) {
      for (const fit of LEVELS) {
        planFor(rt, fit, 5).weeks.forEach(w => w.workouts
          .filter(x => x.discipline === 'run' && !x.race).forEach(x => emitted.add(x.type)));
      }
    }
    // Nothing generated may fall outside the closed set: that is what would
    // 400 on save. Built from generation, NOT from RUN_TYPES, so the table is
    // checked against an independent source rather than against itself.
    [...emitted].forEach(t => expect(RUN_TYPES, 'generation emitted ' + t).toContain(t));
    // and the set is not carrying entries nothing builds
    expect(emitted.has('Test')).toBe(true);
    expect(emitted.has(RUN_EASY_TYPE)).toBe(true);
    expect(emitted.has('Long')).toBe(true);
  });

  it('the spec type union names three things that are not types', () => {
    // 'vo2' / 'race-pace' / 'shakeout' must never become type strings: the
    // first would 400 on save, the other two would split one session into two
    // spellings. A race-pace long is a Long; a shakeout is a demoted Easy.
    ['vo2', 'race-pace', 'shakeout', 'easy', 'long'].forEach(t =>
      expect(RUN_TYPES).not.toContain(t));
  });

  it('validators reject the shapes that would break a card', () => {
    expect(isRunWorkout({ discipline: 'run', type: 'Easy', durationMin: 30, segments: [] })).toBe(true);
    expect(isRunWorkout({ discipline: 'run', type: 'vo2', durationMin: 30, segments: [] })).toBe(false);
    expect(isRunWorkout({ discipline: 'bike', type: 'Easy', durationMin: 30, segments: [] })).toBe(false);
    expect(isRunWorkout(null)).toBe(false);
    expect(isRunSegment({ label: 'Warm-up', min: 10 })).toBe(true);
    expect(isRunSegment({ label: 'Warm-up', min: 0 })).toBe(false);
    expect(isRunSegment({ label: '', min: 10 })).toBe(false);
    expect(isRunSegment({ label: 'x', min: 10, blocks: [] })).toBe(false);
    // a segment summing wrong is caught, because it lies to the load model
    expect(runWorkoutIssues({
      discipline: 'run', type: 'Easy', title: 'x', durationMin: 60,
      segments: [{ label: 'a', min: 10 }],
    })).toContain('segments sum to 10 min against a stated 60');
  });

  it('isTrainingRun excludes the test and the race, isRunWorkout does not', () => {
    const test = { discipline: 'run', type: 'Test', durationMin: 45, segments: [], title: 't' };
    expect(isRunWorkout(test)).toBe(true);   // it is a real, well-shaped run
    expect(isTrainingRun(test)).toBe(false); // but never graded for adherence
    const race = { discipline: 'run', type: 'Easy', durationMin: 30, segments: [], race: true };
    expect(isTrainingRun(race)).toBe(false);
  });
});

describe('the ladder and the judge read the same table', () => {
  it('RUN_QUALITY_TYPES matches INTENSITY_LADDER.run, minus the easy rung', () => {
    // The failure that recurred four times across the swim and bike arcs is a
    // generation table and a judging table drifting apart. plan.js holds the
    // ladder as a private const, so this reads it from source: a rename there
    // that does not reach runschema.js fails here rather than in production.
    const src = readFileSync(new URL('./plan.js', import.meta.url), 'utf8');
    const m = src.match(/run:\s*\[([^\]]+)\]/);
    expect(m, 'INTENSITY_LADDER.run not found in plan.js').toBeTruthy();
    const ladder = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
    expect(ladder[0]).toBe(RUN_EASY_TYPE);
    expect(ladder.slice(1)).toEqual(RUN_QUALITY_TYPES);
  });

  it('every pace-graded type is a quality type, and Fartlek is not graded', () => {
    RUN_PACE_TYPES.forEach(t => expect(RUN_QUALITY_TYPES).toContain(t));
    // Fartlek is prescribed by feel. Grading it would invent a target the
    // card never printed.
    expect(RUN_PACE_TYPES).not.toContain('Fartlek');
  });
});

describe('hill work is prescribed by effort, never graded by pace', () => {
  it('hill segments carry effort copy and the terrain tag', () => {
    let hills = 0;
    for (const rt of [...SOLO, ...TRI]) {
      for (const fit of ['advanced', 'elite']) {
        planFor(rt, fit, 5).weeks.forEach(w => w.workouts.forEach(x =>
          (x.segments || []).forEach(s => {
            if (!isEffortPrescribed(s)) return;
            hills++;
            expect(s.detail, x.type + ' hill segment quotes a pace').toMatch(/effort/i);
            expect(s.detail).toMatch(/uphill pace reads slower/i);
          })));
      }
    }
    expect(hills).toBeGreaterThan(0); // a sweep that found no hills proves nothing
  });

  it('a hill workout is not pace-graded by the review', () => {
    // paces are nested per discipline, and the row's pace comes from
    // averageSpeed in m/s. 1000 / 4.1667 = 240 s/km, right on the threshold
    // target, so the flat session should judge these reps and like them.
    const paces = { run: { threshold: 240, tempo: 255, interval: 220, easy: 330, long: 340 } };
    const intervals = [
      { type: 'WORK', movingTimeSec: 240, distance: 1000, averageSpeed: 1000 / 240 },
      { type: 'WORK', movingTimeSec: 240, distance: 1000, averageSpeed: 1000 / 240 },
    ];
    const seg = { label: '4 × 4 min', min: 28, zone: 'Z4' };
    const flat = { discipline: 'run', type: 'Threshold', durationMin: 50, segments: [seg] };
    const hill = { discipline: 'run', type: 'Threshold', durationMin: 50, segments: [{ ...seg, label: '4 × 4 min uphill', terrain: 'hill' }] };
    const flatRows = intervalRows({ workout: flat, intervals, paces });
    const hillRows = intervalRows({ workout: hill, intervals, paces });
    // Identical splits, identical paces: the ONLY difference is the terrain
    // tag. The flat session judges every rep; the hill session judges none,
    // rather than calling an honest uphill effort 'off target'.
    expect(flatRows.judged).toBe(2);
    expect(flatRows.rows.every(r => r.tone === 'good')).toBe(true);
    expect(hillRows.judged).toBe(0);
    expect(hillRows.rows.every(r => r.tone === undefined)).toBe(true);
  });

  it('beginners never receive hill sessions', () => {
    for (const rt of SOLO) {
      planFor(rt, 'beginner', 5).weeks.forEach(w => w.workouts.forEach(x =>
        (x.segments || []).forEach(s =>
          expect(isEffortPrescribed(s), rt + ' beginner got a hill segment').toBe(false))));
    }
  });
});

describe('the 5 km anchor: real and estimated stay distinct', () => {
  it('a real time is real, and carries no invented source', () => {
    const a = runAnchor({ ...base, raceType: 'run10k' });
    expect(a.kind).toBe('real');
    expect(a.timeSec).toBe(1500);
    expect(a.source).toBeUndefined();
    expect(hasReal5k({ ...base })).toBe(true);
  });

  it('an absent time estimates, and names which table it came from', () => {
    const tri = runAnchor({ fitness: 'beginner', raceType: 'olympic' });
    expect(tri).toEqual({ kind: 'estimated', timeSec: FITNESS.beginner.est5k, source: 'triathlete-level' });
    const solo = runAnchor({ fitness: 'beginner', raceType: 'run10k' });
    expect(solo).toEqual({ kind: 'estimated', timeSec: FITNESS.beginner.runEst5k, source: 'runner-level' });
    // the two tables genuinely disagree, which is why the source is recorded
    expect(solo.timeSec).not.toBe(tri.timeSec);
    expect(hasReal5k({ fitness: 'beginner', raceType: 'run10k' })).toBe(false);
  });

  it('the anchor cannot disagree with the paces actually printed', () => {
    // computePaces picks runEst5k only on a solo run race. If that rule and
    // this one ever drift, an athlete is shown paces from one table and
    // projections from another.
    for (const rt of [...SOLO, ...TRI, 'maintenance', undefined]) {
      for (const fit of LEVELS) {
        const soloRun = (RACES[rt] || {}).solo === 'run';
        const a = runAnchor({ fitness: fit, raceType: rt });
        expect(a.timeSec, String(rt) + '/' + fit).toBe(soloRun ? FITNESS[fit].runEst5k : FITNESS[fit].est5k);
      }
    }
  });

  it('estimated performance never powers a race projection', () => {
    // the whole reason the anchor exists
    expect(predictRaceTimes({ fitness: 'elite', raceType: 'runmarathon' })).toBe(null);
    expect(predictRaceTimes({ ...base, fivekSec: null })).toBe(null);
    expect(predictRaceTimes(base)).toBeTruthy();
  });

  it('the marathon projection stays a range, never one precise time', () => {
    const p = predictRaceTimes({ ...base, fivekSec: 1500 });
    expect(typeof p.marathon.lo).toBe('number');
    expect(typeof p.marathon.hi).toBe('number');
    expect(p.marathon.hi).toBeGreaterThan(p.marathon.lo * 1.1);
    expect(typeof p.tenK).toBe('number'); // shorter distances do not hedge
  });
});

describe('the regression matrix: every race, level and day count', () => {
  it('run count follows the athlete stated days, at every level and race', () => {
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        for (const d of [3, 4, 5, 6, 7]) {
          const p = planFor(rt, fit, d);
          const rwi = raceWeekIdx(p);
          p.weeks.forEach((w, i) => {
            // Race week is its own shape, and a plan whose race falls before
            // its last Monday carries a post-race recovery week after it.
            // Both are lighter on purpose.
            if (i >= rwi) return;
            expect(runsIn(w).length, rt + '/' + fit + '/' + d + 'd wk' + i).toBe(d);
          });
        }
      }
    }
  });

  it('every standalone run week outside race week has exactly one Long', () => {
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        for (const d of [3, 5, 7]) {
          const p = planFor(rt, fit, d);
          const rwi = raceWeekIdx(p);
          p.weeks.forEach((w, i) => {
            if (i >= rwi) return; // race week, and any post-race recovery week
            expect(runsIn(w).filter(isLong).length, rt + '/' + fit + '/' + d + 'd wk' + i).toBe(1);
          });
        }
      }
    }
  });

  it('Build and Peak weeks give two quality sessions from intermediate up', () => {
    /* The spec states this as "four or more run days include two spaced
       quality sessions". The engine's real guarantee is narrower on two axes,
       both deliberate, and pinning the spec's wording would have failed:

         - PHASE. Base weeks carry ONE quality. The second quality slot sits
           one rung EASIER than the first, and in Base the first rung is
           already Fartlek, so the second lands on Easy. Base builds volume;
           the second quality arrives with Build.
         - LEVEL. A beginner's first rung is Fartlek in Build too, so their
           second slot collapses to Easy in every phase.

       A week carrying the 5 km Test also spends a quality slot on it. */
    for (const rt of SOLO) {
      for (const d of [4, 5, 6, 7]) {
        for (const fit of ['intermediate', 'advanced', 'elite']) {
          const p = planFor(rt, fit, d);
          const rwi = raceWeekIdx(p);
          p.weeks.forEach((w, i) => {
            if (i >= rwi || w.isRecovery) return;
            if (w.phase !== 'Build' && w.phase !== 'Peak') return;
            const runs = runsIn(w);
            if (runs.some(x => x.type === 'Test')) return;
            const q = runs.filter(x => RUN_QUALITY_TYPES.includes(x.type));
            expect(q.length, rt + '/' + fit + '/' + d + 'd wk' + i + ' ' + runs.map(x => x.type).join(',')).toBeGreaterThanOrEqual(2);
          });
        }
      }
    }
    // and the two narrower shapes, pinned as they actually are
    const beginnerBuild = planFor('runhalf', 'beginner', 5).weeks.find(w => w.phase === 'Build' && !w.isRecovery);
    expect(runsIn(beginnerBuild).filter(x => RUN_QUALITY_TYPES.includes(x.type)).length).toBe(1);
    const interBase = planFor('runhalf', 'intermediate', 5).weeks
      .find(w => w.phase === 'Base' && !w.isRecovery && !runsIn(w).some(x => x.type === 'Test'));
    expect(runsIn(interBase).filter(x => RUN_QUALITY_TYPES.includes(x.type)).length).toBe(1);
  });

  it('quality sessions are spaced, never back to back', () => {
    for (const rt of SOLO) {
      for (const fit of ['intermediate', 'advanced', 'elite']) {
        for (const d of [4, 5, 6, 7]) {
          const p = planFor(rt, fit, d);
          const rwi = raceWeekIdx(p);
          p.weeks.forEach((w, i) => {
            if (i === rwi || w.isRecovery) return;
            const days = runsIn(w).filter(x => RUN_QUALITY_TYPES.includes(x.type)).map(dayOf).sort((a, b) => a - b);
            for (let k = 1; k < days.length; k++) {
              expect(days[k] - days[k - 1], rt + '/' + fit + '/' + d + 'd wk' + i + ' quality back to back').toBeGreaterThanOrEqual(2);
            }
          });
        }
      }
    }
  });

  it('no week ever contains two byte-identical run sessions', () => {
    for (const rt of [...SOLO, ...TRI]) {
      for (const fit of LEVELS) {
        for (const d of [3, 5, 7]) {
          const p = planFor(rt, fit, d);
          p.weeks.forEach((w, i) => {
            const sigs = runsIn(w).map(x => JSON.stringify([x.type, x.durationMin, (x.segments || []).map(s => s.label)]));
            expect(new Set(sigs).size, rt + '/' + fit + '/' + d + 'd wk' + i).toBe(sigs.length);
          });
        }
      }
    }
  });

  it('recovery and deep recovery weeks still build valid, lighter runs', () => {
    for (const rt of SOLO) {
      const p = planFor(rt, 'intermediate', 5);
      const rec = p.weeks.filter(w => w.isRecovery);
      expect(rec.length).toBeGreaterThan(0);
      rec.forEach(w => runsIn(w).forEach(x => {
        expect(runWorkoutIssues(x)).toEqual([]);
      }));
      // a recovery week is genuinely lighter than the build week before it
      const i = p.weeks.findIndex(w => w.isRecovery);
      const load = w => runsIn(w).reduce((t, x) => t + x.durationMin, 0);
      if (i > 0) expect(load(p.weeks[i])).toBeLessThan(load(p.weeks[i - 1]));
    }
  });
});

describe('long run floors and caps', () => {
  it('a marathon long run never exceeds three hours', () => {
    for (const fit of LEVELS) {
      for (const d of [3, 5, 7]) {
        planFor('runmarathon', fit, d).weeks.forEach((w, i) =>
          runsIn(w).filter(isLong).forEach(x =>
            expect(x.durationMin, 'marathon/' + fit + '/' + d + 'd wk' + i).toBeLessThanOrEqual(180)));
      }
    }
  });

  it('a taper long run never exceeds 90 minutes', () => {
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        const p = planFor(rt, fit, 5);
        const rwi = raceWeekIdx(p);
        p.weeks.forEach((w, i) => {
          if (w.phase !== 'Taper' || i === rwi) return;
          runsIn(w).filter(isLong).forEach(x =>
            expect(x.durationMin, rt + '/' + fit + ' taper wk' + i).toBeLessThanOrEqual(90));
        });
      }
    }
  });

  it('the marathon long run never shrinks below the beginner base floor', () => {
    // the floor exists so a low-volume marathon plan still trains the event
    const p = planFor('runmarathon', 'beginner', 3);
    const longs = p.weeks.flatMap((w, i) => i === raceWeekIdx(p) ? [] : runsIn(w).filter(isLong));
    expect(longs.length).toBeGreaterThan(0);
    longs.forEach(x => expect(x.durationMin).toBeGreaterThanOrEqual(60));
  });

  it('the long run grows across the plan rather than sitting flat', () => {
    const p = planFor('runmarathon', 'intermediate', 5);
    const rwi = raceWeekIdx(p);
    const longs = p.weeks.map((w, i) => i === rwi ? null : (runsIn(w).find(isLong) || {}).durationMin).filter(Boolean);
    expect(Math.max(...longs)).toBeGreaterThan(Math.min(...longs));
  });
});

describe('solo behaviour is driven by the race, not by profile state', () => {
  it('solo:run comes from RACES, and a stale injury flag cannot empty the plan', () => {
    SOLO.forEach(k => expect(RACES[k].solo).toBe('run'));
    TRI.forEach(k => expect(RACES[k].solo).toBeUndefined());
    // a run race with a stale 'run excluded' flag must still be a run plan
    const p = mk({ raceType: 'runhalf', excludedDiscipline: 'run', fitness: 'intermediate' });
    const w = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
    expect(runsIn(w).length).toBeGreaterThan(0);
  });

  it('a solo run plan contains no swim or bike sessions', () => {
    for (const rt of SOLO) {
      planFor(rt, 'intermediate', 5).weeks.forEach(w => w.workouts.forEach(x => {
        if (x.race || x.discipline === 'rest' || x.discipline === 'strength') return;
        expect(x.discipline, rt + ' has a ' + x.discipline + ' session').toBe('run');
      }));
    }
  });
});

describe('race week stops at the race', () => {
  /* Phase 1b. The taper scaled race week's durations but never its intensity
     ladder, and nothing ended the week at race day: an advanced Olympic plan
     put a bike VO2 session two days before a Saturday race and a 65 minute
     Long ride with sweet-spot blocks on the Sunday after it.

     The sweep runs across five race WEEKDAYS, not one. Race day position
     drives the whole shape, and a Saturday-only fixture never exercises the
     'four days still to go after the race' case that a Wednesday race
     creates. */
  const HARD = /VO2|Threshold|Tempo|Long|Sweet|Race Pace|Fartlek|CSS|Brick/;
  const RACE_DATES = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  const raceWeekSessions = (raceType, fitness, d, raceDate) => {
    const p = mk({ raceType, fitness, raceDate, daysPerWeek: d, trainingDays: DAYSETS[d], longDay: 5 });
    const i = raceWeekIdx(p);
    if (i < 0) return [];
    const rw = p.weeks[i];
    const race = rw.workouts.find(x => x.race);
    return rw.workouts
      .filter(x => !x.race && x.discipline !== 'rest' && x.discipline !== 'strength')
      .map(x => ({ w: x, gap: dayOf(x) - dayOf(race), tag: raceType + '/' + fitness + '/' + d + 'd/' + raceDate }));
  };

  it('nothing hard runs inside the final 48 hours, or at any point after the race', () => {
    let checked = 0;
    for (const raceDate of RACE_DATES) {
      for (const rt of [...SOLO, ...TRI]) {
        for (const fit of LEVELS) {
          for (const d of [3, 5, 7]) {
            raceWeekSessions(rt, fit, d, raceDate).forEach(({ w, gap, tag }) => {
              if (gap === 0 || gap < -2) return;
              checked++;
              expect(HARD.test(w.type), tag + ' gap=' + gap + ' ' + w.discipline + '/' + w.type).toBe(false);
            });
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000); // the sweep really did sweep
  });

  it('a brick never survives either side of race day', () => {
    /* A brick is a race rehearsal by construction: there is no easy form of
       it, so next to the race it becomes the ride alone.

       Swept across every level AND day count, not one config. At advanced /
       5 days alone no brick ever lands in the window, so a narrower sweep
       passed even with the brick handling deleted. */
    let bricksSeen = 0;
    for (const raceDate of RACE_DATES) {
      for (const rt of TRI) {
        for (const fit of LEVELS) {
          for (const d of [3, 4, 5, 6, 7]) {
            raceWeekSessions(rt, fit, d, raceDate).forEach(({ w, gap, tag }) => {
              if (gap === 0 || gap < -2) return;
              expect(w.discipline, tag + ' gap=' + gap).not.toBe('brick');
              if (w.raceWeekFrom === 'Brick') bricksSeen++;
            });
          }
        }
      }
    }
    // and the window really does contain bricks to demote, so the assertion
    // above is exercised rather than vacuous
    expect(bricksSeen).toBeGreaterThan(0);
  });

  it('the day after the goal race is recovery, and demotions are marked', () => {
    for (const raceDate of RACE_DATES) {
      for (const rt of [...SOLO, ...TRI]) {
        raceWeekSessions(rt, 'advanced', 5, raceDate).forEach(({ w, gap, tag }) => {
          if (gap !== 1) return;
          expect(w.durationMin, tag + ' day-after is ' + w.durationMin + ' min').toBeLessThanOrEqual(45);
          // demoted sessions say so, and say what they were, so the card can
          // explain itself rather than looking like a generation bug
          if (w.raceWeek) {
            expect(w.raceWeek).toBe('recover');
            expect(w.raceWeekFrom).toBeTruthy();
            expect(w.key).toBe(false);
          }
        });
      }
    }
  });

  it('demoted sessions keep their id, date and day count', () => {
    // Demotion, not deletion: a logged session must still match, and an
    // athlete who chose five training days still sees five.
    for (const raceDate of ['2026-09-30', '2026-10-03']) {
      // Mon=0 … Sun=6. A race landing on a chosen training day REPLACES that
      // session; one landing on a rest day ADDS to the week. Both are right,
      // and the demotion pass must not change either count.
      const raceDow = (new Date(raceDate).getDay() + 6) % 7;
      const expected = DAYSETS[5].length + (DAYSETS[5].includes(raceDow) ? 0 : 1);
      for (const rt of [...SOLO, ...TRI]) {
        const p = mk({ raceType: rt, fitness: 'advanced', raceDate, daysPerWeek: 5, trainingDays: DAYSETS[5], longDay: 5 });
        const rw = p.weeks[raceWeekIdx(p)];
        const sessions = rw.workouts.filter(x => x.discipline !== 'rest' && !x.second);
        expect(sessions.length, rt + ' ' + raceDate).toBe(expected);
        expect(sessions.filter(x => x.race).length).toBe(1);
        rw.workouts.forEach(x => expect(x.id).toBeTruthy());
      }
    }
  });

  it('sessions three or more days before the race still carry their quality', () => {
    // The fix must not flatten the whole of race week: an athlete racing on
    // Sunday should still get a sharpener on the Wednesday.
    const found = [];
    for (const raceDate of RACE_DATES) {
      for (const rt of [...SOLO, ...TRI]) {
        raceWeekSessions(rt, 'elite', 6, raceDate).forEach(({ w, gap }) => {
          if (gap <= -3 && HARD.test(w.type)) found.push(w.type);
        });
      }
    }
    expect(found.length).toBeGreaterThan(0);
  });
});

describe('the barrel exports the run module', () => {
  it('runschema is reachable from the package entry point', async () => {
    // phase 4 of the bike arc shipped a module the barrel never exported:
    // build passed, tests passed, every card threw.
    const barrel = await import('./index.js');
    ['RUN_TYPES', 'isRunWorkout', 'runWorkoutIssues', 'isEffortPrescribed', 'isTrainingRun']
      .forEach(k => expect(barrel[k], k + ' missing from the barrel').toBeTruthy());
    expect(barrel.runAnchor).toBeTruthy();
  });
});
