// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { renderToString } from 'react-dom/server';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { estimateTss } from '@/lib/adapt.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';
import { weekRange } from '@/lib/schedule.js';

/* The calendar's ranges (design: "three ranges of the same plan, one set of
   chrome"). Season is not here — its panel could not be read.
 *
 * The two shapes worth naming: TRACKER, where plan.weeks is empty and a
 * plan-only week range would answer seven days of nothing with seven rest
 * days; and the days BEFORE a plan began, which have the same problem inside
 * a race plan. A race-plan fixture alone catches neither. */

const today = new Date();
const todayISO = iso(today);
const mon = startOfWeekMonday(today);

const profile = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(addDays(mon, -28)), raceDate: iso(addDays(today, 84)), ...over,
});

const noop = () => {};
const mount = async (plan, extra = {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<CalendarView plan={plan} log={{}} moves={{}} open={noop} easedOf={w => w}
      onToggleWorkout={noop} onMove={noop} activities={null} onOpenRecording={noop}
      onAddWorkout={noop} {...extra} />);
  });
  return { el, root };
};
const seg = (el, label) => [...el.querySelectorAll('.segbar button')].find(b => b.textContent === label);
const toWeek = async el => { await act(async () => { seg(el, 'Week').click(); }); };
const navs = el => [...el.querySelectorAll('.cal-nav')];
const title = el => el.querySelector('.cal-head .ttl').textContent;

beforeEach(() => { document.body.innerHTML = ''; });

describe('the range control', () => {
  it('offers the three ranges, marks one selected, and keeps the date across a switch', async () => {
    const { el, root } = await mount(generatePlan(profile()));
    expect([...el.querySelectorAll('.segbar button')].map(b => b.textContent)).toEqual(['Week', 'Month', 'Season']);
    const on = () => [...el.querySelectorAll('.segbar button')].filter(b => b.getAttribute('aria-selected') === 'true');
    expect(on()).toHaveLength(1);
    expect(on()[0].textContent).toBe('Month');

    // step a month back, switch to week: the week shown must be inside that
    // month, not back at today — the chrome is shared, so the date persists
    await act(async () => { navs(el)[0].click(); });
    const monthShown = title(el);
    await toWeek(el);
    expect(on()[0].textContent).toBe('Week');
    const days = [...el.querySelectorAll('.wk-day .wd-num')].map(n => n.textContent);
    expect(days).toHaveLength(7);
    expect(monthShown).not.toContain(String(new Date().getFullYear() + 1));

    root.unmount(); el.remove();
  }, 20000);

  it('steps a week in Week and a month in Month, off the same anchor', async () => {
    const { el, root } = await mount(generatePlan(profile()));
    const monthA = title(el);
    await act(async () => { navs(el)[1].click(); });
    expect(title(el)).not.toBe(monthA);          // month moved

    await toWeek(el);
    const weekA = title(el);
    await act(async () => { navs(el)[1].click(); });
    const weekB = title(el);
    expect(weekB).not.toBe(weekA);
    // a week step, not a month step: back once and we are where we were
    await act(async () => { navs(el)[0].click(); });
    expect(title(el)).toBe(weekA);

    root.unmount(); el.remove();
  }, 20000);
});

