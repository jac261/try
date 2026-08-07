// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { LoadSlot } from '@/components/LoadSlot.jsx';
import { RecordedActivities } from '@/components/RecordedActivities.jsx';
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';

/* One house rule, four places it was broken: a visible ~ means "modelled,
   not measured", and a marker the eye gets while the ear gets nothing is a
   silent difference between what the screen says and what the athlete hears
   (calendar audit, 2026-08-06). The tilde is punctuation; screen readers
   skip it, so every site that prints one has to say "about" somewhere a
   screen reader will reach.

   The four are deliberately in one file: they are one rule, and a rule with
   its examples scattered across four suites is a rule that gets half-applied
   the next time somebody prints a number. */

/* CalendarView reads the real clock for "today" (it takes no prop for it),
   so these fixtures are built around it rather than around a fixed date: the
   thing under test here is which cell is marked today, and a plan that does
   not contain today would not have one. */
const TODAY = iso(new Date());
const mon = iso(startOfWeekMonday(TODAY));
const profile = (over = {}) => ({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: iso(addDays(mon, -28)), raceDate: iso(addDays(mon, 84)), ...over,
});

const noop = () => {};
const mount = async (extra = {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<CalendarView plan={generatePlan(profile())} log={{}} moves={{}} open={noop}
      easedOf={w => w} onToggleWorkout={noop} onMove={noop} activities={null}
      onOpenRecording={noop} onAddWorkout={noop} {...extra} />);
  });
  const toWeek = async () => act(async () => {
    [...el.querySelectorAll('.segbar button')].find(b => b.textContent === 'Week').click();
  });
  return { el, toWeek, done: async () => { await act(async () => root.unmount()); el.remove(); } };
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('the estimate marker is spoken, not just printed', () => {
  const w = { id: 'x', discipline: 'run', type: 'Easy', title: 'Easy run', durationMin: 45, date: TODAY };

  /* Read as TEXT, not as markup: SSR splits adjacent expressions with
     comment markers, so a string assertion on the html would be testing
     React's serialiser rather than the row. */
  const text = node => { const d = document.createElement('div'); d.innerHTML = renderToString(node); return d.textContent; };

  it('a planned row says "about" beside its modelled load', () => {
    /* From INSIDE the slot, as a visually-hidden word. WorkoutRow has no
       aria-label on purpose (its comment says why), so its accessible name is
       built from its content — which means the fix has to be content. */
    const est = text(<WorkoutRow w={w} done={false} eff={w.date} onClick={noop}
      right={<LoadSlot tss={42} measured={false} />} />);
    expect(est).toContain('about ');
    expect(est).toContain('~42');
  });

  it('a measured row says no such thing', () => {
    // The word tracks the marker. A row that measured its load has no tilde
    // and must not gain a hedge the number does not carry.
    const real = text(<WorkoutRow w={w} done eff={w.date} onClick={noop}
      right={<LoadSlot tss={42} measured />} />);
    expect(real).not.toContain('about ');
    expect(real).not.toContain('~42');
  });

  it('an estimated distance is spoken too', () => {
    // Same rule, the other tilde on the same row.
    const est = text(<WorkoutRow w={{ ...w, distance: 8, unit: 'km', distEst: true }}
      done={false} eff={w.date} onClick={noop} />);
    expect(est).toContain('about ');
    expect(est).toContain('~8 km');
    const known = text(<WorkoutRow w={{ ...w, distance: 8, unit: 'km' }}
      done={false} eff={w.date} onClick={noop} />);
    expect(known).not.toContain('about ');
  });

  it('the week header carries a spoken twin when its total is modelled', async () => {
    /* The header is one string in one element, so it gets an aria-label —
       and only when the two differ, so a fully measured week is not given a
       label that merely repeats it. */
    const acts = [{ id: 'a1', type: 'Ride', name: 'Club ride', date: iso(addDays(mon, 1)),
      movingTimeSec: 3600, distance: 30000 }];   // no trainingLoad: modelled
    const { el, toWeek, done } = await mount({ activities: acts });
    await toWeek();
    const head = el.querySelector('.wk-head');
    expect(head.textContent).toContain('~');
    expect(head.getAttribute('aria-label')).toContain('about ');
    expect(head.getAttribute('aria-label')).not.toContain('~');
    await done();
  });

  it('a fully measured week header is left unlabelled', async () => {
    const acts = [{ id: 'a1', type: 'Ride', name: 'Club ride', date: iso(addDays(mon, 1)),
      movingTimeSec: 3600, distance: 30000, trainingLoad: 55 }];
    const { el, toWeek, done } = await mount({ activities: acts });
    await toWeek();
    const head = el.querySelector('.wk-head');
    expect(head.textContent).not.toContain('~');
    expect(head.getAttribute('aria-label')).toBe(null);
    await done();
  });

  it('a recorded row says "about load" where its line prints "~load"', () => {
    /* This row DOES own an aria-label (it opens something, and the label
       says which), so the substitution happens where the label is built. The
       visible line keeps the tilde: the rule is that both say the same
       thing, not that either gives up its own idiom. */
    const plan = generatePlan(profile());
    const date = iso(addDays(mon, 1));
    const act1 = { id: 'r1', type: 'Ride', name: 'Club ride', date, movingTimeSec: 3600,
      distance: 30000, trainingLoad: 55, estimated: true };
    const html = renderToString(<RecordedActivities activities={[act1]} date={date} plan={plan}
      log={{}} moves={{}} onOpen={noop} />);
    expect(html).toContain('~load');
    expect(html).toMatch(/aria-label="[^"]*about load/);
  });
});

