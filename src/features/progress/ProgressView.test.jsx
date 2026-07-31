// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ProgressView } from './ProgressView.jsx';
import { generatePlan, buildTrackerPlan } from '@/lib/plan.js';
import { powerCurve, CURVE_DURATIONS } from '@/lib/bike-power-curve.js';
import { iso, addDays } from '@/lib/date.js';

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

/* Phase 3: Progress is tabbed, so assertions live on the tab where their
   subject renders. mount(props) captures the DEFAULT tab (Overview, or the
   discipline on a solo plan); mount(props, 'Run') clicks that tab first. */
const mount = async (props, tabLabel) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<ProgressView log={{}} wellness={[]} runLoad={null} recovery={null} onSupport={() => {}} {...props} />); });
  if (tabLabel) {
    const btn = [...el.querySelectorAll('[role="tab"]')].find(b => b.textContent === tabLabel);
    // A missing tab THROWS rather than silently capturing the default tab:
    // with a silent no-op, every absence assertion below would hold
    // vacuously against the wrong panel the day a tab breaks or renames
    // (gauntlet 2026-07-30).
    if (!btn) { root.unmount(); el.remove(); throw new Error('no tab labelled "' + tabLabel + '" rendered'); }
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  }
  const html = el.innerHTML;
  root.unmount(); el.remove();
  return html;
};

const run = (date, km) => ({ id: 'r' + date, type: 'Run', date, movingTimeSec: 3000, distance: km * 1000 });

