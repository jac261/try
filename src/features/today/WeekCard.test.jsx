// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { WeekCard } from './WeekCard.jsx';

/* The card this replaces was pinned by nothing at all — no test rendered it,
   and the harness passed an empty log, so its done state had never appeared
   anywhere. These cover the states the design has no case for (a double day,
   a race, a miss) and the interactions the mockup has no markup for, since a
   redesign that quietly dropped them would be a regression in new clothes. */

const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const TODAY = '2026-08-05';

const w = (id, date, discipline, durationMin, over = {}) => ({
  id, date, discipline, durationMin, title: discipline + ' session', type: 'Easy', segments: [], ...over,
});
const planOf = (...workouts) => ({ totalWeeks: 12, weeks: [{ index: 3, phase: 'build', start: WEEK[0], totalMin: 300, workouts }] });
const props = (plan, over = {}) => ({
  plan, log: {}, moves: {}, adjust: {}, missedReasons: {},
  open: () => {}, easedOf: x => x, todayISO: TODAY, onToggleWorkout: () => {},
  loadOpen: () => false, saveOpen: () => {}, ...over,
});
const html = (plan, over = {}) => renderToStaticMarkup(<WeekCard {...props(plan, over)} />);

const mount = (plan, over = {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => { root.render(<WeekCard {...props(plan, over)} />); });
  return { el, root, cleanup: () => { root.unmount(); el.remove(); } };
};

describe('the seven days render', () => {
  it('draws one cell per day, with the design\'s heading', () => {
    const out = html(planOf(w('a', WEEK[0], 'swim', 45)));
    expect((out.match(/class="yw-day/g) || []).length).toBe(7);
    expect(out).toContain('Your week');
    expect(out).toContain('1 session this week');
  });

  it('lifts today out of the strip and dims the days behind it', () => {
    const out = html(planOf(w('a', TODAY, 'run', 60)));
    expect(out).toContain('yw-day today');
    expect(out).toContain('yw-day past');
    expect(out).toContain('>NOW<');
  });

  it('ticks a done day and marks a missed one', () => {
    const plan = planOf(w('a', WEEK[0], 'run', 60), w('b', WEEK[1], 'swim', 45));
    const out = html(plan, { log: { a: { done: true } } });
    expect(out).toContain('yw-mark done');    // Monday, ticked
    expect(out).toContain('yw-mark missed');  // Tuesday, past and not logged
  });

  it('shows both chips on a double day, and counts a third', () => {
    const two = html(planOf(w('a', WEEK[5], 'swim', 45), w('b', WEEK[5], 'bike', 120)));
    expect(two).toContain('yw-chips pair');
    expect((two.match(/class="yw-chip"/g) || []).length).toBeGreaterThanOrEqual(2);
    const three = html(planOf(w('a', WEEK[5], 'swim', 45), w('b', WEEK[5], 'bike', 120), w('c', WEEK[5], 'run', 30)));
    expect(three).toContain('+1');
  });

  it('a rest day gets the recessed chip and an em dash, not an empty cell', () => {
    const out = html(planOf(w('a', WEEK[0], 'run', 60)));
    expect(out).toContain('yw-chip rest');
    expect(out).toContain('—');
  });

  it('a race day keeps its own treatment', () => {
    const out = html(planOf(w('r', WEEK[6], 'run', 90, { race: true, title: 'Olympic' })));
    expect(out).toContain('yw-chip race');
  });
});

describe('the card around the strip', () => {
  it('carries both stat tiles, done over planned', () => {
    const out = html(planOf(w('a', WEEK[0], 'run', 60), w('b', WEEK[5], 'bike', 120)), { log: { a: { done: true } } });
    expect(out).toContain('Hours');
    expect(out).toContain('TSS');
    expect(out).toContain('yw-stat-val');
  });

  it('names what is next, and never today\'s own session', () => {
    const out = html(planOf(w('today', TODAY, 'run', 60), w('sat', WEEK[5], 'bike', 120)));
    expect(out).toContain('Up next');
    expect(out).toContain('SATURDAY');
    expect(out).toContain('bike session');
    expect(out).not.toMatch(/Up next[^<]*<[^>]*>[^<]*run session/);
  });

  it('drops the up-next row entirely when the week is spent', () => {
    const out = html(planOf(w('a', WEEK[0], 'run', 60)));
    expect(out).not.toContain('Up next');
  });

  it('shows the week\'s own facts as chips, or none', () => {
    const out = html(planOf(w('l', WEEK[5], 'bike', 180, { role: 'long' })));
    expect(out).toContain('Sat is the long ride');
    const everyDay = WEEK.map((d, i) => w('w' + i, d, 'run', 60));
    expect(html(planOf(...everyDay))).not.toContain('yw-note');
  });

  it('renders nothing at all without a plan week to strip', () => {
    expect(html({ totalWeeks: 0, weeks: [] })).toBe('');
  });
});

describe('the interactions the mockup has no markup for', () => {
  it('every day cell is reachable by keyboard and speaks its own state', () => {
    const out = html(planOf(w('a', WEEK[0], 'run', 60, { title: 'Easy run' })), { log: { a: { done: true } } });
    expect((out.match(/role="button"/g) || []).length).toBeGreaterThanOrEqual(8); // 7 days + the head
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('aria-label="Monday: Easy run, done"');
    expect(out).toContain('rest day');
  });

  it('tapping a day opens that day\'s session, as the plan object', () => {
    const open = vi.fn();
    const plan = planOf(w('sat', WEEK[5], 'bike', 120));
    const { el, cleanup } = mount(plan, { open });
    const sat = el.querySelectorAll('.yw-day')[5];
    act(() => { sat.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(open).toHaveBeenCalledTimes(1);
    // the real workout, not the strip's flattened view of it
    expect(open.mock.calls[0][0]).toBe(plan.weeks[0].workouts[0]);
    cleanup();
  });

  it('the header folds out the rest of the week, and remembers the choice', () => {
    const saveOpen = vi.fn();
    const plan = planOf(w('sat', WEEK[5], 'bike', 120, { title: 'Long ride' }));
    const { el, cleanup } = mount(plan, { saveOpen });
    // counted as ROWS, not by title: the up-next row already names this
    // session while the fold is shut, which is the point of it
    expect(el.querySelectorAll('.wk').length).toBe(0);
    act(() => { el.querySelector('.yw-head').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(saveOpen).toHaveBeenCalledWith(true);
    expect(el.querySelectorAll('.wk').length).toBe(1);
    cleanup();
  });

  it('says so when the fold-out has nothing left in it', () => {
    const { el, cleanup } = mount(planOf(w('a', WEEK[0], 'run', 60)), { loadOpen: () => true });
    expect(el.innerHTML).toContain('Nothing more this week');
    cleanup();
  });
});
