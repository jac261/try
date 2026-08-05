import { describe, it, expect } from 'vitest';
import { weekStrip } from './week-strip.js';

/* The week strip had no test coverage in any form before this: the card it
   replaces was pinned by nothing, and the harness passed an empty log, so
   even its done state was unreachable. These are the cases the design has no
   answer for — a double day, a race, a miss, a rescheduled session — plus
   the totals, which must come from the days rather than from a plan week. */

const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const TODAY = '2026-08-05'; // Wednesday

const w = (id, date, discipline, durationMin, over = {}) => ({
  id, date, discipline, durationMin, title: discipline + ' session', type: 'Easy', ...over,
});
// one plan week holding whatever the test needs
const planOf = (...workouts) => ({ totalWeeks: 12, weeks: [{ index: 3, phase: 'build', start: WEEK[0], totalMin: 999, workouts }] });
const call = (plan, over = {}) => weekStrip({ plan, log: {}, moves: {}, adjust: {}, missedReasons: {}, todayISO: TODAY, ...over });

describe('the seven days', () => {
  it('lays out the calendar week around today, Monday first', () => {
    const s = call(planOf(w('a', WEEK[0], 'swim', 45)));
    expect(s.days.map(d => d.date)).toEqual(WEEK);
    expect(s.range).toEqual({ start: WEEK[0], end: WEEK[6] });
    expect(s.days[2].isToday).toBe(true);
    expect(s.days[0].isPast).toBe(true);
    expect(s.days[6].isPast).toBe(false);
  });

  it('a day with no session is a rest day, not an empty one', () => {
    const s = call(planOf(w('a', WEEK[0], 'swim', 45)));
    expect(s.days[1].rest).toBe(true);
    expect(s.days[1].status).toBe('rest');
    expect(s.days[1].sessions).toEqual([]);
  });

  it('carries every session on a double day, which the design never shows', () => {
    const s = call(planOf(w('a', WEEK[5], 'swim', 45), w('b', WEEK[5], 'bike', 150)));
    expect(s.days[5].sessions.map(x => x.discipline)).toEqual(['swim', 'bike']);
    expect(s.days[5].totalMin).toBe(195);
  });

  it('a rescheduled session belongs to the week it now sits in', () => {
    // planned last week, moved onto Saturday: it is this week's work now
    const plan = planOf(w('moved', '2026-07-30', 'bike', 120));
    const s = call(plan, { moves: { moved: WEEK[5] } });
    expect(s.days[5].sessions.map(x => x.id)).toEqual(['moved']);
    expect(s.counts.planned).toBe(1);
    // and the totals follow it, rather than reading the plan week's own sum
    expect(s.minutes.planned).toBe(120);
  });

  it('explicit rest workouts never become sessions', () => {
    const s = call(planOf(w('r', WEEK[1], 'rest', 0)));
    expect(s.days[1].rest).toBe(true);
    expect(s.counts.planned).toBe(0);
  });
});

describe('status, delegated to the coach\'s own classifier', () => {
  it('a past unlogged session reads missed', () => {
    const s = call(planOf(w('a', WEEK[0], 'run', 60)));
    expect(s.days[0].status).toBe('missed');
    expect(s.days[0].sessions[0].status).toBe('missed-unknown');
  });

  it('the athlete\'s own reason rides along rather than being guessed', () => {
    // the reasons are coach.js's own set (tired/life/niggle/choice); an
    // unrecognised one falls back to missed-unknown rather than inventing
    const s = call(planOf(w('a', WEEK[0], 'run', 60)), { missedReasons: { a: 'niggle' } });
    expect(s.days[0].sessions[0].status).toBe('missed-niggle');
    expect(s.days[0].status).toBe('missed');
    expect(call(planOf(w('a', WEEK[0], 'run', 60)), { missedReasons: { a: 'nonsense' } })
      .days[0].sessions[0].status).toBe('missed-unknown');
  });

  it('a ticked session is done, and a fully ticked day is done', () => {
    const s = call(planOf(w('a', WEEK[0], 'run', 60)), { log: { a: { done: true, actualMin: 62 } } });
    expect(s.days[0].status).toBe('done');
    expect(s.days[0].sessions[0].done).toBe(true);
    // the recorded time beats the planned one
    expect(s.days[0].totalMin).toBe(62);
  });

  it('one miss on a double day makes the whole day read missed', () => {
    const s = call(planOf(w('a', WEEK[0], 'swim', 45), w('b', WEEK[0], 'bike', 90)),
      { log: { a: { done: true } } });
    expect(s.days[0].status).toBe('missed');
  });

  it('today is now, and a future day is ahead', () => {
    const s = call(planOf(w('a', TODAY, 'run', 60), w('b', WEEK[5], 'bike', 120)));
    expect(s.days[2].status).toBe('now');
    expect(s.days[5].status).toBe('ahead');
  });

  it('a race day is flagged and keeps its own colour', () => {
    const s = call(planOf(w('r', WEEK[6], 'run', 90, { race: true, title: 'Olympic' })));
    expect(s.days[6].sessions[0].race).toBe(true);
    expect(s.days[6].sessions[0].colour).toBe('#facc15');
  });
});

