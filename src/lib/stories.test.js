import { describe, it, expect } from 'vitest';
import { progressStories, STORY_WINDOW_DAYS } from './stories.js';
import { RUN_RAMP_RULES } from './runload.js';
import { generatePlan } from './plan.js';
import { iso, addDays } from './date.js';

/* Progress stories: recency-windowed, self-expiring, engine-certified.
   todayISO is injected everywhere, so nothing here couples to the clock. */

const TODAY = '2026-07-15';
const ago = n => iso(addDays(TODAY, -n));
const run = (daysAgo, min, km) => ({ id: 'r' + daysAgo, type: 'Run', date: ago(daysAgo), movingTimeSec: min * 60, distance: km ? km * 1000 : undefined });
const ride = (daysAgo, min) => ({ id: 'b' + daysAgo, type: 'Ride', date: ago(daysAgo), movingTimeSec: min * 60 });
const read = (daysAgo, discipline, band) => ({ activityId: 'a' + daysAgo + discipline, date: ago(daysAgo), discipline, durationMin: 90, read: { band } });

const stories = over => progressStories({
  activities: [], durability: [], plan: null, log: {}, moves: {},
  decisionLog: [], runLoad: null, todayISO: TODAY, ...over,
});
const ids = over => stories(over).map(s => s.id);

describe('S1 durability streak', () => {
  const held = d => [read(2, d, 'held-strong'), read(9, d, 'held-strong'), read(16, d, 'held-strong')];

  it('fires per discipline on three held-strong reads with a fresh newest', () => {
    expect(ids({ durability: held('run') })).toContain('durability-run');
    const s = stories({ durability: held('bike') });
    expect(s.find(x => x.id === 'durability-bike').text).toContain('long rides');
    expect(s.find(x => x.id === 'durability-bike').text).not.toContain('runs');
  });

  it('a fade in the last three, only two reads, or a stale newest all stay silent', () => {
    expect(ids({ durability: [read(2, 'run', 'held-strong'), read(9, 'run', 'faded-a-little'), read(16, 'run', 'held-strong')] })).toEqual([]);
    expect(ids({ durability: held('run').slice(0, 2) })).toEqual([]);
    expect(ids({ durability: [read(STORY_WINDOW_DAYS + 1, 'run', 'held-strong'), read(20, 'run', 'held-strong'), read(27, 'run', 'held-strong')] })).toEqual([]);
  });

  it('null reads (unreadable recordings) never count either way', () => {
    expect(ids({ durability: [{ date: ago(1), discipline: 'run', read: null }, ...held('run')] })).toContain('durability-run');
  });
});

describe('S2 rising run volume', () => {
  // three complete rising weeks: activities on Mondays 3, 2 and 1 weeks back
  const rising = [run(21, 40, 20), run(14, 45, 25), run(7, 50, 30)];

  it('fires only when the ramp signal certifies the guideline', () => {
    expect(ids({ activities: rising, runLoad: { rampPct: RUN_RAMP_RULES.buildPct } })).toContain('run-volume');
    expect(ids({ activities: rising, runLoad: { rampPct: RUN_RAMP_RULES.buildPct + 0.01 } })).not.toContain('run-volume');
    expect(ids({ activities: rising, runLoad: null })).not.toContain('run-volume');
  });

  it('a flat or falling week stays silent', () => {
    const flat = [run(21, 40, 25), run(14, 45, 25), run(7, 50, 30)];
    expect(ids({ activities: flat, runLoad: { rampPct: 0 } })).not.toContain('run-volume');
  });

  it('the current incomplete week is excluded from the rising check', () => {
    // rising over complete weeks; a tiny run TODAY must not break the streak
    const withToday = [...rising, run(0, 10, 2)];
    expect(ids({ activities: withToday, runLoad: { rampPct: 0 } })).toContain('run-volume');
  });
});

describe('S3 longest recorded session', () => {
  it('fires on a fresh strict record with two priors, per discipline noun', () => {
    const acts = [ride(40, 60), ride(30, 75), ride(3, 95)];
    const s = stories({ activities: acts });
    expect(s.find(x => x.id === 'longest-bike').text).toContain('longest recorded ride');
    expect(s.find(x => x.id === 'longest-bike').text).toContain('1h 35m');
  });

  it('stale records, ties, and thin history stay silent', () => {
    expect(ids({ activities: [ride(60, 60), ride(50, 75), ride(STORY_WINDOW_DAYS + 5, 95)] })).toEqual([]);
    expect(ids({ activities: [ride(40, 95), ride(30, 60), ride(3, 95)] })).toEqual([]); // tie
    expect(ids({ activities: [ride(30, 60), ride(3, 95)] })).toEqual([]); // one prior only
  });
});

