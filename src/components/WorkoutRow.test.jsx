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

/* The completion circle is rule 3 made personal: a hollow pressed well until
   the session is done, then a raised tick. The tick colour is a THEME token
   (white in moulded, mint in smoked), so the markup must lean on the class
   and never re-state a colour inline — these pin that contract. */
describe('the completion circle', () => {
  const w = { id: 'x', discipline: 'run', type: 'Easy', title: 'Easy Run', durationMin: 40, date: '2026-08-05' };

  it('done rows carry the tick through the .done class, nothing inline', () => {
    const html = renderToString(<WorkoutRow w={w} done eff={w.date} onClick={() => {}} onToggle={() => {}} />);
    expect(html).toContain('wk done');
    expect(html).toContain('✓');
    // the states are CSS's business: no inline background on the check
    expect(html).not.toMatch(/check[^>]*style=/);
  });

  it('a done row SAYS it is done, not just shows it', () => {
    // the tick is aria-hidden by design (no button inside a button), so
    // without this completion was carried by colour alone
    const w = { id: 'x', discipline: 'run', type: 'Easy', title: 'Easy run', durationMin: 45, date: '2026-08-05' };
    const done = renderToString(<WorkoutRow w={w} done eff={w.date} onClick={() => {}} />);
    expect(done).toContain('sr-only');
    expect(done).toContain('Completed');
    const undone = renderToString(<WorkoutRow w={w} done={false} eff={w.date} onClick={() => {}} />);
    expect(undone).not.toContain('Completed');
  });

  it('undone rows render the same glyph, hidden by the pressed state', () => {
    const html = renderToString(<WorkoutRow w={w} done={false} eff={w.date} onClick={() => {}} onToggle={() => {}} />);
    expect(html).not.toContain('wk done');
    expect(html).toContain('check');
  });
});

describe('the key glow', () => {
  const base = { id: 'k', discipline: 'bike', type: 'Threshold', title: 'Threshold Ride', durationMin: 60, date: '2026-08-05' };

  it('a key session marks its tile and hands it the discipline colour', () => {
    const html = renderToString(<WorkoutRow w={{ ...base, key: true }} done={false} eff={base.date} onClick={() => {}} onToggle={() => {}} />);
    expect(html).toContain('dot key');
    expect(html).toContain('--tile-c:#fb923c');
  });

  it('race day never glows, even though it is flagged key', () => {
    const race = { ...base, race: true, key: true, type: 'RACE', title: 'RACE DAY' };
    const html = renderToString(<WorkoutRow w={race} done={false} eff={race.date} onClick={() => {}} onToggle={() => {}} />);
    expect(html).not.toContain('dot key');
  });

  it('a tune-up is an event too, not an emphasis', () => {
    const b = { ...base, bRace: true, key: true, type: 'RACE', title: 'TUNE-UP' };
    const html = renderToString(<WorkoutRow w={b} done={false} eff={b.date} onClick={() => {}} onToggle={() => {}} />);
    expect(html).not.toContain('dot key');
  });
});