describe('ProgressView renders in every mode', () => {
  it('plan mode with activities: projections on Overview, the volume chart on Run', async () => {
    const acts = [run('2026-07-14', 8), run('2026-07-07', 12)];
    const overview = await mount({ plan: generatePlan(profile), activities: acts });
    expect(overview).toContain('Race projections'); // nested in the fitness card, every mode
    expect(overview).toContain('Half marathon');
    const runTab = await mount({ plan: generatePlan(profile), activities: acts }, 'Run');
    expect(runTab).toContain('Run volume');
  });

  it('plan mode with no activities: no volume chart, no crash', async () => {
    const html = await mount({ plan: generatePlan(profile), activities: null }, 'Run');
    expect(html).not.toContain('Run volume');
  });

  it('no real 5k time: no projections block at all', async () => {
    // asserted on the tab where it WOULD render, so the absence is honest
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

  it('the coach week survives a SOLO plan (fails on main: it nested inside the weakest-link card)', async () => {
    /* The weakest-link card early-returns on solo plans — three bars need
       three sports — and the coach's whole weekly verdict was nested inside
       it, so a solo runner never saw "This week so far" at all. The verdict
       is orchestration; it must not die with a bar chart that has nothing
       to compare. */
    const solo = generatePlan({ ...profile, raceType: 'runhalf' });
    const coach = {
      weekMonday: '2026-07-13', ruleVersion: 1, tracker: false,
      overall: { decision: 'hold', headline: 'Hold steady', evidence: [], conflicting: [] },
      disciplines: { run: { decision: 'progress', headline: 'Earned it', evidence: [{ signal: 'key sessions', reading: 'both quality runs landed on target' }], clean: true } },
      progression: null,
    };
    // a solo plan opens on its discipline tab (spec rule); the coach week
    // is orchestration, so it lives on Overview — click across to it
    const html = await mount({ plan: solo, activities: null, coach }, 'Overview');
    expect(html).not.toContain('Weakest link');          // the bars stay solo-suppressed
    expect(html).toContain('This week so far');          // the verdict does not
    expect(html).toContain('both quality runs landed on target');
  });

  const DURABILITY_FIXTURE = [
    { activityId: 'r1', date: '2026-07-14', discipline: 'run', durationMin: 95, read: { band: 'held-strong', outputDropPct: 2.1, hrDriftPct: 3.0, efDropPct: null, hrMissing: false } },
    { activityId: 'b1', date: '2026-07-12', discipline: 'bike', durationMin: 160, read: { band: 'faded-a-little', outputDropPct: 5.2, hrDriftPct: null, efDropPct: null, hrMissing: true } },
    { activityId: 's1', date: '2026-07-11', discipline: 'swim', durationMin: 55, read: { band: 'held-strong', outputDropPct: 1.4, hrDriftPct: null, efDropPct: null, hrMissing: true } },
  ];

  it('durability lives in each discipline tab, wording honest to that discipline', async () => {
    const plan = generatePlan(profile);
    const run = await mount({ plan, activities: null, durability: DURABILITY_FIXTURE }, 'Run');
    expect(run).toContain('Durability');
    expect(run).toContain('how the long runs ended');
    expect(run).toContain('slower late');            // run wording is pace
    expect(run).not.toContain('power ~5.2% down late');  // the ride is not here

    const bike = await mount({ plan, activities: null, durability: DURABILITY_FIXTURE }, 'Bike');
    expect(bike).toContain('how the long rides ended');
    expect(bike).toContain('power ~5.2% down late'); // bike wording is power
    expect(bike).toContain('no heart rate data');    // hrMissing says so
    expect(bike).not.toContain('slower late');

    const swim = await mount({ plan, activities: null, durability: DURABILITY_FIXTURE }, 'Swim');
    expect(swim).toContain('how the long swims ended');
    expect(swim).toContain('Swim ·');                // its own row label
    expect(swim).toContain('no heart rate data');    // pool HR absent, said plainly
  });

  it('Overview no longer carries durability when the discipline has its own tab', async () => {
    const plan = generatePlan(profile);
    const overview = await mount({ plan, activities: null, durability: DURABILITY_FIXTURE });
    expect(overview).not.toContain('Durability');
  });

  it('a discipline with no tab keeps its card on Overview', async () => {
    // solo run plan: swim and bike have no tab, so a run card must still
    // appear somewhere rather than vanishing with the tab that never existed
    const plan = generatePlan({ ...profile, raceType: 'run10k' });
    // a solo plan opens on its own discipline, so ask for Overview by name
    const html = await mount({ plan, activities: null, durability: DURABILITY_FIXTURE }, 'Overview');
    expect(html).toContain('Durability');
    expect(html).toContain('how the long rides ended');  // bike has no tab here
    expect(html).toContain('how the long swims ended');  // nor does swim
    expect(html).not.toContain('how the long runs ended'); // run has one, so it is not here

    // and the run card is on the Run tab, not lost with the fallback
    const run = await mount({ plan, activities: null, durability: DURABILITY_FIXTURE }, 'Run');
    expect(run).toContain('how the long runs ended');
  });

  it('maintenance block: the countdown speaks in block weeks, never race day', async () => {
    const plan = generatePlan({ ...profile, raceType: 'maintenance', horizonWeeks: 12 });
    const html = await mount({ plan, activities: null });
    expect(html).toContain('Left in the block');
    expect(html).toContain('weeks');
    // its raceDate is just the block's horizon (RACES.maintenance), so the
    // race-countdown label must not appear
    expect(html).not.toContain('Until race day');
  });

  it('tracker mode renders the pre-tab page: no tabs, no panels, old order', async () => {
    const t = buildTrackerPlan(generatePlan(profile), '2026-07-13T10:00:00.000Z');
    const html = await mount({ plan: t, activities: [run('2026-07-14', 8)] });
    expect(html).toContain('Run volume');
    // tracker has no tabs: the Overview flow renders bare, per-block gates deciding
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('tabpanel'); // no wrapper divs, empty or otherwise
    // and the discipline-linked blocks sit in their pre-tab positions:
    // projections nested in the fitness card, run volume after it
    // (gauntlet 2026-07-30: the tab split reordered them to the bottom)
    expect(html.indexOf('Race projections')).toBeGreaterThan(-1);
    expect(html.indexOf('Race projections')).toBeLessThan(html.indexOf('Run volume'));
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

  it('hold: little-change pill never wears progress styling; fast loss wears the warning', async () => {
    const steady = Array.from({ length: 42 }, (_, i) => ({
      date: iso(new Date(Date.now() - (41 - i) * 864e5)), weightKg: 64 + ((i * 37 % 13) - 6) / 30,
    }));
    const holdPlan = generatePlan({ ...profile, massGoal: 'hold' });
    const html = await mount({ plan: holdPlan, activities: null, wellness: steady });
    expect(html).toContain('little change');
    expect(html).not.toMatch(/coach-pill progress/); // reporting, never rewarding
    const falling = Array.from({ length: 42 }, (_, i) => ({
      date: iso(new Date(Date.now() - (41 - i) * 864e5)), weightKg: 66 - (i / 41) * 2.2 + ((i * 37 % 13) - 6) / 30,
    }));
    const html2 = await mount({ plan: holdPlan, activities: null, wellness: falling });
    expect(html2).toContain('coming down quickly');
    expect(html2).toMatch(/mass-warn/);
    expect(html2).toContain('someone qualified sees more than a chart does');
  });

  it('a fresh goal stamp shows settling with no rate line', async () => {
    const rising = Array.from({ length: 42 }, (_, i) => ({
      date: iso(new Date(Date.now() - (41 - i) * 864e5)), weightKg: 64 + (i / 41) * 0.8,
    }));
    const plan = generatePlan({ ...profile, massGoal: 'hold' });
    plan.profile.massGoalSetAt = iso(new Date(Date.now() - 2 * 864e5));
    const html = await mount({ plan, activities: null, wellness: rising });
    expect(html).toContain('settling in');
    expect(html).not.toContain('g a week');
  });
});

describe('progress stories (phase 6)', () => {
  // ProgressView reads the real clock, so fixtures use relative dates
  const ago = n => iso(addDays(new Date(), -n));
  const heldRead = n => ({ activityId: 'hr' + n, date: ago(n), discipline: 'run', durationMin: 95, read: { band: 'held-strong', outputDropPct: 1.0, hrDriftPct: 2.0, efDropPct: null, hrMissing: false } });

  it('a fresh held-strong streak tells its story on the Overview', async () => {
    const html = await mount({ plan: generatePlan(profile), activities: null, durability: [heldRead(2), heldRead(9), heldRead(13)] });
    expect(html).toContain('Progress stories');
    expect(html).toContain('held strong to the end');
  });

  it('a fresh longest recorded run appears, and an old one does not', async () => {
    const longRuns = shift => [
      { id: 'l1', type: 'Run', date: ago(shift + 30), movingTimeSec: 3600, distance: 10000 },
      { id: 'l2', type: 'Run', date: ago(shift + 20), movingTimeSec: 4500, distance: 12000 },
      { id: 'l3', type: 'Run', date: ago(shift + 3), movingTimeSec: 5700, distance: 15000 },
    ];
    const fresh = await mount({ plan: generatePlan(profile), activities: longRuns(0) });
    expect(fresh).toContain('longest recorded run');
    const stale = await mount({ plan: generatePlan(profile), activities: longRuns(20) });
    expect(stale).not.toContain('longest recorded run');
    expect(stale).not.toContain('Progress stories'); // no shell without stories
  });
});

describe('the Progress tabs (phase 3)', () => {
  // a populated curve, the balanced-rider fixture from bike-power-curve.test.js
  const RATIO = { 5: 4.0, 15: 3.0, 30: 2.4, 60: 1.8, 180: 1.38, 300: 1.25, 720: 1.10, 1200: 1 / 0.95, 2400: 1.0, 3600: 0.97 };
  const curveFix = () => powerCurve(CURVE_DURATIONS.map(d => ({
    durationSec: d, watts: Math.round(250 * RATIO[d]),
    date: '2026-07-01', source: 'Assioma', bike: 'road', indoor: false, quality: 'high',
  })));

  it('a tri plan shows four tabs, Overview selected, dashboards off Overview', async () => {
    const html = await mount({ plan: generatePlan(profile), activities: null });
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) || []).length).toBe(4);
    expect(html).toMatch(/aria-selected="true"[^>]*>Overview/);
    expect(html).toContain('Weekly load');               // orchestration stays
    expect(html).toContain('Race projections');          // nested in the fitness card, still here
    expect(html).not.toContain('id="prog-panel-run"');   // discipline panels unmounted
  });

  it('the Bike tab mounts the power curve card beside the dashboard', async () => {
    // the curve self-gates on data; with none, the dashboard renders and
    // nothing crashes — the sibling placement is what this pins
    const html = await mount({ plan: generatePlan(profile), activities: null }, 'Bike');
    expect(html).toContain('id="prog-panel-bike"');
    expect(html).toContain('Where you are');             // the bike dashboard's FTP card
    expect(html).not.toContain('Weekly load');           // overview content unmounts
  });

  it('an excluded discipline has no tab at all', async () => {
    const html = await mount({ plan: generatePlan({ ...profile, excludedDiscipline: 'bike' }), activities: null });
    expect(html).toContain('role="tablist"');
    expect(html).not.toMatch(/role="tab"[^>]*>Bike|>Bike<\/button>/);
    expect((html.match(/role="tab"/g) || []).length).toBe(3);
  });

  it('a solo plan opens on its discipline and offers no swim or bike tab', async () => {
    const html = await mount({ plan: generatePlan({ ...profile, raceType: 'runhalf' }), activities: null });
    expect(html).toMatch(/aria-selected="true"[^>]*>Run/);
    expect(html).not.toMatch(/>Swim<\/button>/);
    expect(html).not.toMatch(/>Bike<\/button>/);
    // and the run dashboard is already on screen without a tap
    expect(html).toContain('id="prog-panel-run"');
  });

  it('a hidden tab never hides its content: run blocks fall back to Overview', async () => {
    /* Gauntlet 2026-07-30: with run excluded there is no Run tab, and the
       tab-only placement made the run-km history and the projections
       unreachable on every tab — for exactly the athlete mid-injury who
       most needs to watch them. They fall back to their pre-tab Overview
       positions instead. */
    const plan = generatePlan({ ...profile, excludedDiscipline: 'run' });
    plan.profile.fivekSec = 1500; // onboarding nulls it on exclusion; FitnessEditor can restore it
    const html = await mount({ plan, activities: [run('2026-07-14', 8), run('2026-07-07', 12)] });
    expect(html).not.toMatch(/>Run<\/button>/);
    expect(html).toContain('Run volume');
    expect(html).toContain('Race projections');
  });

  it('a hidden Bike tab never hides the power curve: it falls back to Overview', async () => {
    const html = await mount({
      plan: generatePlan({ ...profile, raceType: 'runhalf' }),
      activities: null, powerCurve: curveFix(),
    }, 'Overview');
    expect(html).toContain('Power curve'); // a solo runner who rides still sees their curve
  });

  it('with a Bike tab the curve renders there, not on Overview', async () => {
    const props = { plan: generatePlan(profile), activities: null, powerCurve: curveFix() };
    const overview = await mount(props);
    expect(overview).not.toContain('Power curve');
    const bike = await mount(props, 'Bike');
    expect(bike).toContain('Power curve');
  });
});