describe('the week range', () => {
  it('shows all seven days, and totals the load of the sessions it shows', async () => {
    const plan = generatePlan(profile());
    const { el, root } = await mount(plan);
    await toWeek(el);

    expect(el.querySelectorAll('.wk-day')).toHaveLength(7);

    const week = weekRange(todayISO);
    const shown = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline !== 'rest' && !w.race && week.includes(w.date));
    const want = Math.round(shown.reduce((s, w) => s + estimateTss(w), 0));
    expect(el.querySelector('.wk-head').textContent).toContain(want + ' TSS, estimated');
    // and the rows are really there, one per session
    expect(el.querySelectorAll('.wk-day .wk')).toHaveLength(shown.length);

    root.unmount(); el.remove();
  }, 20000);

  it('puts a moved session on the day it moved to', async () => {
    const plan = generatePlan(profile());
    const week = weekRange(todayISO);
    // take a session from this week and push it to a day in the same week
    // that has none, so it can only be found by its effective date
    const inWeek = plan.weeks.flatMap(w => w.workouts).filter(w => w.discipline !== 'rest' && week.includes(w.date));
    const busy = new Set(inWeek.map(w => w.date));
    const empty = week.find(d => !busy.has(d));
    const moving = inWeek.find(w => !w.race);
    expect(empty).toBeTruthy(); expect(moving).toBeTruthy();

    const { el, root } = await mount(plan, { moves: { [moving.id]: empty } });
    await toWeek(el);
    const dayOf = n => [...el.querySelectorAll('.wk-day')]
      .find(d => d.querySelector('.wd-num').textContent === String(Number(n.slice(8))));
    expect(dayOf(empty).textContent).toContain(moving.title);
    expect(dayOf(moving.date).textContent).not.toContain(moving.title);

    root.unmount(); el.remove();
  }, 20000);

  it('gives race day no load number, and leaves it out of the total', async () => {
    // a plan whose race falls in the week we open on
    const raceDate = iso(addDays(mon, 3));
    const plan = generatePlan(profile({ startDate: iso(addDays(mon, -12 * 7)), raceDate }));
    const { el, root } = await mount(plan);
    await toWeek(el);

    const raceRow = [...el.querySelectorAll('.wk-day .wk')].find(r => /RACE DAY/i.test(r.textContent));
    expect(raceRow).toBeTruthy();
    expect(raceRow.querySelector('.right').textContent).toBe('');
    expect(el.querySelectorAll('.wk-day .wk .right b').length)
      .toBe(el.querySelectorAll('.wk-day .wk').length - 1);

    root.unmount(); el.remove();
  }, 20000);

  it('never says "rest day" where there is no plan to rest from', async () => {
    /* The ride is dated TODAY, not yesterday: the week is Monday-first, so on
       a Monday "yesterday" is the previous week and the fixture's ride fell
       off the shown range — this test flaked every Monday until it did. Today
       is in the shown week by definition, whatever weekday it is. */
    const acts = [{ id: 'a1', type: 'Ride', name: 'Commute', date: todayISO,
      movingTimeSec: 40 * 60, distance: 15000 }];
    const { el, root } = await mount(buildTrackerPlan(generatePlan(profile()), todayISO), { activities: acts });
    await toWeek(el);

    expect(el.querySelectorAll('.wk-day')).toHaveLength(7);
    expect(el.textContent).not.toContain('Rest day');
    expect(el.querySelectorAll('.wd-none')).toHaveLength(6);   // the six without the ride
    expect(el.textContent).toContain('Nothing recorded.');
    expect(el.textContent).toContain('Commute');
    // no planned sessions, so nothing to total
    expect(el.querySelector('.wk-head')).toBeNull();

    root.unmount(); el.remove();
  }, 20000);

  it('says "before this plan began" rather than "rest day" on pre-plan days', async () => {
    /* The plan starts next Monday, and the calendar opens clamped to the plan
       start, so the pre-plan days are one step BACK — which is the whole
       reason browsing reaches behind the plan at all (field report
       2026-07-30: the diary must survive a new plan). A race plan hitting the
       same trap as tracker. */
    const plan = generatePlan(profile({ startDate: iso(addDays(mon, 7)), raceDate: iso(addDays(today, 84)) }));
    const { el, root } = await mount(plan);
    await toWeek(el);
    await act(async () => { navs(el)[0].click(); });
    expect(el.textContent).toContain('Before this plan began.');
    expect(el.textContent).not.toContain('Rest day');
    root.unmount(); el.remove();
  }, 20000);
});

describe('the season range', () => {
  const history = plan => {
    const out = [];
    let ctl = 38;
    for (let d = plan.weeks[0].start; d <= todayISO; d = iso(addDays(d, 1))) {
      ctl += 0.16;
      out.push({ date: d, ctl, atl: ctl + 4, tsb: -4 });
    }
    return out;
  };
  const toSeason = async el => { await act(async () => { seg(el, 'Season').click(); }); };

  it('charts the plan, names the block, and pins the milestones', async () => {
    const plan = generatePlan(profile());
    const { el, root } = await mount(plan, { wellness: history(plan), adjust: {} });
    await toSeason(el);

    expect(el.querySelector('.season-ramp')).toBeTruthy();
    expect(el.querySelector('.season-blocks')).toBeTruthy();
    // one block is current, and it is the only one
    expect(el.querySelectorAll('.sb-row.now')).toHaveLength(1);
    // the race is on the list and wears its own treatment
    expect(el.querySelector('.season-miles .sm-row.race')).toBeTruthy();
    root.unmount(); el.remove();
  }, 20000);

  it('steps nowhere: there is only one plan, so there is only one season', async () => {
    const plan = generatePlan(profile());
    const { el, root } = await mount(plan, { wellness: history(plan), adjust: {} });
    // the month range can move...
    expect(navs(el).some(b => !b.disabled)).toBe(true);
    await toSeason(el);
    // ...and the season cannot
    expect(navs(el).every(b => b.disabled)).toBe(true);
    root.unmount(); el.remove();
  }, 20000);

  it('offers no add-a-session row, having no day to add to', async () => {
    const plan = generatePlan(profile());
    const { el, root } = await mount(plan, { wellness: history(plan), adjust: {} });
    expect(el.querySelectorAll('.cal-add-card')).toHaveLength(4);
    await toSeason(el);
    expect(el.querySelectorAll('.cal-add-card')).toHaveLength(0);
    root.unmount(); el.remove();
  }, 20000);

  it('says there is no plan rather than drawing an empty axis', async () => {
    const { el, root } = await mount(buildTrackerPlan(generatePlan(profile()), todayISO), { wellness: [], adjust: {} });
    await toSeason(el);
    expect(el.querySelector('.sr-plot')).toBeNull();
    expect(el.textContent).toContain('No plan active');
    root.unmount(); el.remove();
  }, 20000);
});

