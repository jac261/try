// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { WorkoutRow } from '@/components/WorkoutRow.jsx';
import { generatePlan } from '@/lib/plan.js';

// The suite's first mounted-component test, on the harness the UI simulation
// round proved out (happy-dom + the @ alias).
describe('WorkoutRow (UI sim catch 2026-07-17)', () => {
  const profile = { name: 'T', raceType: 'olympic', fitness: 'intermediate',
    trainingDays: [0, 1, 2, 3, 4, 5, 6], longDay: 5, daysPerWeek: 7,
    raceDate: '2026-09-23', startDate: '2026-07-01' };

  it('race day never shows the placeholder 0 min duration', () => {
    const p = generatePlan(profile);
    const race = p.weeks.flatMap(w => w.workouts).find(w => w.race);
    const html = renderToString(<WorkoutRow w={race} done={false} eff={race.date} onClick={() => {}} onToggle={() => {}} />);
    expect(html).not.toContain('0 min');
  });

  it('ordinary sessions keep their duration', () => {
    const p = generatePlan(profile);
    const w = p.weeks[0].workouts.find(x => x.discipline === 'run' && x.durationMin > 0);
    const html = renderToString(<WorkoutRow w={w} done={false} eff={w.date} onClick={() => {}} onToggle={() => {}} />);
    expect(html).toContain('min');
  });
});