describe('the totals come from the days', () => {
  it('counts, minutes and load are all built from the week\'s own sessions', () => {
    const plan = planOf(
      w('a', WEEK[0], 'swim', 45), w('b', WEEK[1], 'bike', 90), w('c', WEEK[5], 'run', 60),
    );
    const s = call(plan, { log: { a: { done: true, actualMin: 50 } } });
    expect(s.counts).toEqual({ done: 1, planned: 3, remaining: 2 });
    expect(s.minutes.done).toBe(50);
    expect(s.minutes.planned).toBe(200);   // 50 recorded + 90 + 60
    expect(s.tss.planned).toBeGreaterThan(s.tss.done);
    expect(s.tss.done).toBeGreaterThan(0);
  });

  it('the headline counts down, and says something sane at both edges', () => {
    const three = planOf(w('a', WEEK[0], 'swim', 45), w('b', WEEK[1], 'bike', 90), w('c', WEEK[5], 'run', 60));
    expect(call(three).headline).toBe('3 sessions this week');
    expect(call(three, { log: { a: { done: true } } }).headline).toBe('1 down, 2 to go');
    expect(call(three, { log: { a: { done: true }, b: { done: true }, c: { done: true } } }).headline)
      .toBe('3 done, week complete');
    expect(call(planOf()).headline).toBe('Nothing planned');
  });

  it('labels the range in the athlete\'s own locale order, naming both months only across two', () => {
    // asserted by content, not by an exact string: the order is the locale's
    // and formatRange drops a repeated month itself
    const within = call(planOf(w('a', WEEK[0], 'run', 60))).label;
    expect(within).toMatch(/\b3\b/);
    expect(within).toMatch(/\b9\b/);
    expect(within.match(/Aug/g).length).toBe(1);
    const across = weekStrip({
      plan: planOf(w('a', '2026-07-30', 'run', 60)), log: {}, moves: {}, adjust: {},
      missedReasons: {}, todayISO: '2026-07-30',
    }).label;
    expect(across).toContain('Jul');
    expect(across).toContain('Aug');
  });
});

describe('up next never repeats what the screen already shows', () => {
  it('picks the earliest unlogged session strictly after today', () => {
    const s = call(planOf(w('today', TODAY, 'run', 60), w('thu', WEEK[3], 'swim', 45), w('sat', WEEK[5], 'bike', 120)));
    expect(s.upNext.id).toBe('thu');
    expect(s.upNext.when).toBe('TOMORROW');
  });

  it('names the weekday when it is further out', () => {
    const s = call(planOf(w('sat', WEEK[5], 'bike', 120)));
    expect(s.upNext.id).toBe('sat');
    expect(s.upNext.when).toBe('SATURDAY');
  });

  it('skips what is already ticked, and is null when the week is spent', () => {
    const plan = planOf(w('thu', WEEK[3], 'swim', 45), w('sat', WEEK[5], 'bike', 120));
    expect(call(plan, { log: { thu: { done: true } } }).upNext.id).toBe('sat');
    expect(call(plan, { log: { thu: { done: true }, sat: { done: true } } }).upNext).toBe(null);
    expect(call(planOf(w('mon', WEEK[0], 'run', 60))).upNext).toBe(null);
  });
});

