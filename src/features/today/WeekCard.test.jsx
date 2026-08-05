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

  it('shows ONE chip on a double day and counts the rest', () => {
    /* Two chips side by side overflowed the cell even shrunk to 21px — a day
       is about 39px wide on a phone (Jon, 2026-08-04). Counted inside the
       STRIP: the up-next row wears a chip of its own, which is what made the
       first version of this assertion pass while the bug was live. */
    // counted in the SATURDAY cell: the rest days wear a chip of their own,
    // and so does the up-next row
    const sat = m => m.el.querySelectorAll('.yw-day')[5];
    const two = mount(planOf(w('a', WEEK[5], 'swim', 45), w('b', WEEK[5], 'bike', 120)));
    expect(sat(two).querySelectorAll('.yw-chip').length).toBe(1);
    expect(two.el.querySelector('.yw-chips.pair')).toBe(null);
    expect(sat(two).querySelector('.yw-more').textContent).toBe('+1');
    two.cleanup();
    const three = mount(planOf(w('a', WEEK[5], 'swim', 45), w('b', WEEK[5], 'bike', 120), w('c', WEEK[5], 'run', 30)));
    expect(sat(three).querySelectorAll('.yw-chip').length).toBe(1);
    expect(sat(three).querySelector('.yw-more').textContent).toBe('+2');
    three.cleanup();
  });

  it('prints the day duration compactly, so it fits the cell', () => {
    // "1h 55m" was the widest thing in a 39px cell; "1:55" is four characters.
    // The up-next row keeps the long form — it has a whole line to itself.
    const m = mount(planOf(w('a', WEEK[5], 'bike', 115)));
    const mins = [...m.el.querySelectorAll('.yw-min')].map(e => e.textContent);
    expect(mins).toContain('1:55');
    expect(mins.some(x => /h /.test(x))).toBe(false);
    m.cleanup();
    const short = mount(planOf(w('b', WEEK[5], 'run', 45)));
    expect([...short.el.querySelectorAll('.yw-min')].map(e => e.textContent)).toContain('45');
    short.cleanup();
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
  it('a day with a session is reachable by keyboard; a rest day is inert', () => {
    const out = html(planOf(w('a', WEEK[0], 'run', 60, { title: 'Easy run' })), { log: { a: { done: true } } });
    // exactly one tappable cell here — the header is no longer a button and
    // the six rest days have nothing to open
    expect((out.match(/role="button"/g) || []).length).toBe(1);
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('aria-label="Monday: Easy run, done"');
    // inert, but still ANNOUNCED: an aria-label on a role-less div is
    // ignored by most screen readers, so role="img" carries it
    expect(out).toContain('yw-day inert');
    expect(out).toContain('rest day');
    expect(out).toMatch(/role="img"[^>]*aria-label="[^"]*rest day|aria-label="[^"]*rest day[^>]*"[^>]*role="img"/);
  });

  it('tapping a day opens its KEY session, as the plan object', () => {
    const open = vi.fn();
    // the volume double: the tempo is the day, the endurance ride hangs off it
    const plan = planOf(
      w('tempo', WEEK[5], 'bike', 55, { type: 'Tempo', role: 'quality' }),
      w('vol', WEEK[5], 'bike', 40, { type: 'Endurance', second: true }),
    );
    const { el, cleanup } = mount(plan, { open });
    act(() => { el.querySelectorAll('.yw-day')[5].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(open).toHaveBeenCalledTimes(1);
    // the real workout, not the strip's flattened view — and the tempo, not
    // whichever the generator happened to emit first
    expect(open.mock.calls[0][0]).toBe(plan.weeks[0].workouts[0]);
    expect(open.mock.calls[0][0].id).toBe('tempo');
    cleanup();
  });

  it('a rest day tap does nothing at all', () => {
    const open = vi.fn();
    const { el, cleanup } = mount(planOf(w('a', WEEK[0], 'run', 60)), { open });
    act(() => { el.querySelectorAll('.yw-day')[3].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(open).not.toHaveBeenCalled();
    cleanup();
  });


});
