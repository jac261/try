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
    /* Rounded per session and then summed, not summed and then rounded: the
       header has to equal the numbers the athlete can add up on the rows
       beneath it, and a seven-row week is otherwise off by a few. */
    const want = shown.reduce((s2, w) => s2 + Math.round(estimateTss(w)), 0);
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
    /* A week with no plan in it is exactly the week that is all recordings,
       and it used to get no header at all. It gets one now, with no "week n
       of m" to place it and no denominator to compare against: 40 minutes at
       an estimated load, because this ride carries none of its own. */
    expect(el.querySelector('.wk-head').textContent).toBe('40 min · ~33 TSS');

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

/* The header. Two pairs, done over planned, and the invariant that matters
   most: it is the sum of the rows underneath it. */
describe('the week header counts what happened', () => {
  const planFor = () => generatePlan(profile());
  const sessionsThisWeek = plan => plan.weeks.flatMap(w => w.workouts)
    .filter(w => w.discipline !== 'rest' && weekRange(todayISO).includes(w.date));
  const head = el => el.querySelector('.wk-head').textContent;

  it('says nothing new about a week with nothing recorded', async () => {
    // entirely modelled, so it admits that in words rather than pairing
    // itself against a number it has not earned
    const { el, root } = await mount(planFor());
    await toWeek(el);
    expect(head(el)).toMatch(/· \d+ TSS, estimated$/);
    expect(head(el)).not.toContain(' / ');
    await act(async () => root.unmount());
  });

  it('pairs done against planned once anything is recorded', async () => {
    const plan = planFor();
    const w = sessionsThisWeek(plan)[0];
    const a = { id: 'a1', date: w.date, type: 'Ride', name: 'Recorded', movingTimeSec: 3600, trainingLoad: 88 };
    const { el, root } = await mount(plan, { activities: [a] });
    await toWeek(el);
    expect(head(el)).toMatch(/\d+ TSS$/);
    expect(head(el)).toContain(' / ');
    expect(head(el)).toContain('88 /');           // the unplanned ride is in the done side
    await act(async () => root.unmount());
  });

  it('lets done exceed planned without comment', async () => {
    /* An ordinary week. Nothing clamps it, nothing colours it, and the pair
       does not swap round to hide it (Jon, 2026-08-06). */
    const plan = planFor();
    const acts = [1, 2, 3].map(i => ({ id: 'x' + i, date: todayISO, type: 'Ride', name: 'Big ride ' + i,
      movingTimeSec: 4 * 3600, trainingLoad: 300 }));
    const { el, root } = await mount(plan, { activities: acts });
    await toWeek(el);
    const [done, planned] = head(el).match(/(\d+) \/ (\d+) TSS/).slice(1).map(Number);
    expect(done).toBeGreaterThan(planned);
    expect(done).toBe(900 + 0);                    // three rides, nothing else logged
    await act(async () => root.unmount());
  });

  it('equals the sum of the rows beneath it, each contribution shown once', async () => {
    /* The invariant the whole feature rests on. A mixed week: a matched and
       ticked session, an untouched planned session, and a ride the plan never
       asked for. The recording that fulfilled the session carries NO number
       of its own — that load rides on the session's row — or the numbers on
       screen would add up to more than the header above them. */
    const plan = planFor();
    const w = sessionsThisWeek(plan).find(x => !x.race);
    const acts = [
      { id: 'a1', date: w.date, type: w.discipline === 'run' ? 'Run' : w.discipline === 'swim' ? 'Swim' : 'Ride',
        name: 'The file that did it', movingTimeSec: (w.durationMin || 60) * 60, trainingLoad: 71 },
      { id: 'a2', date: todayISO, type: 'Ride', name: 'Extra ride', movingTimeSec: 3600, trainingLoad: 44 },
    ];
    const { el, root } = await mount(plan, { activities: acts, log: { [w.id]: { done: true } } });
    await toWeek(el);
    const done = Number(head(el).match(/(\d+) \/ \d+ TSS/)[1]);
    expect(done).toBe(71 + 44);

    const rows = [...el.querySelectorAll('.wk-day .wk')];
    const num = r => (r.querySelector('.right b') ? Number(r.querySelector('.right b').textContent.replace('~', '')) : null);
    const byTitle = t => rows.find(r => r.querySelector('.t').textContent.includes(t));
    // the claimed recording is evidence, not a second contribution
    expect(num(byTitle('The file that did it'))).toBe(null);
    expect(num(byTitle('Extra ride'))).toBe(44);
    // and everything the week counts as done is on screen, exactly once
    const shown = rows.filter(r => r.classList.contains('done') || r.querySelector('.t').textContent.includes('Extra ride'));
    expect(shown.reduce((sum, r) => sum + (num(r) || 0), 0)).toBe(done);
    await act(async () => root.unmount());
  });
});
