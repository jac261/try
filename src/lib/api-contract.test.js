import { describe, it, expect } from 'vitest';
import { planToApi } from './api.js';
import { generatePlan } from './plan.js';
import { buildWatchEvents } from './watch.js';
import { iso, addDays } from './date.js';

/* The wire contract: what the backend's typed DTOs will actually accept.
 *
 * The frontend cannot import the C# truth, so the constants below are COPIED
 * from the backend and these tests are the tripwire. Source of truth:
 * try-backend src/TryBackend.Api/Data/PlanCatalog.cs (closed sets) and
 * src/TryBackend.Api/Models/Plans/IncomingPlanWeek.cs +
 * IncomingPlanProfile.cs + Integrations/IntervalsIcuIntegrationModels.cs
 * (int? bindings). If Jack widens the contract, update here, in one place.
 *
 * Why this file exists: System.Text.Json throws deserializing a fractional
 * number into int?, the whole weeks array comes back empty, and the save
 * 400s with "weeks contain invalid field types" — which is exactly what
 * happened to every plan create for three weeks, because fitFlex
 * (deliberately) writes fractional segment minutes and nothing stood between
 * the generator and the wire. A save that fails in production is this test
 * failing in CI instead.
 */

const PHASES = new Set(['Base', 'Build', 'Peak', 'Taper', 'Maintain']);
const DISCIPLINES = new Set(['swim', 'bike', 'run', 'brick', 'strength', 'rest']);
const ROLES = new Set(['easy', 'quality', 'long', 'brick', 'strength', 'custom']);
const TYPES = new Set(['Easy', 'Fartlek', 'Tempo', 'Threshold', 'VO2 Intervals', 'Long', 'Endurance',
  'Sweet Spot', 'Technique', 'CSS Intervals', 'Race Pace', 'Open Water', 'Brick', 'Strength', 'Rest', 'RACE', 'Test']);

const today = new Date();
const profile = (over = {}) => ({
  name: 'T', fitness: 'intermediate', trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  startDate: iso(today), raceDate: iso(addDays(today, 84)), ...over,
});

// The matrix the diagnosis measured: every race type, every fitness level.
const MATRIX = [];
['sprint', 'olympic', 'half', 't100', 'full', 'run5k', 'run10k', 'runhalf', 'runmarathon'].forEach(rt =>
  ['beginner', 'intermediate', 'advanced', 'elite'].forEach(fit =>
    MATRIX.push(generatePlan(profile({ raceType: rt, fitness: fit })))));
MATRIX.push(generatePlan(profile({
  raceType: 'maintenance', horizonWeeks: 12, raceDate: iso(addDays(today, 12 * 7 - 1)),
})));

const intOrAbsent = (v, what, bad) => {
  if (v == null) return;
  if (typeof v !== 'number' || !Number.isInteger(v)) bad.push(what + ' = ' + JSON.stringify(v));
};

describe('the plan wire body fits the backend contract', () => {
  it('every int?-bound field is an integer, after planToApi', () => {
    const bad = [];
    MATRIX.forEach(p => {
      const w = planToApi(p);
      const tag = p.race + '/' + p.profile.fitness;
      intOrAbsent(w.totalWeeks, tag + ' totalWeeks', bad);
      ['fivekSec', 'css100Sec', 'ftp', 'daysPerWeek', 'longDay'].forEach(k =>
        intOrAbsent(w.profile[k], tag + ' profile.' + k, bad));
      (w.profile.trainingDays || []).forEach(d => intOrAbsent(d, tag + ' profile.trainingDays[]', bad));
      w.weeks.forEach(wk => {
        intOrAbsent(wk.index, tag + ' weeks[].index', bad);
        intOrAbsent(wk.totalMin, tag + ' weeks[].totalMin', bad);
        wk.workouts.forEach(wo => {
          intOrAbsent(wo.week, tag + ' workouts[].week', bad);
          intOrAbsent(wo.durationMin, tag + ' workouts[].durationMin', bad);
          (wo.segments || []).forEach(s => s && intOrAbsent(s.min, tag + ' segments[].min', bad));
        });
      });
    });
    expect(bad).toEqual([]);
  });

  it('the raw generator DOES emit fractional segment minutes — the reason the seam exists', () => {
    // The day this starts failing, fitFlex has stopped writing fractions and
    // planToApi's rounding can be retired along with this file's reason.
    const fractional = MATRIX.flatMap(p => p.weeks).flatMap(w => w.workouts)
      .flatMap(wo => wo.segments || [])
      .filter(s => s && typeof s.min === 'number' && !Number.isInteger(s.min));
    expect(fractional.length).toBeGreaterThan(0);
  });

  it('every closed-set field is in the backend catalog', () => {
    const bad = [];
    MATRIX.forEach(p => p.weeks.forEach(wk => {
      if (!PHASES.has(wk.phase)) bad.push('phase ' + JSON.stringify(wk.phase));
      wk.workouts.forEach(wo => {
        if (!DISCIPLINES.has(wo.discipline)) bad.push('discipline ' + JSON.stringify(wo.discipline));
        if (wo.role !== undefined && !ROLES.has(wo.role)) bad.push('role ' + JSON.stringify(wo.role));
        if (!TYPES.has(wo.type)) bad.push('type ' + JSON.stringify(wo.type));
      });
    }));
    expect([...new Set(bad)]).toEqual([]);
  });

  it('planToApi rounds only fractional segment minutes, and never its input', () => {
    const p = MATRIX[0];
    const before = JSON.stringify(p);
    const w = planToApi(p);
    expect(JSON.stringify(p)).toBe(before);            // non-mutating

    // everything except segments[].min is untouched, byte for byte
    const strip = plan => JSON.stringify(plan, (k, v) =>
      k === 'segments' ? undefined : v);
    expect(strip(w)).toBe(strip(p));

    // and within segments, only fractional mins moved
    p.weeks.forEach((wk, wi) => wk.workouts.forEach((wo, oi) => (wo.segments || []).forEach((s, si) => {
      const out = w.weeks[wi].workouts[oi].segments[si];
      if (s && typeof s.min === 'number' && !Number.isInteger(s.min)) {
        expect(out.min).toBe(Math.round(s.min));
        expect(Number.isInteger(out.min)).toBe(true);
      } else {
        expect(out).toBe(s);                           // same reference: untouched
      }
    })));
  });

  it('a plan with no fractional minutes passes through as deep-equal', () => {
    const clean = planToApi(MATRIX[0]);                // already rounded
    expect(planToApi(clean)).toEqual(clean);
  });

  it('watch events carry integer movingTimeSec (PlannedEventRequest binds int?)', () => {
    const p = MATRIX.find(x => x.race === 'olympic');
    const body = buildWatchEvents({ plan: p, moves: {}, easedOf: w => w, log: {}, todayISO: iso(today) });
    expect(body.events.length).toBeGreaterThan(0);
    body.events.forEach(e => {
      if (e.movingTimeSec != null) expect(Number.isInteger(e.movingTimeSec)).toBe(true);
    });
  });
});
