// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ProgressView } from './ProgressView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';

/* A render smoke test for the Progress tab. It exists because the run pass
   briefly shipped JSX referencing variables a dropped write never declared:
   the suite stayed green while opening the tab crashed the app (gauntlet
   catch 2026-07-18). Every mode renders here, so that class of failure can
   never pass again. */

const profile = {
  name: 'P', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
  startDate: '2026-06-01', raceDate: '2026-08-30',
};

const mount = async props => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<ProgressView log={{}} wellness={[]} runLoad={null} recovery={null} onSupport={() => {}} {...props} />); });
  const html = el.innerHTML;
  root.unmount(); el.remove();
  return html;
};

const run = (date, km) => ({ id: 'r' + date, type: 'Run', date, movingTimeSec: 3000, distance: km * 1000 });

describe('ProgressView renders in every mode', () => {
  it('plan mode with activities: projections and the volume chart appear', async () => {
    const html = await mount({ plan: generatePlan(profile), activities: [run('2026-07-14', 8), run('2026-07-07', 12)] });
    expect(html).toContain('Race projections');
    expect(html).toContain('Half marathon');
    expect(html).toContain('Run volume');
  });

  it('plan mode with no activities: no volume chart, no crash', async () => {
    const html = await mount({ plan: generatePlan(profile), activities: null });
    expect(html).toContain('Race projections');
    expect(html).not.toContain('Run volume');
  });

  it('no real 5k time: no projections block at all', async () => {
    const html = await mount({ plan: generatePlan({ ...profile, fivekSec: null }), activities: null });
    expect(html).not.toContain('Race projections');
  });

  it('renders the coach week rows when a decision is passed', async () => {
    const plan = generatePlan(profile);
    const coach = {
      weekMonday: '2026-07-13', ruleVersion: 1, tracker: false,
      overall: { decision: 'hold', headline: 'Hold steady. This workload is doing its job', evidence: [], conflicting: [] },
      disciplines: { run: { decision: 'hold', headline: 'Hold steady', evidence: [], clean: true } },
      progression: null,
    };
    const html = await mount({ plan, activities: null, coach });
    expect(html).toContain('This week so far');
    expect(html).toContain('Hold steady');
  });

  it('tracker mode renders', async () => {
    const t = buildTrackerPlan(generatePlan(profile), '2026-07-13T10:00:00.000Z');
    const html = await mount({ plan: t, activities: [run('2026-07-14', 8)] });
    expect(html).toContain('Run volume');
  });
});