describe('a grid cell says what its dots show', () => {
  const cell = (el, dISO) => el.querySelector('[data-caldate="' + dISO + '"]');

  it('aria-current marks TODAY, and selection is said in words', async () => {
    /* aria-current="date" is a claim about the calendar, not about this
       control: it means "this is today". It marked the SELECTED cell, so a
       screen reader was told whichever day the athlete tapped was today's,
       and today's own cell claimed nothing. */
    const { el, done } = await mount();
    const other = iso(addDays(TODAY, 2));
    expect(cell(el, TODAY).getAttribute('aria-current')).toBe('date');
    await act(async () => { cell(el, other).click(); });
    expect(cell(el, TODAY).getAttribute('aria-current')).toBe('date');
    expect(cell(el, other).getAttribute('aria-current')).toBe(null);
    expect(cell(el, other).getAttribute('aria-label')).toContain('selected');
    await done();
  });

  // The grid shows the month around today, so a fixture has to sit in it.
  const thisMonth = d => d.slice(0, 7) === TODAY.slice(0, 7);

  it('a completed session is done in the label, not only in the dot', async () => {
    const plan = generatePlan(profile());
    const w = plan.weeks.flatMap(x => x.workouts)
      .find(x => x.discipline !== 'rest' && x.durationMin > 0 && thisMonth(x.date));
    const { el, done } = await mount({ plan, log: { [w.id]: { done: true } } });
    expect(cell(el, w.date).getAttribute('aria-label')).toContain(w.title + ' done');
    const { el: el2, done: done2 } = await mount({ plan, log: {} });
    expect(cell(el2, w.date).getAttribute('aria-label')).not.toContain(' done');
    await done(); await done2();
  });

  it('race day says so, where the eye gets a gold ring', async () => {
    // A race inside the shown month, so the cell exists to be read.
    const raceDate = iso(addDays(TODAY, 10));
    const plan = generatePlan(profile({ raceDate }));
    const { el, done } = await mount({ plan });
    expect(cell(el, raceDate).getAttribute('aria-label')).toContain('race day');
    expect(cell(el, iso(addDays(raceDate, -1))).getAttribute('aria-label')).not.toContain('race day');
    await done();
  });
});
