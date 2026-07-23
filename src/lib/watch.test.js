import { describe, it, expect } from 'vitest';
import { buildWatchEvents, watchDescription, watchSteps } from './watch.js';
import { generatePlan, addCustomWorkout } from './plan.js';

const TODAY = '2026-07-09';
const wk = (id, discipline, type, date, durationMin, extra = {}) => ({
  id, discipline, type, title: type + ' ' + discipline, date, durationMin,
  segments: [{ label: 'Main', min: durationMin, detail: 'steady' }], ...extra,
});
const plan = { weeks: [{ index: 0, workouts: [
  wk('0-0', 'run', 'Easy', '2026-07-09', 50),
  wk('0-1', 'bike', 'Endurance', '2026-07-10', 60),
  wk('0-2', 'rest', 'Rest', '2026-07-11', 0),
  wk('0-3', 'strength', 'Strength', '2026-07-12', 40),
  wk('0-4', 'swim', 'Technique', '2026-07-08', 35),            // yesterday → outside
  wk('9-0', 'brick', 'RACE', '2026-07-20', 120, { race: true }), // race day → skipped
] }] };

describe('buildWatchEvents (workouts-to-watch)', () => {
  it('maps upcoming sessions to calendar events inside the window', () => {
    const { oldest, newest, events } = buildWatchEvents({ plan, moves: {}, todayISO: TODAY });
    expect(oldest).toBe(TODAY);
    expect(newest).toBe('2026-07-15'); // a rolling week inclusive of today
    expect(events.map(e => [e.ref, e.date, e.type])).toEqual([
      ['0-0', '2026-07-09', 'Run'],
      ['0-1', '2026-07-10', 'Ride'],
      ['0-3', '2026-07-12', 'WeightTraining'],
    ]);
    expect(events[0].name).toBe('Easy run');
    expect(events[0].movingTimeSec).toBe(3000);
    expect(events[0].description).toBe('• Main · 50m · steady');
  });

  it('uses effective dates for moved sessions and adjusted volume via easedOf', () => {
    const easedOf = w => (w.id === '0-1' ? { ...w, durationMin: 45, trimmed: true } : w);
    const { events } = buildWatchEvents({ plan, moves: { '0-4': '2026-07-15' }, easedOf, todayISO: TODAY });
    expect(events.find(e => e.ref === '0-4').date).toBe('2026-07-15'); // moved back inside
    const bike = events.find(e => e.ref === '0-1');
    expect(bike.movingTimeSec).toBe(2700);
    expect(bike.description).toContain('• Trimmed by the adaptive engine');
  });

  it('is quiet without a plan', () => {
    expect(buildWatchEvents({ plan: null, moves: {}, todayISO: TODAY }).events).toEqual([]);
  });

  it('completed sessions drop out of the list, so ticking one clears it off the watch', () => {
    // The wrist holds a rolling week of what is still TO DO (field spec,
    // 2026-07-11): the backend reconciler deletes any event that leaves the
    // list, so excluding done sessions here removes them from the watch.
    const { events } = buildWatchEvents({ plan, moves: {}, log: { '0-0': { done: true } }, todayISO: TODAY });
    expect(events.map(e => e.ref)).toEqual(['0-1', '0-3']);
  });
});

describe('watchDescription', () => {
  it('renders segments as bullet lines, never the "- " step syntax intervals.icu would parse', () => {
    const d = watchDescription({ segments: [
      { label: 'Warm-up', min: 12, detail: 'Z2 5:40/km' },
      { label: 'Drills', detail: 'form focus' }, // no minutes
    ] });
    expect(d).toBe('• Warm-up · 12m · Z2 5:40/km\n• Drills · form focus');
  });

  it('notes engine adjustments and returns null when empty', () => {
    expect(watchDescription({ segments: [], eased: true, easedFrom: 'Threshold' }))
      .toBe('• Eased by the adaptive engine (was Threshold)');
    expect(watchDescription({ segments: [] })).toBe(null);
  });
});

