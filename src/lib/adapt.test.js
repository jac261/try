import { describe, it, expect } from 'vitest';
import { proposeToday, proposeWeek, proposeRace, projectRaceForm, estimateTss, RAMP_RULES, FORM_RULES, RACE_RULES } from './adapt.js';
import { iso, addDays } from './date.js';

const hard = { id: '0-1', title: 'Threshold Run', type: 'Threshold', discipline: 'run', durationMin: 50 };
const easy = { id: '0-2', title: 'Easy Run', type: 'Easy', discipline: 'run', durationMin: 40 };
const test = { id: '0-3', title: 'Fitness Test · 5k Run', type: 'Test', test: true, discipline: 'run', durationMin: 45 };
const race = { id: '9-0', title: 'RACE DAY', type: 'RACE', race: true, discipline: 'brick', durationMin: 0 };
const easedSession = { id: '0-1', title: 'Easy Run', type: 'Easy', eased: true, easedFrom: 'Threshold', discipline: 'run', durationMin: 35 };

describe('adaptive engine — Phase 1 (readiness-driven days)', () => {
  it('D1: red + hard session → propose the ease swap with volume in the why', () => {
    const p = proposeToday({ band: 'red', score: 48, todays: [easy, hard] });
    expect(p.kind).toBe('ease');
    expect(p.action).toBe('easeToday');
    expect(p.workout.id).toBe('0-1');
    expect(p.why).toMatch(/48/);
    expect(p.why).toMatch(/35 min/); // 50 × 0.65 → round5
  });

  it('D2: amber + hard session → softer framing, athlete holds the tiebreak', () => {
    const p = proposeToday({ band: 'amber', score: 63, todays: [hard] });
    expect(p.kind).toBe('ease');
    expect(p.why).toMatch(/your call/i);
  });

  it('D3: green + a session eased earlier today → propose restoring it', () => {
    const p = proposeToday({ band: 'green', score: 82, todays: [easedSession] });
    expect(p.kind).toBe('restore');
    expect(p.action).toBe('restoreToday');
    expect(p.headline).toMatch(/Threshold/);
  });

  it('D4: red + test day → propose MOVING the test, never softening it (G2), and it outranks the hard session', () => {
    const p = proposeToday({ band: 'red', score: 40, todays: [hard, test] });
    expect(p.kind).toBe('move-test');
    expect(p.workout.id).toBe('0-3');
    expect(p.why).toMatch(/false-low/i);
  });

  it('guardrails: race day immutable (G1), completed sessions untouched (G4)', () => {
    expect(proposeToday({ band: 'red', score: 40, todays: [race] })).toBe(null);
    expect(proposeToday({ band: 'red', score: 40, todays: [{ ...hard, done: true }] })).toBe(null);
  });

  it('no stacking (G3): an already-eased session is not re-proposed on amber/red', () => {
    expect(proposeToday({ band: 'amber', score: 60, todays: [easedSession] })).toBe(null);
    expect(proposeToday({ band: 'red', score: 45, todays: [easedSession] })).toBe(null);
  });

  it('green with nothing eased, or easy-only days → no proposal (G5: quiet by default)', () => {
    expect(proposeToday({ band: 'green', score: 90, todays: [hard] })).toBe(null);
    expect(proposeToday({ band: 'red', score: 40, todays: [easy] })).toBe(null);
    expect(proposeToday({ band: 'amber', score: 60, todays: [] })).toBe(null);
  });
});

/* ---------------- Phase 2 — the ramp guardrail ---------------- */

// 2026-07-09 is a Thursday: mid-week, so this week has past days for R3's
// missed-session count and a following week for R1/R2 to trim.
const TODAY = '2026-07-09';

// Daily wellness records with CTL climbing at `slope` per day for `days` days
// ending TODAY — every 7-day ramp reading is exactly 7 × slope. Optional `tsb`
// (number, or fn(i) for shaped runs) drives the Phase 3 form rules.
const recsAt = (slope, days = 25, endOffset = 0, tsb) => {
  let ctl = 50;
  return Array.from({ length: days }, (_, i) => {
    ctl += slope;
    const rec = { date: iso(addDays(TODAY, i - days + 1 + endOffset)), ctl: Math.round(ctl * 10) / 10 };
    if (tsb !== undefined) rec.tsb = typeof tsb === 'function' ? tsb(i, days) : tsb;
    return rec;
  });
};

