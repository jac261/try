// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PlanSettingsEditor } from './PlanSettingsEditor.jsx';
import { iso, addDays } from '@/lib/date.js';

/* The editor's first test file. It is the input side of reshapePlan — a full
   plan replace — and every clause below was audit-flagged untested
   (2026-08-07): the save gate, the maintenance dead-end, the tune-up rules,
   and the payload's solo clauses. */

const todayISO = iso(new Date());
const profile = (over = {}) => ({
  raceType: 'olympic', raceDate: iso(addDays(new Date(), 8 * 7)),
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5, ...over,
});

const mount = async (prof, onSave = () => {}) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<PlanSettingsEditor profile={prof} onClose={() => {}} onSave={onSave} />);
  });
  return { el, done: async () => { await act(async () => root.unmount()); el.remove(); } };
};
const opt = (el, name) => [...el.querySelectorAll('.opt')].find(o => o.textContent.includes(name));
const save = el => [...el.querySelectorAll('button')].find(b => b.textContent.includes('Save & rebuild'));
const typeInto = async (input, v) => act(async () => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => { document.body.innerHTML = ''; });

describe('a maintenance plan edits like the fresh choice it is', () => {
  it('starts with no race selected, save disabled, and the default date', async () => {
    /* Maintenance appears in NEITHER pill list, so initialising raceType
       with it left nothing selected while Save stayed enabled — and the
       prefilled date was the roll's synthetic horizon Sunday, at most 14
       days away at the exact moment the extend card routes athletes here. */
    const { el, done } = await mount(profile({
      raceType: 'maintenance', raceDate: iso(addDays(new Date(), 10)),
    }));
    expect([...el.querySelectorAll('.opt.on')]).toHaveLength(0);
    expect(save(el).disabled).toBe(true);
    expect(el.textContent).toContain('Pick a race distance');
    expect(el.querySelector('input[type="date"]').value).toBe(iso(addDays(new Date(), 12 * 7)));
    await done();
  });

  it('a race plan keeps its own selection and date', async () => {
    const p = profile();
    const { el, done } = await mount(p);
    expect(opt(el, 'Olympic').className).toContain('on');
    expect(save(el).disabled).toBe(false);
    expect(el.querySelector('input[type="date"]').value).toBe(p.raceDate);
    await done();
  });
});

describe('the save gate refuses what generation cannot build', () => {
  it('an empty race date blocks save and says so', async () => {
    /* generatePlan with raceDate '' returned a zero-week NaN plan without
       throwing, and that husk was pushed to the server. */
    const onSave = vi.fn();
    const { el, done } = await mount(profile(), onSave);
    await typeInto(el.querySelector('input[type="date"]'), '');
    expect(save(el).disabled).toBe(true);
    expect(el.textContent).toContain('Pick a race date');
    await act(async () => { save(el).click(); });
    expect(onSave).not.toHaveBeenCalled();
    await done();
  });

  it('a past race date blocks save: min= only constrains the picker', async () => {
    /* Reachable without typing: post-race, the prefill IS the past date,
       and saving rebuilt a dead plan while wholesale-clearing real overlay
       data. */
    const onSave = vi.fn();
    const { el, done } = await mount(profile({ raceDate: iso(addDays(new Date(), -3)) }), onSave);
    expect(save(el).disabled).toBe(true);
    expect(el.textContent).toContain('already passed');
    await done();
  });

  it('a tune-up with a kind but no date blocks save instead of vanishing', async () => {
    /* It used to be silently discarded: the sheet closed as if it saved,
       and the athlete trained believing a mini-taper was coming. */
    const onSave = vi.fn();
    const { el, done } = await mount(profile(), onSave);
    await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent.includes('Add a tune-up')).click(); });
    expect(save(el).disabled).toBe(true);
    expect(el.textContent).toContain('Pick a date for the tune-up');
    // removing it un-blocks
    await act(async () => { [...el.querySelectorAll('a')].find(a => a.textContent.includes('Remove the tune-up')).click(); });
    expect(save(el).disabled).toBe(false);
    await done();
  });

  it('a tune-up after the goal race blocks save: the boundary has two sides', async () => {
    const p = profile({ bRaces: [{ kind: 'sprint', date: iso(addDays(new Date(), 10 * 7)) }] });
    const { el, done } = await mount(p);
    // pull the goal race BEFORE the tune-up: max= cannot re-validate a value
    // that is already entered
    await typeInto(el.querySelector('input[type="date"]'), iso(addDays(new Date(), 6 * 7)));
    expect(save(el).disabled).toBe(true);
    expect(el.textContent).toContain('after your goal race');
    await done();
  });

  it('the inside-the-taper warning still fires and still allows save', async () => {
    // the original tuneTooClose behaviour is advice, not a gate: generation
    // protects the taper by skipping the event, and the copy says so
    const p = profile({ bRaces: [{ kind: 'sprint', date: iso(addDays(new Date(), 8 * 7 - 5)) }] });
    const { el, done } = await mount(p);
    expect(el.textContent).toContain('protect the taper');
    expect(save(el).disabled).toBe(false);
    await done();
  });
});

describe('the payload', () => {
  it('switching to a solo race nulls the exclusion and the focus, and keeps only compatible tune-ups', async () => {
    const onSave = vi.fn();
    const p = profile({ excludedDiscipline: 'swim', blockFocus: 'bike', bRaces: [{ kind: 'sprint', date: iso(addDays(new Date(), 5 * 7)) }] });
    const { el, done } = await mount(p, onSave);
    await act(async () => { opt(el, 'Half Marathon').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // the tri tune-up dropped VISIBLY: the section collapsed to its add button
    expect(el.textContent).toContain('Add a tune-up race');
    await act(async () => { save(el).click(); });
    const payload = onSave.mock.calls[0][0];
    expect(payload.raceType).toBe('runhalf');
    expect(payload.excludedDiscipline).toBe(null);
    expect(payload.blockFocus).toBe(null);
    expect(payload.bRaces).toEqual([]);
    await done();
  });

  it('daysPerWeek is derived from the chosen days', async () => {
    const onSave = vi.fn();
    const { el, done } = await mount(profile(), onSave);
    await act(async () => { save(el).click(); });
    const payload = onSave.mock.calls[0][0];
    expect(payload.daysPerWeek).toBe(payload.trainingDays.length);
    expect(payload.trainingDays).toEqual([0, 1, 3, 5, 6]);
    await done();
  });
});
