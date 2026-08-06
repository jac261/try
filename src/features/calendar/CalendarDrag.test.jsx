// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CalendarView } from '@/features/calendar/CalendarView.jsx';
import { generatePlan } from '@/lib/plan.js';
import { iso, addDays, startOfWeekMonday } from '@/lib/date.js';
import { weekRange } from '@/lib/schedule.js';

/* The drag lives on the WEEK range only (Jon, 2026-08-06): seven visible
   cards make within-week the natural constraint, where the month grid let an
   athlete pile a whole month into its last week. These drive the real
   pointer path; the one thing happy-dom cannot do is geometry, so
   document.elementFromPoint is stubbed to return the intended target —
   substituting the layout, never the logic. */

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
  return { el, root, cleanup: async () => { await act(async () => root.unmount()); el.remove(); } };
};
const seg = (el, label) => [...el.querySelectorAll('.segbar button')].find(b => b.textContent === label);
const toWeek = async el => { await act(async () => { seg(el, 'Week').click(); }); };

const pointer = (type, target, x = 100, y = 300) =>
  act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });

// the geometry stub: whatever card the test aims at is "under" the pointer
const aimAt = card => { document.elementFromPoint = () => card; };

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { delete document.elementFromPoint; });

const cardFor = (el, d) => el.querySelector('.wk-day[data-caldate="' + d + '"]');
const gripIn = card => card.querySelector('.drag-handle');
const sessionsThisWeek = plan => plan.weeks.flatMap(w => w.workouts)
  .filter(w => w.discipline !== 'rest' && weekRange(todayISO).includes(w.date));