describe('watchSteps (structured DSL, v2)', () => {
  const p = generatePlan({ name: 'T', raceType: 'olympic', fitness: 'intermediate', trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5, raceDate: '2026-09-23', startDate: '2026-07-01', ftp: 250, fivekSec: 1500 });
  const custom = (type, dur, disc = 'run') => addCustomWorkout(p, { discipline: disc, type, durationMin: dur, dateISO: p.weeks[0].start }).workout;

  it('emits verified DSL for a run: Warmup/Cooldown headers, Nx repeats, Pace zones', () => {
    const { dsl, seconds } = watchSteps(custom('Threshold', 60)); // canonical 3 × (9m Z4 / 3m Z2)
    expect(dsl).toBe('Warmup\n- 15m Z2 Pace\n\n3x\n- 9m Z4 Pace\n- 3m Z2 Pace\n\nCooldown\n- 9m Z1 Pace'); // cool-down fits the session to durationMin
    expect(seconds).toBe(60 * 60); // == durationMin (15 + 36 + 9)
  });

  it('bike zones stay bare (power is the DSL default)', () => {
    const { dsl } = watchSteps(custom('Sweet Spot', 60, 'bike'));
    expect(dsl).toContain('- 12m Z3');
    expect(dsl).not.toContain('Pace');
  });

  it('non-uniform patterns are written block by block, never a wrong Nx', () => {
    const w = addCustomWorkout(p, { discipline: 'run', type: 'Fartlek', durationMin: 55, dateISO: p.weeks[1].start }).workout; // pyramid
    const { dsl } = watchSteps(w);
    expect(dsl).not.toMatch(/\dx\n/);
    expect(dsl).toContain('- 1m Z3 Pace\n- 1m Z2 Pace\n- 2m Z3 Pace'); // rises step by step
  });

  it('sub-minute blocks are written in seconds', () => {
    const w = { discipline: 'run', segments: [{ label: 'Main', blocks: [{ min: 0.5, zone: 'Z5' }, { min: 0.5, zone: 'Z1' }] }] };
    expect(watchSteps(w).dsl).toContain('- 30s Z5 Pace');
  });

  it('declines bricks, strength and pre-profile builds', () => {
    expect(watchSteps({ discipline: 'brick', segments: [{ label: 'Bike', min: 40, zone: 'Z2' }] })).toBe(null);
    expect(watchSteps({ discipline: 'run', segments: [{ label: 'Relaxed', min: 40 }] })).toBe(null); // no zone
    expect(watchSteps({ discipline: 'swim', segments: [{ label: 'Main', blocks: [{ min: 2, zone: 'Z4' }] }] })).toBe(null); // blocks but no prescription (pre-v3 build)
  });

  it('swims prescribe distance steps at % of CSS with rest steps (v3)', () => {
    const { dsl, seconds } = watchSteps(custom('CSS Intervals', 40, 'swim'));
    expect(seconds).toBe(null); // duration is the athlete's threshold's business
    expect(dsl).toContain('Warmup\n- 0.4km 91% Pace');   // easy = CSS+12 at estimated CSS 120 → 91% of CSS speed
    expect(dsl).toContain('x\n- 0.1km 100% Pace\n- 15s rest');
    expect(dsl).toContain('Cooldown\n- 0.2km 91% Pace');
  });

  it('open water keeps its skills segment and falls back to descriptive', () => {
    expect(watchSteps(custom('Open Water', 40, 'swim'))).toBe(null);
  });
});

describe('buildWatchEvents v2 integration', () => {
  const p = generatePlan({ name: 'T', raceType: 'olympic', fitness: 'intermediate', trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5, raceDate: '2026-09-23', startDate: '2026-07-01', ftp: 250, fivekSec: 1500 });

  it('structured events report the step total as moving time and append notes as plain text', () => {
    const { workout, plan: np } = addCustomWorkout(p, { discipline: 'run', type: 'Threshold', durationMin: 60, dateISO: p.weeks[0].start });
    const easedOf = w => (w.id === workout.id ? { ...w, trimmed: true } : w);
    const { events } = buildWatchEvents({ plan: np, moves: {}, easedOf, todayISO: p.weeks[0].start });
    const ev = events.find(e => e.ref === workout.id);
    expect(ev.description).toContain('3x');
    expect(ev.description).toContain('\n\nTrimmed by the adaptive engine.');
    expect(ev.description).not.toContain('•');
    expect(ev.movingTimeSec).toBe(workout.durationMin * 60); // step total now equals durationMin (Tranche 2 fit: 15 + 36 + 9)
  });

  it('structured swims assert no moving time; open water keeps bullets and its duration', () => {
    const css = addCustomWorkout(p, { discipline: 'swim', type: 'CSS Intervals', durationMin: 40, dateISO: p.weeks[0].start });
    const ow = addCustomWorkout(css.plan, { discipline: 'swim', type: 'Open Water', durationMin: 40, dateISO: p.weeks[0].start });
    const { events } = buildWatchEvents({ plan: ow.plan, moves: {}, todayISO: p.weeks[0].start });
    const cssEv = events.find(e => e.ref === css.workout.id);
    expect(cssEv.description).toContain('% Pace');
    expect(cssEv.movingTimeSec).toBe(null);
    const owEv = events.find(e => e.ref === ow.workout.id);
    expect(owEv.description).toContain('•');
    expect(owEv.movingTimeSec).toBe(40 * 60);
  });
});

describe('watch swim steps round the distance (phase 2b)', () => {
  it('a yard-pool swim exports whole-metre km, never a long decimal', () => {
    const p = generatePlan({
      name: 'W', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
      css100Sec: 150, ftp: 320, weightKg: 75, daysPerWeek: 6,
      trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
      pool: { length: 25, unit: 'yards' },
    });
    const swim = p.weeks.flatMap(w => w.workouts).find(x => x.discipline === 'swim' && x.segments.every(s => s.swim));
    expect(swim).toBeTruthy();
    const r = watchSteps(swim);
    const dsl = r ? r.dsl : '';
    const tokens = dsl.match(/[\d.]+km/g) || [];
    expect(tokens.length).toBeGreaterThan(0); // it really is a distance-stepped swim
    // km values are at most 3 decimals (whole metres / 1000), no 0.09144 tails
    tokens.forEach(tok => {
      const dec = (tok.replace('km', '').split('.')[1] || '');
      expect(dec.length).toBeLessThanOrEqual(3);
    });
  });
});

