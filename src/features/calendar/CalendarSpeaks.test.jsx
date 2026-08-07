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
import { weekRange, weekLabel } from '@/lib/schedule.js';
import { readFileSync } from 'node:fs';

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

describe('the segbar keeps the promise its role makes', () => {
  /* role="tablist" announces "this is a set of tabs, use the arrow keys".
     Both copies of this row announced it and neither implemented it. There
     were exactly two, identical in markup and in defect, which is why the fix
     was an extraction rather than a patch: a widget that behaves one way on
     Calendar and another on Progress is worse than one that is wrong twice. */
  const tabs = el => [...el.querySelectorAll('.segbar [role="tab"]')];
  const press = (btn, key) => act(async () => {
    btn.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
  });

  it('arrow keys walk the row and switch as they go', async () => {
    const { el, done } = await mount();
    const [week, month, season] = tabs(el);
    expect(month.getAttribute('aria-selected')).toBe('true');   // Month is the default
    await press(month, 'ArrowRight');
    expect(tabs(el)[2].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.season-ramp')).not.toBe(null);    // the view followed
    await press(tabs(el)[2], 'ArrowLeft');
    expect(tabs(el)[1].getAttribute('aria-selected')).toBe('true');
    await press(tabs(el)[1], 'Home');
    expect(tabs(el)[0].getAttribute('aria-selected')).toBe('true');
    await press(tabs(el)[0], 'End');
    expect(tabs(el)[2].getAttribute('aria-selected')).toBe('true');
    expect(week).toBe(tabs(el)[0]);                             // same nodes throughout
    expect(season).toBe(tabs(el)[2]);
    await done();
  });

  it('wraps at both ends rather than stopping dead', async () => {
    const { el, done } = await mount();
    await press(tabs(el)[1], 'ArrowLeft');
    expect(tabs(el)[0].getAttribute('aria-selected')).toBe('true');
    await press(tabs(el)[0], 'ArrowLeft');
    expect(tabs(el)[2].getAttribute('aria-selected')).toBe('true');
    await done();
  });

  it('there is one implementation, and both surfaces use it', () => {
    /* The source pin, because the defect was duplication rather than logic:
       the next hand-rolled tablist would look right on screen and silently
       lose the keyboard contract again. */
    // Paths from the repo root: this file runs under happy-dom, where
    // import.meta.url is not a file: URL and the node idiom does not apply.
    const cal = readFileSync('src/features/calendar/CalendarView.jsx', 'utf8');
    const prog = readFileSync('src/features/progress/ProgressView.jsx', 'utf8');
    expect(cal).toContain("SegBar");
    expect(prog).toContain("SegBar");
    expect(cal).not.toContain('role="tablist"');
    expect(prog).not.toContain('role="tablist"');
  });

  it('is ONE tab stop, not three', async () => {
    // Roving tabindex: Tab moves past the set, the arrows move inside it.
    const { el, done } = await mount();
    expect(tabs(el).map(t => t.tabIndex)).toEqual([-1, 0, -1]);
    await act(async () => { tabs(el)[0].click(); });
    expect(tabs(el).map(t => t.tabIndex)).toEqual([0, -1, -1]);
    await done();
  });
});

describe('the week says what it will do before you tap', () => {
  it('a rest day compacts but stays a full drop target', async () => {
    /* Jon's call: seven full-height cards saying "nothing here" is most of a
       scroll. The compaction is a class, and everything a drag depends on has
       to survive it — the day is still a .wk-day, still carries its
       data-caldate, still says Rest day. */
    const { el, toWeek, done } = await mount();
    await toWeek();
    const bare = [...el.querySelectorAll('.wk-day.bare')];
    expect(bare.length).toBeGreaterThan(0);
    bare.forEach(d => {
      expect(d.getAttribute('data-caldate')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.querySelector('.wd-none')).not.toBe(null);
    });
    /* The height is a number, so it is pinned as one: the compacted row
       measured 40px before min-height was added, and a drop target below the
       44px touch minimum is the one thing this compaction must not cost. */
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/\.wk-day\.bare \{[^}]*min-height: 44px/);
    // and a day WITH sessions is not compacted
    const busy = [...el.querySelectorAll('.wk-day')].filter(d => d.querySelector('.cal-row'));
    expect(busy.length).toBeGreaterThan(0);
    busy.forEach(d => expect(d.className).not.toContain('bare'));
    await done();
  });

  it('the add block names the day it will file under', async () => {
    /* The aria-label said it all along, so a screen reader knew the target
       and the eye did not: in the week range nothing is selected, and four
       cards sat under seven days with no sign which one they meant. */
    const { el, toWeek, done } = await mount();
    await toWeek();
    const heading = [...el.querySelectorAll('.section-title')].find(h => h.textContent.includes('Add a session'));
    const card = el.querySelector('.cal-add-card');
    /* The space before "on" matters: without it the pattern matches the "on"
       inside "session" and captures the word "on", which every heading
       contains — the assertion then passes whatever the heading says. It did,
       and the mutation that strips the date survived it.

       Weekday and day number rather than the whole phrase, because the two
       are formatted differently on purpose (the heading abbreviates the
       month) and because the order varies by locale. */
    const label = card.getAttribute('aria-label');
    const weekday = label.match(/ on (\w+)/)[1];
    const dayNum = label.match(/\d+/)[0];
    expect(heading.textContent).toContain(weekday);    // the eye and the ear agree
    expect(heading.textContent).toContain(dayNum);
    await done();
  });
});