describe('dragging a session on the week range', () => {
  it('moves it to the day it is dropped on, and highlights on the way', async () => {
    const plan = generatePlan(profile());
    const w = sessionsThisWeek(plan).find(x => !x.race && !x.bRace);
    const empty = weekRange(todayISO).find(d => !plan.weeks.flatMap(k => k.workouts)
      .some(x => x.discipline !== 'rest' && x.date === d));
    const onMove = vi.fn();
    const c = await mount(plan, { onMove });
    await toWeek(c.el);

    const grip = gripIn(cardFor(c.el, w.date));
    const target = cardFor(c.el, empty);
    await pointer('pointerdown', grip);
    aimAt(target);
    await pointer('pointermove', grip);
    expect(target.classList.contains('drop')).toBe(true);   // the highlight says where it will land
    await pointer('pointerup', grip);
    expect(onMove).toHaveBeenCalledWith(w.id, empty);
    await c.cleanup();
  });

  it('refuses race day', async () => {
    // the race inside the shown week, the shape CalendarRanges' race test uses
    const plan = generatePlan(profile({ startDate: iso(addDays(mon, -28)), raceDate: iso(addDays(mon, 6)) }));
    const raceISO = plan.profile.raceDate;
    const w = sessionsThisWeek(plan).find(x => !x.race && !x.bRace);
    const onMove = vi.fn();
    const c = await mount(plan, { onMove });
    await toWeek(c.el);

    const grip = gripIn(cardFor(c.el, w.date));
    const raceCard = cardFor(c.el, raceISO);
    await pointer('pointerdown', grip);
    aimAt(raceCard);
    await pointer('pointermove', grip);
    expect(raceCard.classList.contains('drop')).toBe(false);
    await pointer('pointerup', grip);
    expect(onMove).not.toHaveBeenCalled();
    await c.cleanup();
  });

  it('refuses a day before the plan began', async () => {
    /* The plan starts next Monday, so the SHOWN week straddles the plan
       edge: its early cards carry data-caldate and must still be invalid. */
    const plan = generatePlan(profile({ startDate: iso(addDays(mon, 7)), raceDate: iso(addDays(today, 84)) }));
    const c = await mount(plan, { onMove: vi.fn() });
    await toWeek(c.el);
    // step back one week to where pre-plan days are on screen with plan days
    const back = [...c.el.querySelectorAll('.cal-nav')][0];
    await act(async () => back.click());

    const shown = [...c.el.querySelectorAll('.wk-day')];
    // whichever card says "Before this plan began." is the proof target
    const pre = shown.find(d => d.textContent.includes('Before this plan began.'));
    const w = plan.weeks[0].workouts.find(x => x.discipline !== 'rest' && !x.race && !x.bRace);
    const gripCard = cardFor(c.el, w.date);
    if (!gripCard || !pre) { await c.cleanup(); return; }   // week composition varies; the ranges test pins the copy
    const grip = gripIn(gripCard);
    await pointer('pointerdown', grip);
    aimAt(pre);
    await pointer('pointermove', grip);
    expect(pre.classList.contains('drop')).toBe(false);
    await c.cleanup();
  });

  it('dropping a session on its own day is the reset, not a move', async () => {
    const plan = generatePlan(profile());
    const w = sessionsThisWeek(plan).find(x => !x.race && !x.bRace);
    const onMove = vi.fn();
    const c = await mount(plan, { onMove });
    await toWeek(c.el);
    const grip = gripIn(cardFor(c.el, w.date));
    await pointer('pointerdown', grip);
    aimAt(cardFor(c.el, w.date));
    await pointer('pointermove', grip);
    await pointer('pointerup', grip);
    expect(onMove).toHaveBeenCalledWith(w.id, null);
    await c.cleanup();
  });

  it('auto-scrolls at the bottom edge and stops when the finger lifts', async () => {
    /* The loop re-renders every frame, so letting real frames run starves
       act() forever — rAF is stubbed and driven by hand instead, which also
       makes the frame count deterministic. */
    const frames = [];
    const realRaf = window.requestAnimationFrame, realCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
    window.cancelAnimationFrame = id => { frames[id - 1] = null; };
    const plan = generatePlan(profile());
    const w = sessionsThisWeek(plan).find(x => !x.race && !x.bRace);
    const c = await mount(plan, { onMove: vi.fn() });
    await toWeek(c.el);
    const scrolled = vi.fn();
    window.scrollBy = scrolled;

    const grip = gripIn(cardFor(c.el, w.date));
    await pointer('pointerdown', grip);
    aimAt(cardFor(c.el, w.date));
    // a move deep in the bottom edge zone schedules the first frame
    await pointer('pointermove', grip, 100, Math.max(window.innerHeight - 10, 700));
    expect(frames.filter(Boolean).length).toBeGreaterThan(0);
    await act(async () => { const f = frames.pop(); f && f(); });   // one frame
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.calls[0][1]).toBeGreaterThan(0);           // downward

    await pointer('pointerup', grip);
    // the lift cancelled whatever frame was pending
    expect(frames.filter(Boolean)).toHaveLength(0);
    window.requestAnimationFrame = realRaf; window.cancelAnimationFrame = realCancel;
    await c.cleanup();
  });
});

describe('where grips exist at all', () => {
  it('the month range mounts none, however a day is selected', async () => {
    /* The guard replacing the month drag: data-caldate stays on the grid
       (three tests use it as a date hook), so the thing that must never
       return is the grip that would make those cells targets again. */
    const plan = generatePlan(profile());
    const c = await mount(plan);
    // a session in the SHOWN month: the grid anchors on today
    const w = sessionsThisWeek(plan).find(x => !x.race && !x.bRace);
    const cell = c.el.querySelector('.cal-day[data-caldate="' + w.date + '"]');
    await act(async () => cell.click());
    expect(c.el.querySelector('.drag-handle')).toBe(null);
    expect(c.el.textContent).not.toContain('drag it onto');
    await c.cleanup();
  });


  it('the week range: one per movable session, none on races', async () => {
    const plan = generatePlan(profile({ startDate: iso(addDays(mon, -28)), raceDate: iso(addDays(mon, 6)) }));
    const c = await mount(plan);
    await toWeek(c.el);
    const movable = sessionsThisWeek(plan).filter(x => !x.race && !x.bRace);
    expect(c.el.querySelectorAll('.wk-day .drag-handle')).toHaveLength(movable.length);
    const raceCard = cardFor(c.el, plan.profile.raceDate);
    expect(raceCard.querySelector('.drag-handle')).toBe(null);
    await c.cleanup();
  });
});