// A hand-built two-week plan: week 0 holds TODAY, week 1 is the trim target.
const wk = (index, phase, startISO, types, opts = {}) => ({
  index, phase, isRecovery: !!opts.recovery, start: startISO,
  workouts: types.map((type, i) => ({
    id: index + '-' + i, week: index, phase, date: iso(addDays(startISO, i)),
    discipline: ['run', 'bike', 'swim'][i % 3], type,
    title: type + ' ' + ['Run', 'Ride', 'Swim'][i % 3], durationMin: 40 + i * 10,
  })),
});
const buildPlan = (opts = {}) => ({
  weeks: [
    wk(0, opts.phase0 || 'Build', '2026-07-06', ['Easy', 'Endurance', 'Technique', 'Easy']),
    wk(1, opts.phase1 || 'Build', '2026-07-13', opts.types1 || ['Easy', 'Threshold', 'Technique', 'Long'], { recovery: !!opts.recovery1 }),
  ],
});
const base = { plan: buildPlan(), log: {}, moves: {}, adjust: {}, todayISO: TODAY };

describe('adaptive engine — Phase 2 (ramp guardrail)', () => {
  it('R1: two straight weeks above +5/wk → trim next week to 80%', () => {
    const p = proposeWeek({ ...base, wellness: recsAt(0.9) }); // ramp ≈ +6.3/wk
    expect(p.kind).toBe('trim-week');
    expect(p.factor).toBe(RAMP_RULES.trimAggressive);
    expect(p.week).toBe(1);
    expect(p.targets).toEqual(['1-0', '1-1', '1-2', '1-3']);
    expect(p.ease).toEqual([]);
    expect(p.why).toMatch(/Two straight weeks/);
  });

  it('R2: risky ramp (> +8/wk) → trim to 70% AND ease the biggest quality session, outranking R1', () => {
    const p = proposeWeek({ ...base, wellness: recsAt(1.3) }); // ramp ≈ +9.1/wk
    expect(p.kind).toBe('trim-week');
    expect(p.factor).toBe(RAMP_RULES.trimRisky);
    expect(p.ease).toEqual(['1-1']); // the Threshold ride
    expect(p.targets).not.toContain('1-1');
    expect(p.why).toMatch(/injury and illness/i);
  });

  it('sustainable ramp → quiet', () => {
    expect(proposeWeek({ ...base, wellness: recsAt(0.5) })).toBe(null); // +3.5/wk
  });

  it('recovery and race weeks are never trimmed — the relief is already scheduled', () => {
    const recovery = { ...base, plan: buildPlan({ recovery1: true }), wellness: recsAt(1.3) };
    expect(proposeWeek(recovery)).toBe(null);
    const raceWeek = buildPlan();
    raceWeek.weeks[1].workouts.push({ id: '1-9', race: true, discipline: 'brick', type: 'RACE', title: 'RACE DAY', date: '2026-07-19', durationMin: 0 });
    expect(proposeWeek({ ...base, plan: raceWeek, wellness: recsAt(1.3) })).toBe(null);
  });

  it('no stacking (G3): a week with an adjusted session is not re-proposed', () => {
    const p = proposeWeek({ ...base, adjust: { '1-1': { kind: 'trim', factor: 0.8 } }, wellness: recsAt(1.3) });
    expect(p).toBe(null);
  });

  it('stale fitness data (> 3 days old) never triggers', () => {
    expect(proposeWeek({ ...base, wellness: recsAt(1.3, 25, -5) })).toBe(null);
  });

  it('R3: negative ramp in a Build week with ≥2 missed sessions → catch-up, urgently framed', () => {
    const p = proposeWeek({ ...base, wellness: recsAt(-0.3) }); // week 0 days 07-06..07-08 unlogged
    expect(p.kind).toBe('catch-up');
    expect(p.action).toBe('catchUp');
    expect(p.headline).toMatch(/stalled/);
    expect(p.why).toMatch(/3 sessions missed/);
  });

  it('R3 stays quiet outside Base/Build, or with the sessions logged', () => {
    expect(proposeWeek({ ...base, plan: buildPlan({ phase0: 'Taper' }), wellness: recsAt(-0.3) })).toBe(null);
    const logged = { '0-0': { done: true }, '0-1': { done: true }, '0-2': { done: true } };
    expect(proposeWeek({ ...base, log: logged, wellness: recsAt(-0.3) })).toBe(null);
  });
});

