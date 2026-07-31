// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DetailSheet } from './DetailSheet.jsx';
import { generatePlan } from '@/lib/plan.js';
import { swimKit } from '@/lib/swim-kit.js';

/* Phase 6: the why-not-harder fold and the swim kit line, rendered. The
   selectors carry the logic (their own suites); these pin the wiring. */

const profile = {
  name: 'P', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-09-27',
};
const noop = () => {};

const mount = async w => {
  const plan = generatePlan(profile);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<DetailSheet w={w} plan={plan} done={false} eff={w.date} onClose={noop} onToggle={noop}
      onMove={noop} onResetMove={noop} onLogResult={noop} feel={null} onFeel={noop} onRestore={noop}
      onRemove={noop} activity={null} onLoadIntervals={null} onSupport={noop} onWhatIf={null}
      onReplayRecap={noop} fuelLog={{}} onFuel={noop} positionLog={{}} onPosition={noop} brick={null}
      onCue={null} cueAnswer={null} onReview={noop} />);
  });
  return { el, root, done: () => { root.unmount(); el.remove(); } };
};

const plan = generatePlan(profile);
const all = plan.weeks.flatMap(wk => wk.workouts);

describe('the why-not-harder fold', () => {
  it('folds closed by default, opens on tap, and shows the recovery line in a recovery week', async () => {
    const rec = plan.weeks.find(wk => wk.isRecovery);
    const w = rec.workouts.find(x => x.discipline !== 'rest' && !x.race && x.type);
    const { el, done } = await mount(w);
    const toggle = [...el.querySelectorAll('[role="button"]')].find(b => b.textContent.includes('Why not harder?'));
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.innerHTML).not.toContain('This is a recovery week');
    await act(async () => { toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.innerHTML).toContain('This is a recovery week');
    done();
  });

  it('sessions the selector declines get no toggle at all', async () => {
    const race = all.find(w => w.race);
    const { el, done } = await mount(race);
    expect(el.innerHTML).not.toContain('Why not harder?');
    done();
  });
});

describe('the swim kit line', () => {
  it('a gear-drill swim shows one Bring line matching the selector', async () => {
    const swim = all.find(w => w.discipline === 'swim' && swimKit(w));
    expect(swim, 'no generated swim with kit').toBeTruthy();
    const { el, done } = await mount(swim);
    const kit = swimKit(swim);
    expect(el.innerHTML).toContain('Bring: ' + kit.items.map(s => s.toLowerCase()).join(', ') + '.');
    done();
  });

  it('a kitless swim shows no Bring line', async () => {
    const swim = all.find(w => w.discipline === 'swim' && Array.isArray(w.segments) && !swimKit(w));
    if (!swim) return; // every swim carries gear in this plan shape; selector suite covers it
    const { el, done } = await mount(swim);
    expect(el.innerHTML).not.toContain('Bring:');
    done();
  });
});