describe('the strays', () => {
  it('the shortfall banner is inert when there is nowhere to go', async () => {
    /* .banner styles itself as something you press. Without the settings
       callback the copy already dropped its "update your level" sentence, but
       the affordances stayed: a pointer cursar and a hover brighten promising
       a destination that does not exist. */
    /* The shortfall fixture is SeasonPanel.test.jsx's, fixed date and all:
       whether the banner fires at all depends on how far the first projected
       Monday falls below the measured line, which the real clock moves. */
    const { SeasonPanel } = await import('@/features/calendar/SeasonPanel.jsx');
    const day = '2026-05-13';
    const plan = generatePlan(profile({
      startDate: iso(addDays(day, -8 * 7)), raceDate: iso(addDays(day, 8 * 7)),
    }));
    const wellness = [];
    for (let d = plan.weeks[0].start; d <= day; d = iso(addDays(d, 1))) {
      wellness.push({ date: d, ctl: 80, atl: 75, tsb: 5 });
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(<SeasonPanel plan={plan} wellness={wellness} log={{}} moves={{}}
        adjust={{}} todayISO={day} />);
    });
    const banner = el.querySelector('.season-ramp .banner');
    expect(banner.className).toContain('inert');
    expect(banner.getAttribute('role')).toBe(null);      // not a button either
    expect(banner.textContent).not.toContain('→');

    /* And with somewhere to go: pressable, and the arrow is decoration for
       the sentence it ends — a screen reader reading "right arrow" aloud
       after "the plan re-targets" is noise, so it is hidden. Asserted on the
       ACTIVE banner because the inert one has no arrow to hide, which is how
       the first version of this test passed while the arrow was still
       spoken. */
    await act(async () => {
      root.render(<SeasonPanel plan={plan} wellness={wellness} log={{}} moves={{}}
        adjust={{}} todayISO={day} onOpenSettings={() => {}} />);
    });
    const live = el.querySelector('.season-ramp .banner');
    expect(live.className).not.toContain('inert');
    expect(live.getAttribute('role')).toBe('button');
    const arrow = [...live.querySelectorAll('[aria-hidden="true"]')]
      .find(n => n.textContent.includes('→'));
    expect(arrow).not.toBe(undefined);
    await act(async () => root.unmount());
    el.remove();
  });

  it('a week across New Year says which year each end is', () => {
    /* "29 December – 4 January" is two years wearing no label, on the one
       week of the year where that matters most. Testable at all because the
       label moved out of the component: reaching this week through the UI
       means clicking the arrows back through five months. */
    const straddle = weekLabel(weekRange('2026-12-30'));
    expect(straddle).toContain('2026');
    expect(straddle).toContain('2027');
    // and every other week is left alone: fifty-one years stamped for one
    const ordinary = weekLabel(weekRange('2026-08-05'));
    expect(ordinary).not.toMatch(/20\d\d/);
    // the month is still dropped from the first date within one month
    // (the order of day and month is the locale's business, not ours)
    expect(ordinary).toMatch(/^\d+ – /);
    const crossMonth = weekLabel(weekRange('2026-07-30'));
    expect(crossMonth).toMatch(/July.*August/);
  });

  it('the calendar carries no CSS nobody renders', () => {
    // .cal-day.drop and .cal-hint outlived the markup that used them: the
    // month grid stopped being a drop range, and the hint line was removed.
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).not.toContain('.cal-day.drop');
    expect(css).not.toContain('.cal-hint');
  });
});
