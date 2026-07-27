// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CssProposalSheet } from './CssProposalSheet.jsx';
import { CssRetestSheet } from './CssRetestSheet.jsx';
import { generatePlan } from '@/lib/plan.js';
import { eftpProposal } from '@/lib/eftp.js';

/* Phase 3b sheets. The proposal sheet is the accept gate for a swim
   retarget, so the load-bearing facts are: the evidence renders, accepting
   fires the retarget exactly once, and declining fires nothing. */

const base = {
  name: 'S', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 320, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
};
const plan = generatePlan(base);
const proposal = eftpProposal({
  activities: [], plan, todayISO: '2026-06-10', thresholds: null,
  cssTest: { actId: 'a1', date: '2026-06-10', test: { css100Sec: 112, t400Sec: 420, t200Sec: 196, d400: 400, d200: 200 } },
});

const mount = async ui => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(ui); });
  const clickText = text => {
    const node = [...el.querySelectorAll('button')].find(n => n.textContent.trim() === text);
    if (node) act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    return !!node;
  };
  return { el, clickText, cleanup: () => { root.unmount(); el.remove(); } };
};

describe('CssProposalSheet', () => {
  it('shows the full evidence and retargets only on accept', async () => {
    let accepted = 0, closed = 0;
    const m = await mount(<CssProposalSheet proposal={proposal} plan={plan}
      onAccept={() => { accepted++; }} onClose={() => { closed++; }} />);
    const html = m.el.innerHTML;
    expect(html).toContain('2:00');            // current CSS
    expect(html).toContain('1:52');            // proposed
    expect(html).toContain('faster');          // direction with percent
    expect(html).toContain('400/200 test');    // source in words
    expect(m.clickText('Retarget my plan')).toBe(true);
    expect(accepted).toBe(1);
    expect(closed).toBe(1);
    m.cleanup();
  });

  it('declining closes without touching the plan', async () => {
    let accepted = 0, closed = 0;
    const m = await mount(<CssProposalSheet proposal={proposal} plan={plan}
      onAccept={() => { accepted++; }} onClose={() => { closed++; }} />);
    expect(m.clickText('Not now')).toBe(true);
    expect(accepted).toBe(0);
    expect(closed).toBe(1);
    m.cleanup();
  });
});

describe('CssRetestSheet', () => {
  const rec = { headline: 'Verify your swim CSS', why: 'Your CSS came from a hand entry.', sig: 's' };

  it('points at the scheduled test instead of offering to add another', async () => {
    // the sheet reads the real clock, so use a plan far enough in the future
    // that its scheduled swim test is always upcoming
    const future = generatePlan({ ...base, startDate: '2126-06-01', raceDate: '2126-09-27' });
    expect(future.weeks.flatMap(w => w.workouts).some(w => w.test && w.testKind === 'swimCss')).toBe(true);
    const m = await mount(<CssRetestSheet recommendation={rec} plan={future}
      onAddTest={() => {}} onEditFitness={() => {}} onClose={() => {}} />);
    expect(m.el.innerHTML).toContain('already has this test scheduled');
    expect([...m.el.querySelectorAll('button')].some(b => b.textContent.includes('Add the test'))).toBe(false);
    m.cleanup();
  });

  it('offers to add the test when none is coming, and explains the protocol in pool units', async () => {
    // a plan wholly in the past has no upcoming test
    let added = 0;
    const past = generatePlan({ ...base, startDate: '2020-06-01', raceDate: '2020-09-27' });
    const m = await mount(<CssRetestSheet recommendation={rec} plan={past}
      onAddTest={() => { added++; }} onEditFitness={() => {}} onClose={() => {}} />);
    expect(m.el.innerHTML).toContain('400 m all out');
    expect(m.el.innerHTML).toContain('divided');
    expect(m.clickText('Add the test to this week')).toBe(true);
    expect(added).toBe(1);
    m.cleanup();
  });

  it('speaks yards to a yard athlete', async () => {
    const yplan = generatePlan({ ...base, startDate: '2020-06-01', raceDate: '2020-09-27', pool: { length: 25, unit: 'yards' } });
    const m = await mount(<CssRetestSheet recommendation={rec} plan={yplan}
      onAddTest={() => {}} onEditFitness={() => {}} onClose={() => {}} />);
    expect(m.el.innerHTML).toContain('400 yd all out');
    m.cleanup();
  });
});
