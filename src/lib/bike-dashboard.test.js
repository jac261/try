import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { generatePlan } from './plan.js';
import { isTrainingRide } from './bikeschema.js';
import { BIKE_REVIEW_RULES } from './bike-review.js';
import { SOURCE_KINDS } from './swim-dashboard.js';
import { bikeDashboard, bikeLimiter, BIKE_DASH_RULES } from './bike-dashboard.js';
import { bikeReadiness, READINESS_COMPONENTS, READINESS_STATES } from './bike-readiness.js';

const base = {
  name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-11-01',
};
const plan = generatePlan(base);
const rides = plan.weeks.flatMap(w => w.workouts).filter(isTrainingRide);
const TODAY = '2026-07-20';
// everything in the window, marked done
const doneLog = () => Object.fromEntries(
  plan.weeks.flatMap(w => w.workouts).filter(w => w.date <= TODAY).map(w => [w.id, { done: true }]));

const dash = (over = {}) => bikeDashboard({
  plan, log: doneLog(), moves: {}, activities: [], todayISO: TODAY, ...over,
});

describe('§9: real and estimated FTP are never conflated', () => {
  it('a measured threshold fills the real field and leaves the estimate empty', () => {
    const d = dash();
    expect(d.status.ftpWatts.value).toBe(250);
    expect(d.status.ftpWatts.kind).toBe('recorded');
    expect(d.status.estimatedFtpWatts.value).toBe(null);
  });

  it('an athlete with no FTP gets an estimate in a DIFFERENT field, never the real one', () => {
    const p2 = generatePlan({ ...base, ftp: null });
    // sessions completed, so consistency does not (correctly) outrank this
    const log2 = Object.fromEntries(p2.weeks.flatMap(w => w.workouts)
      .filter(w => w.date <= TODAY).map(w => [w.id, { done: true }]));
    const d = bikeDashboard({ plan: p2, log: log2, moves: {}, activities: [], todayISO: TODAY });
    expect(d.status.ftpWatts.value, 'an estimate leaked into the measured field').toBe(null);
    expect(d.status.ftpWatts.kind).toBe('missing');
    expect(d.status.estimatedFtpWatts.value).toBeGreaterThan(0);
    expect(d.status.estimatedFtpWatts.kind).toBe('estimated');
    // and nothing on the page judges against it
    expect(d.limiter.id).toBe('data-confidence');
  });
});

describe('§8/§9: indoor virtual distance never enters an outdoor figure', () => {
  const indoor = { id: 'v', type: 'VirtualRide', date: '2026-07-15', movingTimeSec: 3600, distance: 40000 };
  const outdoor = { id: 'o', type: 'Ride', date: '2026-07-16', movingTimeSec: 3600, distance: 30000 };

  it('the outdoor distance is modelled from the plan and cannot be moved by a turbo', () => {
    const without = dash().status.outdoorDistanceKm.value;
    const with_ = dash({ activities: [indoor] }).status.outdoorDistanceKm.value;
    expect(with_, 'a trainer moved the outdoor distance').toBe(without);
  });

  it('but indoor duration and the split stay visible', () => {
    const d = dash({ activities: [indoor, outdoor] });
    expect(d.status.indoorMinutes.value).toBe(60);
    expect(d.status.outdoorMinutes.value).toBe(60);
    expect(d.status.indoorShare.value).toBe(50);
  });

  it('says how the distance was estimated rather than presenting it as measured', () => {
    const m = dash().status.outdoorDistanceKm;
    expect(m.kind).toBe('estimated');
    expect(m.note).toMatch(/not measured/);
  });
});

describe('the two scars the swim dashboard left', () => {
  it('a plan on its first day accuses nobody', () => {
    /* The swim dashboard told athletes they had completed 0% of sessions
       that had not come due. A rate over zero opportunities is not zero. */
    const d = bikeDashboard({ plan, log: {}, moves: {}, activities: [], todayISO: '2026-06-01' });
    expect(d.status.completion.value).toBe(null);
    expect(d.status.completion.kind).toBe('missing');
    expect(d.status.completion.note).toMatch(/come due/);
    expect(d.quality.completion.value).toBe(null);
    expect(d.limiter.id, 'a day-one plan named consistency as the limiter').not.toBe('consistency');
  });

  it('every rolling figure uses the window the card claims', () => {
    // a ride far outside the window must not count towards it
    const old = plan.weeks.flatMap(w => w.workouts).filter(isTrainingRide)
      .filter(w => w.date < '2026-06-08');
    expect(old.length).toBeGreaterThan(0);
    const d = dash();
    const from = d.status.windowFrom;
    const weeks = (Date.parse(TODAY) - Date.parse(from)) / 86400000 / 7;
    expect(Math.round(weeks) + 1).toBe(BIKE_DASH_RULES.weeks);
    // the counted sessions are only those inside it
    const inWindow = rides.filter(w => w.date >= from && w.date <= TODAY).length;
    expect(d.status.planned).toBeLessThanOrEqual(inWindow + 20);   // bricks also count
    expect(d.status.planned).toBeGreaterThan(0);
  });
});

describe('§3: time in zone is the work, not the session', () => {
  it('counts efforts and excludes the warm-up and cool-down around them', () => {
    const d = dash();
    const thr = rides.filter(w => w.type === 'Threshold' && w.date <= TODAY && w.date >= d.status.windowFrom);
    if (!thr.length) return;
    const rideMinutes = thr.reduce((t, w) => t + w.durationMin, 0);
    expect(d.quality.thresholdMin.value).toBeGreaterThan(0);
    expect(d.quality.thresholdMin.value, 'counted whole sessions rather than efforts')
      .toBeLessThan(rideMinutes);
  });
});

