// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ProgressView } from './ProgressView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { iso } from '@/lib/date.js';

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
      disciplines: { run: { decision: 'hold', headline: 'Doing its job', evidence: [{ signal: 'late-session durability', reading: 'your long session held up strongly to the end' }], clean: true } },
      progression: null,
    };
    const html = await mount({ plan, activities: null, coach });
    expect(html).toContain('This week so far');
    // evidence must actually RENDER: it shipped once as data with no UI
    // consumer, and only inspection caught it (gauntlet 2026-07-20)
    expect(html).toContain('held up strongly to the end');
    expect(html).toContain('late-session durability');
  });

  it('renders durability rows with honest per-discipline wording', async () => {
    const plan = generatePlan(profile);
    const durability = [
      { activityId: 'r1', date: '2026-07-14', discipline: 'run', durationMin: 95, read: { band: 'held-strong', outputDropPct: 2.1, hrDriftPct: 3.0, efDropPct: null, hrMissing: false } },
      { activityId: 'b1', date: '2026-07-12', discipline: 'bike', durationMin: 160, read: { band: 'faded-a-little', outputDropPct: 5.2, hrDriftPct: null, efDropPct: null, hrMissing: true } },
    ];
    const html = await mount({ plan, activities: null, durability });
    expect(html).toContain('Durability');
    expect(html).toContain('slower late');          // run wording is pace
    expect(html).toContain('power ~5.2% down late'); // bike wording is power
    expect(html).toContain('no heart rate data');    // hrMissing says so
  });

  it('tracker mode renders', async () => {
    const t = buildTrackerPlan(generatePlan(profile), '2026-07-13T10:00:00.000Z');
    const html = await mount({ plan: t, activities: [run('2026-07-14', 8)] });
    expect(html).toContain('Run volume');
  });
});

describe('the body mass card is safety-gated', () => {
  const weighIns = kg => Array.from({ length: 30 }, (_, i) => ({
    date: iso(new Date(Date.now() - (29 - i) * 864e5)), weightKg: kg + ((i * 37 % 13) - 6) / 20,
  }));

  it('without a goal: averages and a chart, no pill, no rate, no judgment words', async () => {
    const html = await mount({ plan: generatePlan(profile), activities: null, wellness: weighIns(70) });
    expect(html).toContain('Body mass');
    expect(html).toContain('7-day average');
    expect(html).not.toContain('target range');
    expect(html).not.toContain('g a week');
    expect(html).not.toMatch(/gain|loss|under|over the/i);
  });

  it('with a gain goal: the pill and the rate render from one judged number', async () => {
    const plan = generatePlan({ ...profile, massGoal: 'gain' });
    const rising = Array.from({ length: 42 }, (_, i) => ({
      date: iso(new Date(Date.now() - (41 - i) * 864e5)), weightKg: 64 + (i / 41) * 0.8 + ((i * 37 % 13) - 6) / 30,
    }));
    const html = await mount({ plan, activities: null, wellness: rising });
    expect(html).toContain('target range');
    expect(html).toContain('g a week');
    expect(html).toContain('last completed week');
  });

  it('zero weigh-ins renders no card at all', async () => {
    const html = await mount({ plan: generatePlan(profile), activities: null, wellness: [] });
    expect(html).not.toContain('Body mass');
  });
});