describe('the note chips are facts or they are absent', () => {
  it('names the long session by its own discipline, and the rest days', () => {
    const s = call(planOf(
      w('a', WEEK[5], 'bike', 180, { role: 'long' }), w('b', WEEK[0], 'swim', 45),
    ));
    expect(s.notes).toContain('Sat is the long ride');
    // Tue-Fri and Sun hold nothing: five rest days, counted rather than listed
    expect(s.notes).toContain('5 rest days');
  });

  it('a race outranks the long session rather than crowding it', () => {
    const s = call(planOf(
      w('r', WEEK[6], 'run', 90, { race: true }), w('l', WEEK[5], 'bike', 180, { role: 'long' }),
    ));
    expect(s.notes).toContain('Sun is race day');
    expect(s.notes.some(n => /long/.test(n))).toBe(false);
  });

  it('names one rest day singly and two by name', () => {
    // a week training every day but Friday
    const full = WEEK.filter((_, i) => i !== 4).map((d, i) => w('w' + i, d, 'run', 60));
    expect(call(planOf(...full)).notes).toContain('Fri off');
    const two = WEEK.filter((_, i) => i !== 4 && i !== 6).map((d, i) => w('w' + i, d, 'run', 60));
    expect(call(planOf(...two)).notes).toContain('Fri and Sun off');
  });

  it('invents nothing when there is nothing to say', () => {
    const everyDay = WEEK.map((d, i) => w('w' + i, d, 'run', 60));
    expect(call(planOf(...everyDay)).notes).toEqual([]);
  });
});

describe('refusals', () => {
  it('returns null without a plan rather than an empty shell', () => {
    expect(weekStrip({ plan: null, todayISO: TODAY })).toBe(null);
    expect(weekStrip({ plan: { weeks: [] }, todayISO: TODAY })).toBe(null);
  });

  it('survives being handed nothing but a plan', () => {
    const s = weekStrip({ plan: planOf(w('a', WEEK[0], 'run', 60)), todayISO: TODAY });
    expect(s.days.length).toBe(7);
    expect(s.counts.planned).toBe(1);
  });
});

describe('the day\'s key session, since a cell fits one chip', () => {
  it('Jon\'s Thursday: the tempo outranks the endurance double hanging off it', () => {
    // the volume double, verbatim from an olympic week 1
    const s = call(planOf(
      w('tempo', WEEK[3], 'bike', 55, { type: 'Tempo', role: 'quality' }),
      w('vol', WEEK[3], 'bike', 40, { type: 'Endurance', role: 'easy', second: true }),
    ));
    expect(s.days[3].key.id).toBe('tempo');
    expect(s.days[3].extra).toBe(1);
  });

  it('the day\'s event outranks everything', () => {
    const s = call(planOf(
      w('race', WEEK[6], 'run', 90, { race: true }),
      w('warm', WEEK[6], 'swim', 20),
      w('str', WEEK[6], 'strength', 40, { second: true }),
    ));
    expect(s.days[6].key.id).toBe('race');
    expect(s.days[6].extra).toBe(2);
  });

  it('a test or tune-up outranks an ordinary longer session', () => {
    const s = call(planOf(
      w('css', WEEK[1], 'swim', 45, { key: true, test: true }),
      w('ride', WEEK[1], 'bike', 120),
    ));
    expect(s.days[1].key.id).toBe('css');
  });

  it('with nothing else to separate them, the longest wins', () => {
    const s = call(planOf(w('short', WEEK[2], 'swim', 30), w('long', WEEK[2], 'bike', 90)));
    expect(s.days[2].key.id).toBe('long');
  });

  it('an exact tie breaks on id, so a stable schedule renders stably', () => {
    const a = call(planOf(w('aaa', WEEK[2], 'swim', 60), w('bbb', WEEK[2], 'bike', 60)));
    const b = call(planOf(w('bbb', WEEK[2], 'bike', 60), w('aaa', WEEK[2], 'swim', 60)));
    expect(a.days[2].key.id).toBe('aaa');
    expect(b.days[2].key.id).toBe('aaa');
  });

  it('a single session is its own key, and a rest day has none', () => {
    const s = call(planOf(w('only', WEEK[0], 'run', 60)));
    expect(s.days[0].key.id).toBe('only');
    expect(s.days[0].extra).toBe(0);
    expect(s.days[1].key).toBe(null);
    expect(s.days[1].extra).toBe(0);
  });
});
