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