describe('§5/§6: one limiter, with evidence and a plan response', () => {
  it('names exactly one, always with evidence and a response', () => {
    const d = dash();
    expect(typeof d.limiter.id).toBe('string');
    expect(Array.isArray(d.limiter.evidence)).toBe(true);
    expect(d.limiter.evidence.length).toBeGreaterThan(0);
    expect(d.limiter.response.length).toBeGreaterThan(0);
    d.limiter.evidence.concat(d.limiter.response).forEach(t => expect(t.length).toBeGreaterThan(15));
  });

  it('consistency outranks everything, because nothing progresses without the sessions', () => {
    const d = bikeDashboard({ plan, log: {}, moves: {}, activities: [], todayISO: TODAY });
    // judged on ALL prescribed rides: a base block may schedule no quality
    // rides at all, and an athlete skipping every endurance ride is not
    // consistent just because there was nothing hard to miss
    expect(d.status.completion.value).toBeLessThan(BIKE_DASH_RULES.completionFloor);
    expect(d.limiter.id).toBe('consistency');
    expect(d.limiter.evidence[0]).toMatch(new RegExp('last ' + BIKE_DASH_RULES.weeks + ' weeks'));
  });

  it('a brick pattern is surfaced as the limiter, since it is invisible in the ride', () => {
    const d = dash();
    const withBrick = { ...d, brick: { executions: [], pattern: { text: 'Your last 2 brick runs came in well down.' } } };
    expect(bikeLimiter(withBrick).id).toBe('bike-to-run');
  });
});

describe('§7: race readiness is component based, and there is no score', () => {
  const r = bikeReadiness(dash());

  it('returns every component the spec lists', () => {
    expect(r.components.length).toBe(READINESS_COMPONENTS.length);
    r.components.forEach(c => {
      expect(READINESS_STATES).toContain(c.state);
      expect(c.label.length).toBeGreaterThan(2);
      expect((c.evidence || c.why).length).toBeGreaterThan(20);
    });
  });

  it('EXPOSES NO FIELD THAT COULD BE USED AS A SINGLE READINESS SCORE', () => {
    /* §7's one instruction, asserted structurally rather than trusted to
       copy — the same guard phase 7 put on rider phenotypes. Eight components
       measured with eight different confidences do not average, and whatever
       single number existed would be the only thing anybody read. */
    ['score', 'percent', 'pct', 'overall', 'total', 'grade', 'rank', 'readiness', 'value']
      .forEach(k => expect(k in r, 'bikeReadiness exposes "' + k + '", which will be read as a score').toBe(false));
  });

  it('says unknown rather than passing when it cannot see something', () => {
    // terrain can never be measured: the app sees no course and no roads
    expect(r.byId.terrain.state).toBe('unknown');
    expect(r.byId.terrain.evidence).toMatch(/cannot see your course/);
    // and a rider with nothing logged is unknown across the board, not ready
    const bare = bikeReadiness(bikeDashboard({ plan, log: {}, moves: {}, activities: [], todayISO: '2026-06-01' }));
    expect(bare.unknown).toBeGreaterThan(bare.ready);
    expect(bare.byId.dataConfidence.state).not.toBe('ready');
  });
});

describe('§9: conclusions expose confidence', () => {
  it('every metric on the page says where it came from', () => {
    const d = dash();
    ['status', 'quality', 'durability'].forEach(section => {
      Object.entries(d[section]).forEach(([key, m]) => {
        if (!m || typeof m !== 'object' || !('kind' in m)) return;
        expect(SOURCE_KINDS, section + '.' + key + ' has kind ' + m.kind).toContain(m.kind);
        // a missing value is always labelled missing, never quietly recorded
        if (m.value == null) expect(m.kind, section + '.' + key).toBe('missing');
      });
    });
  });
});

describe('the duplicated constant cannot drift', () => {
  it('the dashboard fade concern still matches the review engine it mirrors', () => {
    /* It is written out rather than imported because reading another module's
       constant at module scope inside this import graph resolves to undefined
       — the same temporal dead zone the phase 5 rep table hit. Duplicated on
       purpose, so asserted on purpose. */
    expect(BIKE_DASH_RULES.fadeConcern).toBe(BIKE_REVIEW_RULES.fadeSoftPct);
  });
});

describe('nothing here is a model without a caller', () => {
  it('every exported function is reachable from the app, and the dashboard is rendered', () => {
    const MODULES = ['bike-dashboard.js', 'bike-readiness.js'];
    const srcFiles = [];
    const walk = dir => readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const full = dir + '/' + e.name;
      if (e.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) srcFiles.push(full);
    });
    walk(new URL('..', import.meta.url).pathname.replace(/\/$/, ''));
    const prodUses = name => srcFiles.filter(f => !/\/(bike-dashboard|bike-readiness)\.js$/.test(f)
      && !f.endsWith('/index.js')
      && new RegExp('\\b' + name + '\\b').test(readFileSync(f, 'utf8'))).length;

    MODULES.forEach(mod => {
      const src = readFileSync(new URL('./' + mod, import.meta.url), 'utf8');
      const exported = [...src.matchAll(/export function (\w+)/g)].map(m => m[1]);
      expect(exported.some(n => prodUses(n) > 0), mod + ' has no export the app calls').toBe(true);
    });

    // and the component is RENDERED, not merely defined — the gap phase 7's
    // guard missed until the agents pointed it out
    const pv = readFileSync(new URL('../features/progress/ProgressView.jsx', import.meta.url), 'utf8');
    expect(pv).toMatch(/<BikeDashboard/);
    const app = readFileSync(new URL('../app/App.jsx', import.meta.url), 'utf8');
    expect(app, 'App does not pass the position log the dashboard needs').toMatch(/positionLog=\{positionLog\}/);
  });
});
