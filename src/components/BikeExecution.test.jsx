import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BikeExecution } from '@/components/BikeExecution.jsx';
import { BikeLongPlan, PositionTap } from '@/components/BikeLongPlan.jsx';
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
    ['bikeExecution', 'bikeEnvironmentNote', 'bikeDistanceEstimate', 'intervalRows', 'bikeTargetMode',
     'bikeReview', 'bikeReviewVerdict', 'bikeReviewEvidence', 'bikeLoad', 'matchBikeIntervals',
     'longRideObjective', 'bikeFuellingPlan', 'fuellingOutcome', 'positionAsk', 'positionTolerance',
     'brickExecution', 'brickPattern']
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


describe('BikeLongPlan and PositionTap render', () => {
  const plan2 = generatePlan(base);
  const longs = plan2.weeks.flatMap(w => w.workouts).filter(isTrainingRide).filter(w => w.type === 'Long');

  it('renders a long ride objective and a fuelling plan', () => {
    expect(longs.length).toBeGreaterThan(0);
    longs.forEach(w => {
      const html = renderToStaticMarkup(<BikeLongPlan w={w} plan={plan2} fuelLog={{}} />);
      expect(html, w.durationMin + ' min').toContain('What this ride is for');
      expect(html).toContain('Fuelling');
      expect(html).toMatch(/\d+ g/);
    });
  });

  it('renders nothing for a session with no plan to show', () => {
    const short = { discipline: 'bike', type: 'Endurance', durationMin: 40, segments: [{ min: 40, zone: 'Z2' }] };
    expect(renderToStaticMarkup(<BikeLongPlan w={short} plan={plan2} fuelLog={{}} />)).toBe('');
    const swim = plan2.weeks.flatMap(w => w.workouts).find(w => w.discipline === 'swim');
    expect(renderToStaticMarkup(<BikeLongPlan w={swim} plan={plan2} fuelLog={{}} />)).toBe('');
  });

  it('asks about position only on a long enough ride, and only with a recording', () => {
    const w = longs[0];
    const act = { id: 'a1' };
    const asked = renderToStaticMarkup(<PositionTap w={w} activity={act} positionLog={{}} onPosition={() => {}} />);
    expect(asked).toContain('How did your position hold up');
    // no handler, no recording, or too short: silent
    expect(renderToStaticMarkup(<PositionTap w={w} activity={act} positionLog={{}} onPosition={null} />)).toBe('');
    expect(renderToStaticMarkup(<PositionTap w={w} activity={null} positionLog={{}} onPosition={() => {}} />)).toBe('');
    const short = { discipline: 'bike', type: 'Endurance', durationMin: 40 };
    expect(renderToStaticMarkup(<PositionTap w={short} activity={act} positionLog={{}} onPosition={() => {}} />)).toBe('');
  });

  it('only asks where it hurt once the position question is answered', () => {
    const w = longs[0];
    const act = { id: 'a1' };
    const unanswered = renderToStaticMarkup(<PositionTap w={w} activity={act} positionLog={{}} onPosition={() => {}} />);
    expect(unanswered).not.toContain('Anything complaining');
    const answered = renderToStaticMarkup(
      <PositionTap w={w} activity={act} positionLog={{ a1: { comfort: 'hard', symptoms: [] } }} onPosition={() => {}} />);
    expect(answered).toContain('Anything complaining');
    expect(answered).toContain('Neck');
  });
});
