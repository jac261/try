// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { FitnessEditor } from './FitnessEditor.jsx';

/* The body-mass goal chooser is safety-sensitive: No goal exists to stop
   judgment, so a returning athlete must be able to see and clear an active
   goal without hunting for it (gauntlet catch 2026-07-22). */

const base = {
  name: 'F', fitness: 'intermediate', fivekSec: 1500, css100Sec: 110,
  ftp: 250, weightKg: 70, trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
};

const mount = async profile => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  let saved = null;
  await act(async () => {
    root.render(<FitnessEditor profile={profile} onClose={() => {}} onSave={f => { saved = f; }} />);
  });
  const click = text => {
    const nodes = [...el.querySelectorAll('.opt, a.reset, button.primary')];
    const node = nodes.find(n => n.textContent.trim().startsWith(text));
    if (node) act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    return !!node;
  };
  return { el, root, get saved() { return saved; }, click, cleanup: () => { root.unmount(); el.remove(); } };
};

describe('FitnessEditor body-mass goal chooser', () => {
  it('stays collapsed for an athlete with no goal', async () => {
    const m = await mount({ ...base, massGoal: null });
    expect(m.el.innerHTML).toContain('Body-mass goal (optional)');
    expect(m.el.innerHTML).not.toContain('Holding steady');
    m.cleanup();
  });

  it('opens with the current selection visible when a goal is already set', async () => {
    const m = await mount({ ...base, massGoal: 'hold' });
    // no discovery tap needed: the chooser is open and the active option shown
    expect(m.el.innerHTML).not.toContain('Body-mass goal (optional)');
    expect(m.el.innerHTML).toContain('Holding steady');
    const holdOpt = [...m.el.querySelectorAll('.opt')].find(n => n.textContent.startsWith('Holding steady'));
    expect(holdOpt.className).toContain('on');
    m.cleanup();
  });

  it('all three options render and hold round-trips through onSave', async () => {
    const m = await mount({ ...base, massGoal: 'hold' });
    ['No goal', 'Holding steady', 'Gaining on purpose'].forEach(t =>
      expect(m.el.textContent).toContain(t));
    m.click('Save');
    expect(m.saved.massGoal).toBe('hold');
    m.cleanup();
  });

  it('clearing an active goal to No goal is one visible tap', async () => {
    const m = await mount({ ...base, massGoal: 'gain' });
    expect(m.click('No goal')).toBe(true); // already visible, no expand first
    m.click('Save');
    expect(m.saved.massGoal).toBe(null);
    m.cleanup();
  });
});

describe('FitnessEditor pool control', () => {
  it('a yard pool labels the CSS field per 100 yd and shows the stored css converted', async () => {
    // css100Sec is canonical per 100 m; a 25 yd athlete should see it per 100 yd
    const m = await mount({ ...base, css100Sec: 120, pool: { length: 25, unit: 'yards' } });
    expect(m.el.textContent).toContain('Swim pace per 100 yd');
    const css = m.el.querySelector('input[value]');
    // 120 s/100m displays as ~1:50 /100yd (120 * 0.9144)
    const shown = [...m.el.querySelectorAll('input')].map(i => i.value).join(' ');
    expect(shown).toMatch(/1:50|1:49/);
    m.cleanup();
  });

  it('saves the per-100-unit entry back as canonical per-100 m', async () => {
    // enter a yard time; it must store SLOWER per 100 m, not verbatim
    const m = await mount({ ...base, css100Sec: null, pool: { length: 25, unit: 'yards' } });
    const cssInput = [...m.el.querySelectorAll('input')].find(i => /100 yd/.test(i.closest('label').textContent));
    act(() => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(cssInput, '1:50'); cssInput.dispatchEvent(new Event('input', { bubbles: true })); });
    m.click('Save');
    // 1:50/100yd (110s) -> ~120 s/100m canonical, never stored as 110
    expect(m.saved.css100Sec).toBeGreaterThan(118);
    expect(m.saved.css100Sec).toBeLessThan(122);
    expect(m.saved.pool).toEqual({ length: 25, unit: 'yards' });
  });

  it('a metre pool is unchanged: field says per 100 m and stores verbatim', async () => {
    const m = await mount({ ...base, css100Sec: 120, pool: { length: 25, unit: 'metres' } });
    expect(m.el.textContent).toContain('Swim pace per 100 m');
    m.click('Save');
    expect(m.saved.css100Sec).toBe(120);
    m.cleanup();
  });
});

describe('FitnessEditor custom pool length (phase 2b)', () => {
  it('the Custom option reveals a length input and saves a custom pool', async () => {
    const m = await mount({ ...base, pool: { length: 25, unit: 'metres' } });
    expect(m.click('Custom')).toBe(true);
    const lenInput = [...m.el.querySelectorAll('input')].find(i => i.placeholder === 'e.g. 33');
    expect(lenInput).toBeTruthy();
    act(() => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(lenInput, '33'); lenInput.dispatchEvent(new Event('input', { bubbles: true })); });
    m.click('Save');
    expect(m.saved.pool).toEqual({ length: 33, unit: 'metres' });
    m.cleanup();
  });

  it('an out-of-range custom length never saves a partial (falls back)', async () => {
    const m = await mount({ ...base, pool: { length: 25, unit: 'metres' } });
    m.click('Custom');
    const lenInput = [...m.el.querySelectorAll('input')].find(i => i.placeholder === 'e.g. 33');
    act(() => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(lenInput, '5'); lenInput.dispatchEvent(new Event('input', { bubbles: true })); });
    m.click('Save');
    // 5 is below the 10-100 range, so the pool stays the last valid one, never {length:5}
    expect(m.saved.pool.length).not.toBe(5);
    m.cleanup();
  });
});

