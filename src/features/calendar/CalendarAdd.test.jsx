// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { App } from '@/app/App.jsx';
import { storageForUser } from '@/app/storage.js';
import { buildTrackerPlan, generatePlan } from '@/lib/plan.js';
import { iso, addDays } from '@/lib/date.js';

/* The calendar's add-a-session cards (Jon, 2026-07-17): one heading and one
   card design in both modes, full discipline colour, icon front and centre,
   no hint line — and the full add/remove journey through the real App. */

const trackerPlan = () => buildTrackerPlan(generatePlan({
  name: 'T', raceType: 'olympic', fitness: 'intermediate',
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-01-05', raceDate: '2026-04-05',
}), iso(new Date()));

describe('the add-a-session cards', () => {
  const base = { plan: trackerPlan(), log: {}, moves: {}, open: () => {}, easedOf: w => w, onToggleWorkout: () => {}, onMove: () => {}, activities: null, onOpenRecording: () => {} };

  it('say Add a session in tracker mode too, with no hint line', () => {
    const html = renderToString(<CalendarView {...base} onAddWorkout={() => {}} />);
    expect(html).toContain('Add a session');
    expect(html).not.toContain('Log a session');
    expect(html).not.toContain('+ Log');
    expect(html).not.toContain('+ Add');
  });

  it('wear the full discipline colour with the icon large and centred, strength included', () => {
    const html = renderToString(<CalendarView {...base} onAddWorkout={() => {}} />);
    // gradient background inlined on each card, icon at the large size
    expect((html.match(/cal-add-card/g) || []).length).toBe(4);
    expect(html).toContain('Strength');
    // the gradient itself lives in styles.css as --grad-<discipline> now, so
    // the theme can rebind it; the card still inlines the reference
    expect((html.match(/var\(--grad-/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('width="32"');
  });

  it('tapping a card reports the sport and the selected day', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const got = [];
    await act(async () => {
      createRoot(el).render(<CalendarView {...base} onAddWorkout={(k, d) => got.push([k, d])} />);
    });
    [...el.querySelectorAll('.cal-add-card')][1].click();
    expect(got).toEqual([['bike', iso(new Date())]]);
    el.remove();
  });
});

describe('the full add and remove journey (tracker diary via the calendar)', () => {
  /* App holds the splash for 4.4s (the mark tumbles all three faces). Sleeping
     that out on the wall clock made the mount a race it could lose: under the
     full suite in parallel the app's own timer fires late, the margin gets
     eaten, and the clicks below land on a splash instead of the app. The hold
     is a setTimeout, so fake setTimeout and wind the clock instead. Anything
     past 4400 is spare. */
  const PAST_SPLASH_HOLD_MS = 4600;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    globalThis.fetch = () => Promise.reject(new Error('offline'));
    globalThis.confirm = () => true;
  });
  afterEach(() => { vi.useRealTimers(); });

  it('adds a session from the calendar cards and removes it from its edit sheet', async () => {
    const storage = storageForUser('simuser');
    storage.save('plan', trackerPlan());
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(<App storage={storage} getToken={async () => null} user={{ imageUrl: null }} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SPLASH_HOLD_MS); });
    if (el.querySelector('.splash')) throw new Error('splash still up past PAST_SPLASH_HOLD_MS');

    // to the calendar tab
    const navBtn = [...el.querySelectorAll('.nav button')].find(b => b.textContent.includes('Calendar'));
    await act(async () => { navBtn.click(); });

    // tap the Run card, sheet opens in log mode for today
    const runCard = [...el.querySelectorAll('.cal-add-card')][0];
    await act(async () => { runCard.click(); });
    expect(el.querySelector('.sheet')).toBeTruthy();
    expect(el.querySelector('.sheet h2').textContent).toBe('Log a session');

    // submit: the diary gains the session, the Recorded list shows it Logged
    const submit = [...el.querySelectorAll('.sheet button')].find(b => b.textContent.startsWith('Log for'));
    await act(async () => { submit.click(); });
    expect(storage.loadManualActivities().length).toBe(1);
    expect(el.textContent).toContain('Logged');
    // and the session is on the calendar itself: the day cell gains a
    // recorded dot and announces it (Jon, 2026-07-17: added sessions must
    // land on the calendar)
    const todayCell = el.querySelector('.cal-day.today');
    expect(todayCell.querySelectorAll('.cd-dots i.done').length).toBe(1);
    expect(todayCell.getAttribute('aria-label')).toContain('1 recorded session');

    // first tap on the row celebrates (recap deck), close it
    const row = [...el.querySelectorAll('.wk')].find(r => (r.getAttribute('aria-label') || '').startsWith('Open '));
    await act(async () => { row.click(); });
    const closeRecap = el.querySelector('[aria-label="Close recap"], .recap-close, .scrim');
    expect(closeRecap).toBeTruthy();
    await act(async () => { closeRecap.click(); });

    // second tap opens the edit sheet; Remove deletes the entry
    const row2 = [...el.querySelectorAll('.wk')].find(r => (r.getAttribute('aria-label') || '').startsWith('Open '));
    await act(async () => { row2.click(); });
    const remove = [...el.querySelectorAll('button')].find(b => b.textContent === 'Remove this session');
    expect(remove).toBeTruthy();
    await act(async () => { remove.click(); });
    expect(storage.loadManualActivities().length).toBe(0);
    expect(el.textContent).not.toContain('Logged');
    root.unmount();
    el.remove();
  }, 20000);
});

