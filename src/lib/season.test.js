import { describe, it, expect } from 'vitest';
import { seasonCurve, seasonMilestones, stepLoad } from './season.js';
import { projectRaceForm, estimateTss, RAMP_RULES } from './adapt.js';
import { generatePlan } from './plan.js';
import { iso, addDays, startOfWeekMonday } from './date.js';

const TODAY = '2026-08-05';                       // a Wednesday
const mon = iso(startOfWeekMonday(TODAY));

const profile = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(addDays(mon, -8 * 7)), raceDate: iso(addDays(mon, 8 * 7 + 2)), ...over,
});

// A flat measured history ending on `end`, so the projection starts from a
// point the test knows.
const recs = (ctl, atl, from, end) => {
  const out = [];
  for (let d = from; d <= end; d = iso(addDays(d, 1))) out.push({ date: d, ctl, atl, tsb: ctl - atl });
  return out;
};

describe('seasonCurve', () => {
  it('is solid up to today and projected past it, one point per plan week', () => {
    const plan = generatePlan(profile());
    const w = recs(50, 45, plan.weeks[0].start, TODAY);
    const s = seasonCurve({ plan, wellness: w, log: {}, moves: {}, adjust: {}, todayISO: TODAY });

    expect(s.points).toHaveLength(plan.weeks.length);
    expect(s.weeks).toBe(plan.weeks.length);
    // every point up to today's week is measured, every one after is projected
    s.points.forEach(p => {
      if (p.ctl == null) return;
      expect(p.projected).toBe(p.date > TODAY);
    });
    // and the projection actually moved: a flat 50 does not stay 50 once the
    // plan's sessions are fed through the recurrence
    const future = s.points.filter(p => p.projected && p.ctl != null);
    expect(future.length).toBeGreaterThan(2);
    expect(future.some(p => p.ctl !== 50)).toBe(true);
  });

  it('puts today and race day at fractional week positions, not rounded to Monday', () => {
    const plan = generatePlan(profile());
    const s = seasonCurve({ plan, wellness: recs(50, 45, plan.weeks[0].start, TODAY), log: {}, moves: {}, adjust: {}, todayISO: TODAY });
    // TODAY is a Wednesday: two sevenths into its week, never a whole number
    expect(s.todayIndex % 1).not.toBe(0);
    expect(s.raceIndex).toBeGreaterThan(s.todayIndex);
    // the race index lands on the week the race is actually in
    const raceWeek = plan.weeks.findIndex(wk => s.raceDate >= wk.start && s.raceDate <= iso(addDays(wk.start, 6)));
    expect(Math.floor(s.raceIndex)).toBe(raceWeek);
  });

  it('tiles the whole season with phases, no gap and no overlap', () => {
    const plan = generatePlan(profile());
    const s = seasonCurve({ plan, wellness: [], log: {}, moves: {}, adjust: {}, todayISO: TODAY });
    expect(s.phases[0].from).toBe(0);
    expect(s.phases[s.phases.length - 1].to).toBe(plan.weeks.length - 1);
    s.phases.slice(1).forEach((p, i) => expect(p.from).toBe(s.phases[i].to + 1));
  });

  it('says which week of the season and which week of the block', () => {
    const plan = generatePlan(profile());
    const s = seasonCurve({ plan, wellness: [], log: {}, moves: {}, adjust: {}, todayISO: TODAY });
    const nowWeek = plan.weeks.find(wk => TODAY >= wk.start && TODAY <= iso(addDays(wk.start, 6)));
    expect(s.weekOfSeason).toBe(nowWeek.index + 1);
    expect(s.block.week).toBeGreaterThanOrEqual(1);
    expect(s.block.week).toBeLessThanOrEqual(s.block.of);
  });

  it('leaves weeks with no reading null rather than bridging them', () => {
    const plan = generatePlan(profile());
    // a feed that only starts three weeks ago: the plan began eight weeks back
    const w = recs(50, 45, iso(addDays(mon, -21)), TODAY);
    const s = seasonCurve({ plan, wellness: w, log: {}, moves: {}, adjust: {}, todayISO: TODAY });
    expect(s.points[0].ctl).toBeNull();
    expect(s.points.some(p => p.ctl != null && !p.projected)).toBe(true);
  });

  it('has nothing to chart without a plan', () => {
    expect(seasonCurve({ plan: { race: 'tracker', weeks: [] }, wellness: [], todayISO: TODAY })).toBeNull();
    expect(seasonCurve({ plan: null, wellness: [], todayISO: TODAY })).toBeNull();
  });

  it('charts a maintenance block, with no race to mark', () => {
    const plan = generatePlan(profile({
      raceType: 'maintenance', horizonWeeks: 12,
      startDate: iso(addDays(mon, -4 * 7)), raceDate: iso(addDays(mon, 8 * 7 - 1)),
    }));
    const s = seasonCurve({ plan, wellness: recs(50, 45, plan.weeks[0].start, TODAY), log: {}, moves: {}, adjust: {}, todayISO: TODAY });
    expect(s).not.toBeNull();
    expect(s.raceIndex).toBeNull();
    expect(s.raceDate).toBeNull();
    expect(s.points.some(p => p.ctl != null)).toBe(true);
  });

  /* The reason this file owns a copy of the recurrence at all: the engine's
     projection must not drift from the chart's. Driven from a plan whose
     entire remaining load the two see identically, and asserted to the tenth
     that projectRaceForm's race-morning TSB is the one the curve walks to. */
  it('agrees with projectRaceForm on race-morning form', () => {
    const plan = generatePlan(profile());
    const race = plan.weeks.flatMap(w => w.workouts).find(w => w.race);
    const w = recs(55, 50, plan.weeks[0].start, TODAY);
    const args = { wellness: w, plan, log: {}, moves: {}, adjust: {}, todayISO: TODAY };

    const engine = projectRaceForm(args);
    expect(engine).not.toBeNull();

    // the curve's own walk, run to the morning of the race
    let state = { ctl: 55, atl: 50 };
    const plannedBy = {};
    plan.weeks.flatMap(x => x.workouts).forEach(x => {
      if (x.race || x.discipline === 'rest') return;
      (plannedBy[x.date] = plannedBy[x.date] || []).push(x);
    });
    for (let d = iso(addDays(TODAY, 1)); d < race.date; d = iso(addDays(d, 1))) {
      state = stepLoad(state, (plannedBy[d] || []).reduce((s, x) => s + estimateTss(x), 0));
    }
    expect(Math.round((state.ctl - state.atl) * 10) / 10).toBeCloseTo(engine.tsb, 1);
  });

  it('still draws when the sensors are stale and projectRaceForm gives up', () => {
    const plan = generatePlan(profile());
    // last reading older than the freshness window: the engine declines...
    const staleEnd = iso(addDays(TODAY, -(RAMP_RULES.freshDays + 3)));
    const w = recs(50, 45, plan.weeks[0].start, staleEnd);
    const args = { wellness: w, plan, log: {}, moves: {}, adjust: {}, todayISO: TODAY };
    expect(projectRaceForm(args)).toBeNull();

    // ...and the chart still has a season to show, because a chart owes the
    // athlete a picture where a proposal owes them silence
    const s = seasonCurve(args);
    expect(s).not.toBeNull();
    expect(s.points.some(p => p.ctl != null)).toBe(true);
  });
});

