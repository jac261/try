import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { RACES } from './domain.js';
import { RUN_QUALITY_TYPES } from './runschema.js';
import { SOLO_SPACING, soloWeekSpacingIssues, soloPlanIssues } from './run-plans.js';

/* Run phase 4 — the standalone run plan's architecture.
 *
 * Almost everything this phase lists under "preserve" was already true and is
 * already pinned by phase 1. What was missing is the thing §3 actually asks
 * for: the spacing rules were EXPLICIT nowhere. They held as emergent
 * behaviour of assignSoloMids, so a change to day assignment could have
 * broken them silently. They are now stated and checked.
 */

const base = {
  name: 'R', fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const DAYSETS = { 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
const planFor = (raceType, fitness, days, longDay = 5) => generatePlan({
  ...base, raceType, fitness, daysPerWeek: days, trainingDays: DAYSETS[days], longDay,
});
const runsIn = w => w.workouts.filter(x => x.discipline === 'run' && !x.race);
const raceWeekIdx = p => p.weeks.findIndex(w => w.workouts.some(x => x.race));

describe('the structural contract holds across the whole matrix', () => {
  it('every solo plan honours run count, one long, uniqueness and spacing', () => {
    /* The §2 and §7 checklist, executable. Swept over three LONG-DAY choices
       as well as the usual axes: the long run is what the spacing rule
       protects, so a sweep that never moves it is not testing the rule. */
    let checked = 0;
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        for (const d of [3, 4, 5, 6, 7]) {
          for (const longDay of [5, 6, 3]) {
            if (!DAYSETS[d].includes(longDay)) continue;
            checked++;
            const p = planFor(rt, fit, d, longDay);
            expect(soloPlanIssues(p, d), rt + '/' + fit + '/' + d + 'd/long' + longDay).toEqual([]);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('seven training days produce seven distinct runs', () => {
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        const p = planFor(rt, fit, 7);
        const w = p.weeks.find((x, i) => i < raceWeekIdx(p) && !x.isRecovery && x.phase === 'Build');
        const runs = runsIn(w);
        expect(runs.length, rt + '/' + fit).toBe(7);
        const sigs = new Set(runs.map(x => JSON.stringify([x.type, x.durationMin, (x.segments || []).map(s => s.label)])));
        expect(sigs.size).toBe(7);
      }
    }
  });
});

describe('the spacing checker states the rule rather than restating the engine', () => {
  it('catches adjacent quality and quality next to the long run', () => {
    // Built by hand so the checker is tested against a KNOWN-bad week rather
    // than against generated output, which is the thing it is meant to judge.
    const bad = {
      workouts: [
        { discipline: 'run', type: 'Threshold', date: '2026-07-06' },
        { discipline: 'run', type: 'Tempo', date: '2026-07-07' },      // adjacent quality
        { discipline: 'run', type: 'Long', date: '2026-07-11' },
        { discipline: 'run', type: 'VO2 Intervals', date: '2026-07-10' }, // day before the long
      ],
    };
    const issues = soloWeekSpacingIssues(bad);
    expect(issues.length).toBe(2);
    expect(issues.join(' ')).toMatch(/1 day apart/);
    expect(issues.join(' ')).toMatch(/1 day from the long run/);
  });

  it('passes a well spaced week, and the race itself never counts', () => {
    // Tue/Thu quality, Sat long: two days apart each way
    expect(soloWeekSpacingIssues({
      workouts: [
        { discipline: 'run', type: 'Threshold', date: '2026-07-07' },
        { discipline: 'run', type: 'Tempo', date: '2026-07-09' },
        { discipline: 'run', type: 'Long', date: '2026-07-11' },
      ],
    })).toEqual([]);
    // a race on an adjacent day is not a training session and is ignored
    expect(soloWeekSpacingIssues({
      workouts: [
        { discipline: 'run', type: 'Threshold', date: '2026-07-07' },
        { discipline: 'run', type: 'RACE', date: '2026-07-08', race: true },
      ],
    })).toEqual([]);
    // an easy run adjacent to anything is fine: only quality is spaced
    expect(soloWeekSpacingIssues({
      workouts: [
        { discipline: 'run', type: 'Threshold', date: '2026-07-07' },
        { discipline: 'run', type: 'Easy', date: '2026-07-08' },
        { discipline: 'run', type: 'Long', date: '2026-07-11' },
      ],
    })).toEqual([]);
  });

  it('the stated gaps are the ones the engine actually keeps', () => {
    expect(SOLO_SPACING.minQualityGapDays).toBe(2);
    expect(SOLO_SPACING.minLongGapDays).toBe(2);
  });
});

describe('behaviour comes from the race, never from profile state', () => {
  it('solo is a race property and all four run races carry it', () => {
    SOLO.forEach(k => expect(RACES[k].solo).toBe('run'));
    ['sprint', 'olympic', 'half', 't100', 'full'].forEach(k => expect(RACES[k].solo).toBeUndefined());
  });

  it('a stale excluded-discipline flag cannot empty or corrupt a run plan', () => {
    // §7 "profile state cannot go stale": the flag is left over from a
    // triathlon plan, and solo is checked before excluded so it cannot
    // resolve a run race to a template with no runs in it.
    for (const rt of SOLO) {
      const p = generatePlan({ ...base, raceType: rt, fitness: 'intermediate', excludedDiscipline: 'run', daysPerWeek: 5, trainingDays: DAYSETS[5], longDay: 5 });
      expect(soloPlanIssues(p, 5), rt + ' with a stale run exclusion').toEqual([]);
    }
  });

  it('race day is one run leg, with the marathon fuelling cue', () => {
    for (const rt of SOLO) {
      const p = planFor(rt, 'intermediate', 5);
      const race = p.weeks[raceWeekIdx(p)].workouts.find(x => x.race);
      expect(race.discipline).toBe('run');
      expect(race.segments.some(s => /Swim|Bike/.test(s.label))).toBe(false);
      expect(race.segments.some(s => new RegExp('Run ' + RACES[rt].run + ' km').test(s.label))).toBe(true);
    }
    const mar = planFor('runmarathon', 'intermediate', 5);
    const marRace = mar.weeks[raceWeekIdx(mar)].workouts.find(x => x.race);
    expect(marRace.segments.some(s => /fuel/i.test(s.detail || ''))).toBe(true);
  });
});

describe('distance-specific long run behaviour', () => {
  it('race-pace long runs exist only for the half and marathon, in Build and Peak', () => {
    const RP = /marathon effort|half marathon effort/i;
    const seen = { byRace: {}, byPhase: {} };
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        for (const d of [5, 7]) {
          const p = planFor(rt, fit, d);
          p.weeks.forEach(w => runsIn(w).forEach(x => {
            if (!(x.segments || []).some(s => RP.test(s.label || ''))) return;
            seen.byRace[rt] = (seen.byRace[rt] || 0) + 1;
            seen.byPhase[w.phase] = (seen.byPhase[w.phase] || 0) + 1;
            // race pace belongs to the long run, never to a midweek session
            expect(x.type, rt + '/' + fit + ' race pace on a ' + x.type).toBe('Long');
          }));
        }
      }
    }
    expect(Object.keys(seen.byRace).sort()).toEqual(['runhalf', 'runmarathon']);
    expect(Object.keys(seen.byPhase).sort()).toEqual(['Build', 'Peak']);
  });

  it('the long run share of the week grows with race distance', () => {
    const share = rt => {
      const p = planFor(rt, 'intermediate', 5);
      const rwi = raceWeekIdx(p);
      let long = 0, all = 0;
      p.weeks.forEach((w, i) => {
        if (i >= rwi) return;
        runsIn(w).forEach(x => { all += x.durationMin; if (x.type === 'Long') long += x.durationMin; });
      });
      return long / all;
    };
    const shares = SOLO.map(share);
    // 5k -> marathon, monotonically non-decreasing: the marathon's
    // specificity comes from the long run, which is why it takes no
    // quality-rung bias
    expect(shares).toEqual([...shares].sort((a, b) => a - b));
    expect(shares[3]).toBeGreaterThan(shares[0]);
  });

  it('the quality rung bias is a race property, and lifts only the short races', () => {
    // 5k and 10k climb one rung; the half and marathon do not, taking their
    // specificity from the long run instead. Read from generated output
    // rather than from the table, so the table cannot agree with itself.
    const topRung = rt => {
      const p = planFor(rt, 'intermediate', 5);
      const types = new Set();
      p.weeks.forEach(w => runsIn(w).forEach(x => { if (RUN_QUALITY_TYPES.includes(x.type)) types.add(x.type); }));
      return RUN_QUALITY_TYPES.filter(t => types.has(t)).pop();
    };
    expect(topRung('run5k')).toBe('VO2 Intervals');
    expect(topRung('run10k')).toBe('VO2 Intervals');
    expect(topRung('runhalf')).toBe('Threshold');
    expect(topRung('runmarathon')).toBe('Threshold');
  });
});

describe('the barrel exports the plan contract', () => {
  it('run-plans is reachable from the package entry point', async () => {
    const barrel = await import('./index.js');
    ['SOLO_SPACING', 'soloWeekSpacingIssues', 'soloPlanIssues']
      .forEach(k => expect(barrel[k], k + ' missing from the barrel').toBeTruthy());
  });
});
