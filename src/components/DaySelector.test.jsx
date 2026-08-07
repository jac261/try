// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DaySelector } from './DaySelector.jsx';

/* The selector's first test file (audit 2026-08-07): the min-3 floor and the
   long-day reassignment were both silent side effects, and the two letter
   rows were fourteen unlabeled buttons to assistive tech. */

const mount = async (days, longDay, onChange = () => {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const render = (d, l) => act(async () => root.render(<DaySelector days={d} longDay={l} onChange={onChange} />));
  await render(days, longDay);
  return { el, render, done: async () => { await act(async () => root.unmount()); el.remove(); } };
};
const trainRow = el => [...el.querySelectorAll('.days')][0].querySelectorAll('.d');
const longRow = el => [...el.querySelectorAll('.days')][1].querySelectorAll('.d');

beforeEach(() => { document.body.innerHTML = ''; });

describe('DaySelector', () => {
  it('cells carry full day names, their row purpose, and a pressed state', async () => {
    const { el, done } = await mount([0, 1, 5], 5);
    const cells = trainRow(el);
    expect(cells[1].getAttribute('aria-label')).toBe('Train on Tuesday');
    expect(cells[3].getAttribute('aria-label')).toBe('Train on Thursday');   // the other T
    expect(cells[1].getAttribute('aria-pressed')).toBe('true');
    expect(cells[3].getAttribute('aria-pressed')).toBe('false');
    const lg = longRow(el);
    expect(lg[5].getAttribute('aria-label')).toBe('Long session on Saturday');
    expect(lg[5].getAttribute('aria-pressed')).toBe('true');
    expect(lg[2].getAttribute('aria-disabled')).toBe('true');   // not a training day
    await done();
  });

  it('the min-3 floor refuses out loud instead of silently no-oping', async () => {
    const onChange = vi.fn();
    const { el, done } = await mount([0, 1, 5], 5, onChange);
    await act(async () => { trainRow(el)[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onChange).not.toHaveBeenCalled();                    // the floor held
    expect(el.textContent).toContain('At least 3 training days');
    expect(el.querySelector('[aria-live]')).toBeTruthy();       // and it is spoken
    await done();
  });

  it('deselecting the long day reassigns it and says so', async () => {
    const onChange = vi.fn();
    const { el, render, done } = await mount([0, 1, 4, 5], 5, onChange);
    await act(async () => { trainRow(el)[5].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // Saturday left the set; Sunday is absent, so the last remaining day wins
    expect(onChange).toHaveBeenCalledWith([0, 1, 4], 4);
    await render([0, 1, 4], 4);
    expect(el.textContent).toContain('Saturday was your long day, so it moved to Friday');
    await done();
  });

  it('an ordinary toggle reports no reassignment', async () => {
    const onChange = vi.fn();
    const { el, done } = await mount([0, 1, 4, 5], 5, onChange);
    await act(async () => { trainRow(el)[2].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith([0, 1, 2, 4, 5], 5);
    expect(el.textContent).not.toContain('moved to');
    await done();
  });
});