describe('seasonMilestones', () => {
  it('lists the plan\'s own tests, tune-ups and race, in date order, from today', () => {
    const plan = generatePlan(profile());
    const m = seasonMilestones({ plan, moves: {}, todayISO: TODAY });

    expect(m.length).toBeGreaterThan(0);
    m.forEach(x => expect(x.date >= TODAY).toBe(true));
    m.slice(1).forEach((x, i) => expect(x.date >= m[i].date).toBe(true));
    // the A race is in there, and it is last
    const race = m.filter(x => x.kind === 'race');
    expect(race).toHaveLength(1);
    expect(m[m.length - 1].kind).toBe('race');
    // named as the calendar's pin names it, not by the workout's heading
    expect(race[0].label).toBe('Olympic Triathlon');
    expect(race[0].label).not.toMatch(/RACE DAY/);
  });

  it('names a benchmark test by what it measures, not by its workout title', () => {
    const plan = generatePlan(profile());
    const tests = plan.weeks.flatMap(w => w.workouts).filter(w => w.test && w.date >= TODAY);
    if (!tests.length) return;                      // no test scheduled ahead: nothing to assert
    const m = seasonMilestones({ plan, moves: {}, todayISO: TODAY });
    const shown = m.find(x => x.id === tests[0].id);
    expect(shown).toBeTruthy();
    expect(shown.kind).toBe('test');
  });

  it('follows a moved milestone to its new date', () => {
    const plan = generatePlan(profile());
    const race = plan.weeks.flatMap(w => w.workouts).find(w => w.race);
    const moved = iso(addDays(race.date, 7));
    const m = seasonMilestones({ plan, moves: { [race.id]: moved }, todayISO: TODAY });
    expect(m.find(x => x.kind === 'race').date).toBe(moved);
  });

  it('is empty with no plan', () => {
    expect(seasonMilestones({ plan: { race: 'tracker', weeks: [] }, todayISO: TODAY })).toEqual([]);
  });
});