describe('adaptive engine — Phase 3 (form-aware blocks)', () => {
  const cleanWeek = { '0-0': { done: true }, '0-1': { done: true }, '0-2': { done: true } };

  it('F1: form in high risk for 3+ days → convert next week to recovery (60%, quality eased)', () => {
    const p = proposeWeek({ ...base, wellness: recsAt(0.5, 25, 0, i => (i >= 21 ? -33 : -20)) });
    expect(p.kind).toBe('trim-week');
    expect(p.factor).toBe(FORM_RULES.recoveryFactor);
    expect(p.ease).toEqual(['1-1']);          // the quality session goes easy, not just shorter
    expect(p.targets).toEqual(['1-0', '1-2', '1-3']);
    expect(p.headline).toMatch(/recovery week/i);
  });

  it('F1 outranks R2: deep fatigue + risky ramp → the recovery week wins', () => {
    const p = proposeWeek({ ...base, wellness: recsAt(1.3, 25, 0, -33) });
    expect(p.factor).toBe(FORM_RULES.recoveryFactor);
    expect(p.headline).toMatch(/recovery week/i);
  });

  it('F3: transition form mid-build with adjusted sessions → propose restoring them', () => {
    const p = proposeWeek({ ...base, adjust: { '1-1': { kind: 'trim', factor: 0.8 } }, wellness: recsAt(0.5, 25, 0, 28) });
    expect(p.kind).toBe('restore-week');
    expect(p.action).toBe('restoreWeek');
    expect(p.targets).toEqual(['1-1']);
    expect(p.why).toMatch(/leaking/);
  });

  it('F3: transition form with nothing to restore but missed sessions → catch-up, leak framing', () => {
    const p = proposeWeek({ ...base, wellness: recsAt(0.5, 25, 0, 28) }); // week 0's past days unlogged
    expect(p.kind).toBe('catch-up');
    expect(p.headline).toMatch(/leaking/i);
  });

  it('F2: a full grey week in Build with nothing missed → boost next week 10%', () => {
    const p = proposeWeek({ ...base, log: cleanWeek, wellness: recsAt(0.5, 25, 0, -8) });
    expect(p.kind).toBe('boost-week');
    expect(p.action).toBe('boostWeek');
    expect(p.factor).toBe(FORM_RULES.boostFactor);
    expect(p.targets).toEqual(['1-0', '1-1', '1-2', '1-3']);
  });

  it('F2 needs a clean week: grey form with missed sessions is an execution problem, not a planning one', () => {
    expect(proposeWeek({ ...base, wellness: recsAt(0.5, 25, 0, -8) })).toBe(null);
  });

  it('form rules stay quiet without TSB data or in healthy zones', () => {
    expect(proposeWeek({ ...base, log: cleanWeek, wellness: recsAt(0.5) })).toBe(null);          // no tsb
    expect(proposeWeek({ ...base, log: cleanWeek, wellness: recsAt(0.5, 25, 0, -15) })).toBe(null); // optimal
  });
});

/* ---------------- Phase 4 — race-day form targeting ---------------- */

// A taper fixture: sessions on TODAY+1 .. TODAY+6, race on TODAY+raceOffset.
const racePlan = (raceOffset, type = 'Easy', durationMin = 40) => ({
  weeks: [{
    index: 0, phase: 'Taper', isRecovery: false, start: TODAY,
    workouts: Array.from({ length: 6 }, (_, i) => ({
      id: '0-' + i, week: 0, phase: 'Taper', date: iso(addDays(TODAY, i + 1)),
      discipline: ['run', 'bike', 'swim'][i % 3], type,
      title: type + ' ' + ['Run', 'Ride', 'Swim'][i % 3], durationMin,
    })).concat([{ id: '9-0', week: 0, phase: 'Taper', date: iso(addDays(TODAY, raceOffset)), discipline: 'brick', type: 'RACE', title: 'RACE DAY', race: true, durationMin: 0 }]),
  }],
});
// Flat fitness history ending TODAY with a chosen ctl/atl (so form projection
// starts from a known point).
const loadRecs = (ctl, atl, days = 8) => Array.from({ length: days }, (_, i) => ({
  date: iso(addDays(TODAY, i - days + 1)), ctl, atl, tsb: ctl - atl,
}));