describe('S4 benchmark completed', () => {
  const profile = {
    name: 'P', raceType: 'olympic', fitness: 'intermediate',
    fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
    trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
    startDate: '2026-06-01', raceDate: '2026-09-27',
  };

  it('a logged test inside the window tells its story; outside it expires', () => {
    const plan = generatePlan(profile);
    const test = plan.weeks.flatMap(w => w.workouts).find(w => w.test);
    expect(test, 'no test generated').toBeTruthy();
    const log = { [test.id]: { done: true } };
    const inWindow = progressStories({ activities: [], durability: [], plan, log, moves: {}, decisionLog: [], runLoad: null, todayISO: iso(addDays(test.date, 3)) });
    expect(inWindow.map(s => s.id)).toContain('benchmark');
    expect(inWindow.find(s => s.id === 'benchmark').text).toContain(test.title);
    const late = progressStories({ activities: [], durability: [], plan, log, moves: {}, decisionLog: [], runLoad: null, todayISO: iso(addDays(test.date, STORY_WINDOW_DAYS + 1)) });
    expect(late.map(s => s.id)).not.toContain('benchmark');
  });

  it('tracker (plan null) simply has no benchmark story; activity stories still work', () => {
    const s = stories({ plan: null, activities: [ride(40, 60), ride(30, 75), ride(3, 95)] });
    expect(s.map(x => x.id)).toContain('longest-bike');
    expect(s.map(x => x.id)).not.toContain('benchmark');
  });
});

describe('S5 accepted proposal', () => {
  const row = (daysAgo, status, id = 'd1') => ({ id, at: ago(daysAgo) + 'T10:00:00.000Z', status, headline: 'Retarget your FTP to a tested number' });

  it('quotes the latest accepted headline; a later rejection retracts it', () => {
    const s = stories({ decisionLog: [row(3, 'accepted')] });
    expect(s.find(x => x.id === 'accepted').text).toBe('Accepted this week: Retarget your FTP to a tested number');
    expect(ids({ decisionLog: [row(5, 'accepted'), row(2, 'rejected')] })).not.toContain('accepted');
    expect(ids({ decisionLog: [row(STORY_WINDOW_DAYS + 2, 'accepted')] })).not.toContain('accepted');
  });
});

describe('hygiene', () => {
  it('everything empty yields no stories, and output caps at four', () => {
    expect(stories({})).toEqual([]);
    const flood = {
      durability: [read(2, 'run', 'held-strong'), read(9, 'run', 'held-strong'), read(16, 'run', 'held-strong'),
        read(3, 'bike', 'held-strong'), read(10, 'bike', 'held-strong'), read(17, 'bike', 'held-strong')],
      activities: [run(21, 40, 20), run(14, 45, 25), run(7, 50, 30), run(2, 120, 32),
        ride(40, 60), ride(30, 75), ride(3, 95)],
      runLoad: { rampPct: 0 },
      decisionLog: [row3()],
    };
    function row3() { return { id: 'd9', at: ago(1) + 'T10:00:00.000Z', status: 'accepted', headline: 'H' }; }
    expect(stories(flood).length).toBeLessThanOrEqual(4);
  });

  it('copy lint: no em dashes and no render-pin banned words in any story branch', () => {
    const branches = [
      stories({ durability: [read(2, 'run', 'held-strong'), read(9, 'run', 'held-strong'), read(16, 'run', 'held-strong')] }),
      stories({ durability: [read(2, 'bike', 'held-strong'), read(9, 'bike', 'held-strong'), read(16, 'bike', 'held-strong')] }),
      stories({ activities: [run(21, 40, 20), run(14, 45, 25), run(7, 50, 30)], runLoad: { rampPct: 0 } }),
      stories({ activities: [ride(40, 60), ride(30, 75), ride(3, 95)] }),
      stories({ activities: [run(40, 60, 8), run(30, 75, 10), run(3, 95, 14)] }),
      stories({ decisionLog: [{ id: 'd1', at: ago(1) + 'T10:00:00.000Z', status: 'accepted', headline: 'H' }] }),
    ].flat();
    expect(branches.length).toBeGreaterThan(4);
    for (const s of branches) {
      expect(s.text).not.toContain('—');
      // ProgressView.test.jsx asserts not.toMatch(/gain|loss|under|over the/i)
      // over whole-Overview HTML; story copy must never trip it
      expect(s.text).not.toMatch(/gain|loss|under|over the/i);
    }
  });
});