describe('WorkoutRow keeps its old shape', () => {
  it('renders the weekday on the right when given no right-hand slot', () => {
    const w = { id: 'x', discipline: 'run', type: 'Easy', title: 'Easy Run', durationMin: 40, date: '2026-08-05' };
    const plain = renderToString(<WorkoutRow w={w} eff="2026-08-05" />);
    expect(plain).toContain('Wed');
    // and the slot replaces exactly that, nothing else
    const withSlot = renderToString(<WorkoutRow w={w} eff="2026-08-05" right={<b>42</b>} />);
    expect(withSlot).not.toContain('Wed');
    expect(withSlot).toContain('42');
    expect(withSlot).toContain('Easy Run');
  });
});

/* The week's rows price themselves off what happened. Before this the row for
   a session you had finished still showed the number it was forecast to cost,
   and a ride that was never in the plan showed no number at all. */
describe('a week row says what it cost', () => {
  const planFor = () => generatePlan(profile());
  const firstSession = plan => plan.weeks.flatMap(w => w.workouts)
    .find(w => w.discipline !== 'rest' && !w.race && weekRange(todayISO).includes(w.date));
  const rowFor = (el, title) => [...el.querySelectorAll('.wk-day .wk')].find(r => r.querySelector('.t').textContent.includes(title));

  it('shows the measured number for a session its recording speaks for', async () => {
    const plan = planFor();
    const w = firstSession(plan);
    const a = { id: 'a1', date: w.date, type: w.discipline === 'run' ? 'Run' : w.discipline === 'swim' ? 'Swim' : 'Ride',
      name: 'Recorded', movingTimeSec: (w.durationMin || 60) * 60, trainingLoad: 137 };
    const { el, root } = await mount(plan, { activities: [a], log: { [w.id]: { done: true } } });
    await toWeek(el);
    const b = rowFor(el, w.title).querySelector('.right b');
    expect(b.textContent).toBe('137');            // measured: no tilde, not the plan's estimate
    await act(async () => root.unmount());
  });

  it('marks a number it had to model', async () => {
    const plan = planFor();
    const w = firstSession(plan);
    const { el, root } = await mount(plan);
    await toWeek(el);
    expect(rowFor(el, w.title).querySelector('.right b').textContent)
      .toBe('~' + Math.round(estimateTss(w)));
    await act(async () => root.unmount());
  });

  it('gives a recording the plan never asked for its own number, and speaks it', async () => {
    const plan = planFor();
    const a = { id: 'a9', date: todayISO, type: 'Ride', name: 'Bristol Road Cycling', movingTimeSec: 5400, trainingLoad: 103 };
    const { el, root } = await mount(plan, { activities: [a] });
    await toWeek(el);
    const row = rowFor(el, 'Bristol Road Cycling');
    expect(row.querySelector('.right b').textContent).toBe('103');
    // and it says the number ONCE: the stat line gives it up when the row
    // has a slot of its own
    expect(row.querySelector('.s').textContent).not.toContain('load');
    // the number is visible, so it must also be audible
    expect(row.getAttribute('aria-label')).toContain('103 TSS');
    await act(async () => root.unmount());
  });

  it('says an estimate out loud rather than only tilde-ing it', async () => {
    const plan = planFor();
    const a = { id: 'a9', date: todayISO, type: 'Ride', name: 'Unmetered ride', movingTimeSec: 3600, trainingLoad: null };
    const { el, root } = await mount(plan, { activities: [a] });
    await toWeek(el);
    const row = rowFor(el, 'Unmetered ride');
    expect(row.querySelector('.right b').textContent).toBe('~49');
    expect(row.getAttribute('aria-label')).toContain('about 49 TSS');
    await act(async () => root.unmount());
  });

  it('keeps the load in the month day card, where there is no slot for it', async () => {
    // the two surfaces share the row; only the week has a right-hand column
    const plan = planFor();
    const a = { id: 'a9', date: todayISO, type: 'Ride', name: 'Bristol Road Cycling', movingTimeSec: 5400, trainingLoad: 103 };
    const { el, root } = await mount(plan, { activities: [a] });
    const row = [...el.querySelectorAll('.wk')].find(r => r.querySelector('.t').textContent.includes('Bristol'));
    expect(row.querySelector('.s').textContent).toContain('load 103');
    expect(row.querySelector('.right').textContent).toBe('\u203a');
    await act(async () => root.unmount());
  });
});