describe('adaptive engine — Phase 4 (race-day form targeting)', () => {
  it('estimateTss scales with duration and intensity, and respects adjustments', () => {
    const thr = { type: 'Threshold', durationMin: 60 };
    expect(estimateTss(thr)).toBeCloseTo(90.25, 1);                       // 1h × .95² × 100
    expect(estimateTss(thr, { kind: 'trim', factor: 0.5 })).toBeCloseTo(45.1, 1);
    expect(estimateTss(thr, { kind: 'ease' })).toBeCloseTo(0.65 * 0.65 * 0.65 * 100, 1); // easy type + 65% volume
  });

  it('a recorded moving time beats the planned and adjusted duration, keeping the type', () => {
    const thr = { type: 'Threshold', durationMin: 60 };
    expect(estimateTss(thr, undefined, 40)).toBeCloseTo((40 / 60) * 0.95 * 0.95 * 100, 1);
    // eased session actually done for 30 min: easy intensity, real duration
    expect(estimateTss(thr, { kind: 'ease' }, 30)).toBeCloseTo(0.5 * 0.65 * 0.65 * 100, 1);
  });

  it('projects race-morning TSB through the remaining plan', () => {
    const proj = projectRaceForm({ wellness: loadRecs(55, 45), plan: racePlan(7), log: {}, moves: {}, adjust: {}, todayISO: TODAY });
    expect(proj.daysToRace).toBe(7);
    expect(proj.tsb).toBeGreaterThan(RACE_RULES.freshLo);   // easy taper week sheds fatigue
    expect(proj.tsb).toBeLessThan(RACE_RULES.freshHi);
  });

  it('arriving heavy → trim the sessions closest to the race (volume down, intensity kept)', () => {
    const p = proposeRace({ wellness: loadRecs(60, 85), plan: racePlan(7, 'Threshold', 60), log: {}, moves: {}, adjust: {}, todayISO: TODAY });
    expect(p.kind).toBe('trim-week');
    expect(p.factor).toBe(RACE_RULES.trimFactor);
    expect(p.targets[0]).toBe('0-5');                       // nearest the race first
    expect(p.headline).toMatch(/freshness/i);
    expect(p.why).toMatch(/below the \+5/);
  });

  it('arriving flat → boost the earliest sessions in the taper', () => {
    const p = proposeRace({ wellness: loadRecs(55, 22), plan: racePlan(7, 'Technique', 30), log: {}, moves: {}, adjust: {}, todayISO: TODAY });
    expect(p.kind).toBe('boost-week');
    expect(p.factor).toBe(RACE_RULES.boostFactor);
    expect(p.targets[0]).toBe('0-0');                       // furthest from the race first
    expect(p.headline).toMatch(/Too fresh/);
  });

  it('stays quiet when the projection lands in the window, outside the horizon, or with stale data', () => {
    const ok = { wellness: loadRecs(55, 45), plan: racePlan(7), log: {}, moves: {}, adjust: {}, todayISO: TODAY };
    expect(proposeRace(ok)).toBe(null);                                        // in the window
    const far = { ...ok, wellness: loadRecs(60, 85), plan: racePlan(30, 'Threshold', 60) };
    expect(proposeRace(far)).toBe(null);                                       // > horizonDays out
    const stale = { ...ok, wellness: loadRecs(60, 85, 8).map(r => ({ ...r, date: iso(addDays(r.date, -5)) })) };
    expect(proposeRace({ ...stale, plan: racePlan(7, 'Threshold', 60) })).toBe(null); // stale sensors
  });
});

describe('maintenance plans and the race engine', () => {
  it('proposeRace never fires for a maintenance horizon', () => {
    expect(proposeRace({ wellness: [], plan: { race: 'maintenance' }, log: {}, moves: {}, adjust: {}, todayISO: '2026-07-08' })).toBe(null);
  });
});
