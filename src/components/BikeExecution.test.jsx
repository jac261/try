import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BikeExecution } from '@/components/BikeExecution.jsx';
import { generatePlan } from '@/lib/plan.js';
import { isTrainingRide } from '@/lib/bikeschema.js';

/* Render tests, because the last two defects in this area were both render
   defects that every unit test passed straight through: a bike main set
   pasted into the run builder, and a prop wired to a variable name that did
   not exist in that scope. Both would have thrown or shown the wrong words
   the moment anything actually rendered them. */

const base = {
  name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-11-01',
};

describe('the barrel exports everything the bike cards reach for', () => {
  // A component reaching T.somethingThatIsNotExported builds cleanly, passes
  // every unit test, and throws the moment a real card renders — which is
  // exactly what happened when bike-execution.js was written and not added
  // to the barrel. Cheap to assert, so assert it.
  it('exports every symbol the phase 4 UI uses', async () => {
    const T = await import('@/lib');
    ['bikeExecution', 'bikeEnvironmentNote', 'bikeDistanceEstimate', 'intervalRows', 'bikeTargetMode']
      .forEach(name => expect(typeof T[name], name + ' is not exported from @/lib').toBe('function'));
  });
});

describe('BikeExecution renders', () => {
  const plan = generatePlan(base);
  const ride = plan.weeks.flatMap(w => w.workouts).filter(isTrainingRide);

  it('renders every generated ride without throwing', () => {
    const types = new Set();
    ride.forEach(w => {
      const html = renderToStaticMarkup(<BikeExecution w={w} profile={plan.profile} />);
      expect(html, w.type).toContain('Where to ride it');
      expect(html).toContain('Indoor'.toLowerCase());   // both options are offered
      expect(html).toContain('outdoor');
      types.add(w.type);
    });
    expect(types.size).toBeGreaterThan(2);
  });

  it('renders nothing at all for a session it does not model', () => {
    const swim = plan.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'swim');
    expect(renderToStaticMarkup(<BikeExecution w={swim} profile={plan.profile} />)).toBe('');
  });

  it('shows the power target for a measured threshold and effort otherwise', () => {
    const w = ride[0];
    expect(renderToStaticMarkup(<BikeExecution w={w} profile={{ ftp: 250 }} />)).toContain('Target: power');
    const noFtp = renderToStaticMarkup(<BikeExecution w={w} profile={{ fitness: 'intermediate', weightKg: 75 }} />);
    expect(noFtp).toContain('perceived effort');
    expect(noFtp).not.toContain('Target: power');
  });

  it('names the environment a session is written for, when it has one', () => {
    const long = ride.find(w => w.type === 'Long');
    if (long) expect(renderToStaticMarkup(<BikeExecution w={long} profile={plan.profile} />)).toContain('Best ridden outdoors');
    const vo2 = ride.find(w => w.type === 'VO2 Intervals');
    if (vo2) expect(renderToStaticMarkup(<BikeExecution w={vo2} profile={plan.profile} />)).toContain('Best ridden indoors');
  });

  it('defaults to the environment the session was written for', () => {
    const vo2 = ride.find(w => w.type === 'VO2 Intervals');
    if (!vo2) return;
    const html = renderToStaticMarkup(<BikeExecution w={vo2} profile={plan.profile} />);
    // the indoor chip is the pressed one, and the indoor copy is what shows
    expect(html).toMatch(/aria-pressed="true"[^>]*>indoor/);
    expect(html).toContain('belongs indoors');
  });
});