describe('history survives a new plan (field report 2026-07-30)', () => {
  /* "Starting a new plan deletes all my past recorded activities in the
     calendar." Nothing was deleted: the previous-month button stopped at the
     plan's first week, and recorded dots were tracker-only — so an athlete
     who came from a tracker lost SIGHT of their whole diary the moment a
     plan began. These pin the display fix; moves and add-targets stay
     clamped to the plan window. */
  const planProfile = {
    name: 'T', raceType: 'olympic', fitness: 'intermediate',
    fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
    trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
    startDate: iso(new Date()), raceDate: iso(addDays(new Date(), 112)),
  };
  const monthsBack = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return iso(d); };
  const oldRide = { id: 'old1', type: 'Ride', date: monthsBack(2), movingTimeSec: 3600, distance: 30000 };

  it('the previous-month button reaches months before the plan', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => {
      createRoot(el).render(<CalendarView plan={generatePlan(planProfile)} log={{}} moves={{}}
        open={() => {}} easedOf={w => w} onToggleWorkout={() => {}} onMove={() => {}}
        activities={[oldRide]} onOpenRecording={() => {}} onAddWorkout={() => {}} />);
    });
    const prev = el.querySelector('[aria-label="Previous month"]');
    expect(prev.disabled).toBe(false);                       // was disabled at the plan's first month
    await act(async () => { prev.click(); });
    await act(async () => { prev.click(); });
    // two months back: the old ride's month is reachable and its day is dotted
    const dotted = [...el.querySelectorAll('.cal-day')].find(c =>
      (c.getAttribute('aria-label') || '').includes('recorded'));
    expect(dotted).toBeTruthy();
    expect(dotted.querySelector('.cd-dots i.done')).toBeTruthy();
    el.remove();
  });

  /* The grid opens on TODAY's month, and a plan that starts mid-week can have
     its first sessions in the next one (a Friday start on a Mon/Tue/Thu/Sat/Sun
     week begins on the Saturday). Walk forward rather than assuming. */
  const renderAt = async (plan, activities, log) => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => {
      createRoot(el).render(<CalendarView plan={plan} log={log || {}} moves={{}}
        open={() => {}} easedOf={w => w} onToggleWorkout={() => {}} onMove={() => {}}
        activities={activities} onOpenRecording={() => {}} onAddWorkout={() => {}} />);
    });
    return el;
  };
  const cellFor = async (el, d) => {
    for (let i = 0; i < 4; i++) {
      const c = el.querySelector('[data-caldate="' + d + '"]');
      if (c) return c;
      const next = el.querySelector('[aria-label="Next month"]');
      if (!next || next.disabled) return null;
      await act(async () => { next.click(); });
    }
    return el.querySelector('[data-caldate="' + d + '"]');
  };
  // a planned bike day, so a Ride recording can genuinely match it
  const bikeDay = plan => plan.weeks.flatMap(w => w.workouts)
    .find(w => w.discipline === 'bike' && w.durationMin > 0 && !w.race);

  it('a planned day never wears two dots for one session', async () => {
    /* One session, one dot: a TICKED session whose recording matches it on
       discipline and duration is already represented by the planned dot.
       (This fixture used to pass for the wrong reason — its ride was a
       different discipline, out of window and unticked, so nothing was ever
       actually claimed.) */
    const plan = generatePlan(planProfile);
    const ride = bikeDay(plan);
    expect(ride).toBeTruthy();
    const matched = { id: 'm1', type: 'Ride', date: ride.date, movingTimeSec: ride.durationMin * 60, distance: 30000 };
    const el = await renderAt(plan, [matched], { [ride.id]: { done: true } });
    const cell = await cellFor(el, ride.date);
    expect(cell, 'the planned day never came into view').toBeTruthy();
    const planned = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline !== 'rest' && w.date === ride.date).length;
    expect(cell.querySelectorAll('.cd-dots i').length).toBe(Math.min(3, planned));
    el.remove();
  });

  it('a recording no planned session speaks for still gets its dot', async () => {
    /* The bug Jon reported: recorded sessions appeared in the day card but
       wore no dot, because ANY planned session suppressed every recording.
       An unticked session claims nothing, so its day shows both facts. */
    const plan = generatePlan(planProfile);
    const ride = bikeDay(plan);
    const extra = { id: 'm2', type: 'Ride', date: ride.date, movingTimeSec: ride.durationMin * 60, distance: 30000 };
    const el = await renderAt(plan, [extra], {});   // nothing ticked
    const cell = await cellFor(el, ride.date);
    const planned = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline !== 'rest' && w.date === ride.date).length;
    expect(cell.querySelectorAll('.cd-dots i').length).toBe(Math.min(3, planned + 1));
    expect(cell.getAttribute('aria-label')).toContain('1 recorded session');
    el.remove();
  });

  it('a second ride on a matched day is not swallowed by the first', async () => {
    // one-to-one claiming: the ticked session speaks for ONE recording, and
    // the other is a real session the grid must still show
    const plan = generatePlan(planProfile);
    const ride = bikeDay(plan);
    const secs = ride.durationMin * 60;
    const two = [
      { id: 'm3', type: 'Ride', date: ride.date, movingTimeSec: secs, distance: 30000 },
      { id: 'm4', type: 'Ride', date: ride.date, movingTimeSec: secs, distance: 28000 },
    ];
    const el = await renderAt(plan, two, { [ride.id]: { done: true } });
    const cell = await cellFor(el, ride.date);
    const planned = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline !== 'rest' && w.date === ride.date).length;
    expect(cell.querySelectorAll('.cd-dots i').length).toBe(Math.min(3, planned + 1));
    el.remove();
  });

  it('a pre-plan day speaks about history, never about dropping sessions', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => {
      createRoot(el).render(<CalendarView plan={generatePlan(planProfile)} log={{}} moves={{}}
        open={() => {}} easedOf={w => w} onToggleWorkout={() => {}} onMove={() => {}}
        activities={[]} onOpenRecording={() => {}} onAddWorkout={() => {}} />);
    });
    const prev = el.querySelector('[aria-label="Previous month"]');
    await act(async () => { prev.click(); });
    const anyDay = [...el.querySelectorAll('.cal-day')].find(c => c.getAttribute('data-caldate'));
    await act(async () => { anyDay.click(); });
    expect(el.textContent).not.toContain('drop a session here');
    el.remove();
  });
});
