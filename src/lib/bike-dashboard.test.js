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

  it('a rider who rode entirely indoors has no outdoor distance at all', () => {
    /* The figure is modelled from PLANNED segments and the plan carries no
       indoor flag, so it used to be shown in full to somebody who never left
       the house — beside copy insisting indoor rides never contribute
       distance. */
    const d = dash({ activities: [indoor] });
    expect(d.status.outdoorDistanceKm.value).toBe(null);
    expect(d.status.outdoorDistanceKm.note).toMatch(/entirely indoors/);
  });

  it('a turbo’s own reported kilometres never enter the figure', () => {
    const half = dash({ activities: [indoor, outdoor] }).status.outdoorDistanceKm.value;
    // the trainer claims 40 km and the road ride 30; the figure is modelled
    // from the plan and scaled by time ridden outside, so neither number
    // appears and inflating the turbo's distance changes nothing
    const inflated = dash({
      activities: [{ ...indoor, distance: 400000 }, outdoor],
    }).status.outdoorDistanceKm.value;
    expect(inflated).toBe(half);
    expect(half).toBeGreaterThan(0);
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


describe('the quality section reads STORED reviews, not a caller-supplied array', () => {
  it('says plainly that it has none rather than looking wired', () => {
    /* The first cut took `reviews` as a parameter, App had none to give and
       passed an empty array, and every metric here read "missing" while the
       plumbing looked complete. Absence has to be visible. */
    const d = dash();
    expect(d.quality.reviews).toBe(0);
    expect(d.quality.adherence.value).toBe(null);
    expect(d.quality.reviewNote).toMatch(/stored/);
  });

  it('reads them off the log the way the swim dashboard does', () => {
    const w = rides.find(x => ['Threshold', 'Sweet Spot'].includes(x.type)
      && x.date <= TODAY && x.date >= '2026-06-15');
    if (!w) return;
    const log2 = { ...doneLog() };
    log2[w.id] = {
      done: true, at: w.date + 'T10:00:00Z',
      bikeReview: { outcome: 'progress', confidence: 'high', powerAdherence: 0, intervalFadePercent: 1.2, type: w.type },
    };
    const d = dash({ log: log2 });
    expect(d.quality.reviews).toBe(1);
    expect(d.quality.adherence.value).toBe(0);
    expect(d.quality.fade.value).toBe(1.2);
    expect(d.quality.outcomes.progress).toBe(1);
    expect(d.quality.reviewNote).toBe(null);
  });

  it('a review from before the window does not count towards it', () => {
    const w = rides.find(x => x.date < '2026-06-08');
    if (!w) return;
    const log2 = { ...doneLog() };
    log2[w.id] = {
      done: true, at: w.date + 'T10:00:00Z',
      bikeReview: { outcome: 'reduce', confidence: 'high', powerAdherence: -20, type: w.type },
    };
    expect(dash({ log: log2 }).quality.reviews).toBe(0);
  });
});


/* Gauntlet regressions. Each reproduces a defect the review agents
   demonstrated end to end. */
describe('gauntlet: the dashboard is wired to the BIKE retest, and guarded', () => {
  it('ProgressView hands it ftpRetest, not the swim CSS nudge', () => {
    /* Both retest objects are {headline, why, sig}, so passing the swim one
       failed nothing and printed "Verify your swim CSS" under the bike card's
       "Next FTP recommendation". Shape collisions do not throw. */
    const pv = readFileSync(new URL('../features/progress/ProgressView.jsx', import.meta.url), 'utf8');
    const call = pv.match(/<BikeDashboard[^>]*>/s);
    expect(call, 'no BikeDashboard render found').toBeTruthy();
    expect(call[0], 'the bike dashboard is fed the swim retest').toMatch(/retest=\{ftpRetest\}/);
    const app = readFileSync(new URL('../app/App.jsx', import.meta.url), 'utf8');
    expect(app).toMatch(/ftpRetest=\{ftpRetest\}/);
  });

  it('is guarded for run-only and bike-excluded plans, as the swim one is', () => {
    const pv = readFileSync(new URL('../features/progress/ProgressView.jsx', import.meta.url), 'utf8');
    const block = pv.slice(pv.indexOf('<BikeDashboard') - 400, pv.indexOf('<BikeDashboard'));
    expect(block).toMatch(/excludedDiscipline !== 'bike'/);
    expect(block).toMatch(/solo/);
  });
});

describe('gauntlet: a commute cannot erase or invert a long ride’s fuel answer', () => {
  it('matches the workout’s own recording, not the first ride of the day', () => {
    const long = rides.find(w => w.type === 'Long' && w.date > '2026-06-15' && w.date <= TODAY);
    if (!long) return;
    const acts = [
      // a commute recorded EARLIER the same day, honestly answered "nothing"
      { id: 'commute', type: 'Ride', date: long.date, movingTimeSec: 15 * 60 },
      { id: 'thelong', type: 'Ride', date: long.date, movingTimeSec: long.durationMin * 60 },
    ];
    const fuelLog = { commute: { level: 'none', discipline: 'bike' }, thelong: { level: 'race', discipline: 'bike' } };
    const d = dash({ activities: acts, fuelLog });
    expect(d.durability.fuellingMet.value, 'the commute’s answer was scored against the long ride')
      .toBe(100);
  });
});

describe('gauntlet: position answers are read newest-first, inside the window', () => {
  it('recent good answers are not overruled by old bad ones', () => {
    const oldBad = Object.fromEntries([1, 2, 3, 4].map(i =>
      ['old' + i, { comfort: 'bad', symptoms: ['neck'], at: '2026-03-0' + i + 'T10:00:00Z', minutes: 150 }]));
    const newGood = Object.fromEntries([1, 2, 3].map(i =>
      ['new' + i, { comfort: 'easy', symptoms: [], at: '2026-07-1' + i + 'T10:00:00Z', minutes: 200 }]));
    const d = dash({ positionLog: { ...oldBad, ...newGood } });
    expect(d.durability.positionTolerance.value, 'four spring answers decided a July verdict').toBe('build');
  });

  it('answers from outside the window do not count at all', () => {
    const ancient = Object.fromEntries([1, 2, 3, 4].map(i =>
      ['a' + i, { comfort: 'bad', symptoms: [], at: '2025-01-0' + i + 'T10:00:00Z', minutes: 150 }]));
    expect(dash({ positionLog: ancient }).durability.positionTolerance.value).toBe(null);
  });
});

describe('gauntlet: figures describe what they claim to', () => {
  it('a brick’s run leg is not credited as riding', () => {
    const d = dash();
    const bikeOnly = rides.filter(w => w.date >= d.status.windowFrom && w.date < TODAY);
    if (!bikeOnly.length) return;
    expect(d.durability.longestRideMin.value)
      .toBe(Math.max(...bikeOnly.map(w => w.durationMin || 0)));
  });

  it('weekly figures divide by the weeks the plan actually covers', () => {
    // two weeks into a plan, a rider reading a sixth of their real volume
    // under a label saying "a week" is being told something false
    const early = bikeDashboard({
      plan, log: doneLog(), moves: {}, activities: [], todayISO: '2026-06-15',
    });
    const full = dash();
    expect(early.status.weeklyMinutes.value).toBeGreaterThan(0);
    expect(early.status.weeklyMinutes.value, 'the early denominator counted weeks that could not exist')
      .toBeGreaterThan(full.status.weeklyMinutes.value * 0.4);
  });

  it('a session scheduled for today is not yet a missed one', () => {
    const day = rides.find(w => w.date > '2026-06-20' && w.date < TODAY);
    if (!day) return;
    const d = bikeDashboard({
      plan, log: doneLog(), moves: {}, activities: [], todayISO: day.date,
    });
    // everything before today is done, so completion is whole
    expect(d.status.completion.value === null || d.status.completion.value === 1).toBe(true);
  });
});

describe('gauntlet: evidence outranks absence, and claims match what was checked', () => {
  it('a measured problem is named ahead of a missing FTP', () => {
    const p2 = generatePlan({ ...base, ftp: null });
    const log2 = Object.fromEntries(p2.weeks.flatMap(w => w.workouts)
      .filter(w => w.date <= TODAY).map(w => [w.id, { done: true }]));
    const d = bikeDashboard({ plan: p2, log: log2, moves: {}, activities: [], todayISO: TODAY });
    const withBrick = { ...d, brick: { executions: [], pattern: { text: 'Your last 2 brick runs came in well down.' } } };
    expect(bikeLimiter(withBrick).id, 'a recorded brick pattern was masked by a missing FTP')
      .toBe('bike-to-run');
  });

  it('readiness does not claim efforts land when none were judged', () => {
    const r = bikeReadiness(dash());
    expect(r.byId.fitness.state, 'claimed ready with no judged efforts at all').toBe('unknown');
    expect(r.byId.fitness.evidence).toMatch(/no judged efforts/);
  });

  it('pacing can reach at-risk, not only building', () => {
    const d = dash();
    const far = { ...d, quality: { ...d.quality, adherence: { value: -30, kind: 'recorded', note: '%' } } };
    expect(bikeReadiness(far).byId.pacing.state).toBe('at-risk');
  });

  it('the all-clear headline is not shown to an athlete with no data', () => {
    const d = bikeDashboard({ plan, log: {}, moves: {}, activities: [], todayISO: '2026-06-02' });
    expect(d.limiter.id).toBe('too-early');
    expect(d.limiter.headline).not.toMatch(/Nothing is obviously holding/);
  });

  it('promises no plan behaviour that does not exist', () => {
    /* These render under "What the plan does about it". Four of them once
       described rules no phase ever built. */
    const d = dash();
    const all = [];
    ['consistency', 'bike-to-run', 'durability', 'fuelling', 'threshold', 'aero-tolerance', 'data-confidence']
      .forEach(id => {
        const fake = { ...d };
        if (id === 'bike-to-run') fake.brick = { executions: [], pattern: { text: 'x' } };
        if (id === 'durability') fake.durability = { ...d.durability, lateFadePct: { value: 9, kind: 'recorded' } };
        if (id === 'fuelling') fake.durability = { ...d.durability, fuellingMet: { value: 10, kind: 'reported' } };
        if (id === 'threshold') fake.quality = { ...d.quality, adherence: { value: -9, kind: 'recorded' } };
        if (id === 'aero-tolerance') fake.durability = { ...d.durability, positionTolerance: { value: 'back-off', kind: 'reported', note: 'n' } };
        if (id === 'data-confidence') fake.status = { ...d.status, ftpWatts: { value: null, kind: 'missing' } };
        all.push(...bikeLimiter(fake).response);
      });
    const text = all.join(' ');
    // the four claims that were untrue
    expect(text).not.toMatch(/holds bike intensity in the week of a brick/);
    expect(text).not.toMatch(/keeps the position work in shorter blocks/);
    expect(text).not.toMatch(/adds long-ride duration instead/);
    expect(text).not.toMatch(/ramp test/);
    // and where the plan does nothing, it says so rather than inventing
    expect(text).toMatch(/yours to act on|yours: the plan does not/);
  });
});

describe('gauntlet: §1’s first question is answered', () => {
  it('reports whether the FTP has moved, using the phase 2 history', () => {
    /* A FRESH profile object. generatePlan keeps a reference to the profile
       it was given, so mutating one plan's profile reaches every other plan
       built from the same literal — which polluted the test below this one. */
    const p2 = generatePlan({
      ...base,
      fitnessHistory: [{ date: '2026-03-01', ftp: 230 }],
      ftpMeta: { source: 'try-test', measuredAt: '2026-06-01', confidence: 'high' },
    });
    const d = bikeDashboard({ plan: p2, log: doneLog(), moves: {}, activities: [], todayISO: TODAY });
    expect(d.status.ftpTrend.value).toBe(20);
    expect(d.status.ftpTrend.note).toMatch(/230 W to 250 W/);
  });

  it('says there is no trend rather than inventing one from a single reading', () => {
    expect(dash().status.ftpTrend.value).toBe(null);
    expect(dash().status.ftpTrend.note).toMatch(/one measurement/);
  });
});

describe('gauntlet: the race date is read from where it lives', () => {
  it('daysToRace is a number, not permanently null', () => {
    const d = dash();
    expect(typeof d.daysToRace).toBe('number');
    expect(d.daysToRace).toBeGreaterThan(0);
  });
});

describe('gauntlet: raced tune-ups stay out of the training-riding figures (design panel 2026-07-30)', () => {
  it('a bRace brick moves the rides-per-week figure neither logged nor skipped', () => {
    /* These figures describe training riding — a race is an outcome, not a
       prescribed dose — so ridesIn must agree with isTrainingRide, which
       already refuses raced rides. Proven behaviourally: with the tune-up
       excluded, logging it or not cannot move the figure. */
    const day = plan.weeks.flatMap(w => w.workouts)
      .find(w => w.date >= '2026-07-06' && w.date <= '2026-07-18'
        && w.discipline !== 'rest' && !w.second && !w.race).date;
    const p2 = generatePlan({ ...base, bRaces: [{ date: day, kind: 'olympic' }] });
    const tune = p2.weeks.flatMap(w => w.workouts).find(w => w.bRace);
    expect(tune.discipline).toBe('brick');
    const logAll = Object.fromEntries(p2.weeks.flatMap(w => w.workouts)
      .filter(w => w.date <= TODAY).map(w => [w.id, { done: true }]));
    const logSans = { ...logAll };
    delete logSans[tune.id];
    const withTune = bikeDashboard({ plan: p2, log: logAll, moves: {}, activities: [], todayISO: TODAY });
    const without = bikeDashboard({ plan: p2, log: logSans, moves: {}, activities: [], todayISO: TODAY });
    expect(withTune.status.ridesPerWeek.value).toBe(without.status.ridesPerWeek.value);
  });
});
