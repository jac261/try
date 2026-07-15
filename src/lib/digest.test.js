import { describe, it, expect } from 'vitest';
import { reviewedWeekMonday, digestWindowOpen, buildWeeklyDigest } from './digest.js';
import { estimateTss } from './adapt.js';

// 2026-07-06 is a Monday; 2026-07-12 the Sunday closing that week.
const MON = '2026-07-06', SUN = '2026-07-12', NEXT_MON = '2026-07-13';

const wk = (index, phase, workouts) => ({ index, phase, workouts });
const w = (id, date, over = {}) => ({ id, date, discipline: 'run', type: 'Easy', title: 'Easy Run', durationMin: 50, ...over });
const plan = over => ({
  race: 'olympic', totalWeeks: 2,
  weeks: [
    wk(0, 'Build', [
      w('0-0', '2026-07-06'),
      w('0-1', '2026-07-08', { type: 'Threshold', title: 'Threshold Run' }),
      w('0-2', '2026-07-10', { discipline: 'rest', type: 'Rest' }),
      w('0-3', '2026-07-11', { discipline: 'bike', type: 'Endurance', title: 'Endurance Ride', durationMin: 75 }),
    ]),
    wk(1, 'Build', [
      w('1-0', '2026-07-14'),
      w('1-1', '2026-07-16', { test: true, title: '5k Time Trial' }),
    ]),
  ],
  ...over,
});

describe('reviewedWeekMonday (which week wraps)', () => {
  it('Sunday evening wraps the week ending today; Sunday afternoon still wraps last week', () => {
    expect(reviewedWeekMonday(SUN, 17)).toBe(MON);
    expect(reviewedWeekMonday(SUN, 21)).toBe(MON);
    expect(reviewedWeekMonday(SUN, 16)).toBe('2026-06-29');
  });
  it('Monday through Saturday wrap the finished week', () => {
    expect(reviewedWeekMonday(NEXT_MON, 9)).toBe(MON);
    expect(reviewedWeekMonday('2026-07-18', 12)).toBe(MON); // Saturday
  });
});

describe('digestWindowOpen (the card lapses on its own)', () => {
  it('open through the Wednesday after the reviewed Sunday, gone Thursday', () => {
    expect(digestWindowOpen(MON, '2026-07-15')).toBe(true);  // Wednesday
    expect(digestWindowOpen(MON, '2026-07-16')).toBe(false); // Thursday
  });
});

describe('buildWeeklyDigest (plan mode)', () => {
  const base = { plan: plan(), log: {}, moves: {}, adjust: {}, adjustLog: [], wellness: [], activities: null, todayISO: NEXT_MON, weekMonday: MON };
  const done = { '0-0': { done: true, at: '2026-07-06T18:00:00Z' }, '0-3': { done: true, at: '2026-07-11T10:00:00Z', actualMin: 80 } };

  it('counts done against planned, rest days excluded, recorded minutes beating planned', () => {
    const d = buildWeeklyDigest({ ...base, log: done });
    expect(d.planned).toBe(3);           // rest day is not a session
    expect(d.done).toBe(2);
    expect(d.totalMin).toBe(130);        // 50 planned + 80 actual
    expect(d.loadEstimated).toBe(true);  // plan-mode load always wears the tilde
    // exact: through estimateTss (intensity-weighted), never a raw minute sum
    const expected = Math.round(
      estimateTss({ type: 'Easy', durationMin: 50 }, undefined, undefined)
      + estimateTss({ type: 'Endurance', durationMin: 75 }, undefined, 80));
    expect(d.load).toBe(expected);
    expect(d.load).not.toBe(d.totalMin);
  });

  it('a moved session counts in the week it landed, not the week it left', () => {
    const moves = { '0-1': NEXT_MON };   // Threshold moved out of the week
    const d = buildWeeklyDigest({ ...base, log: done, moves });
    expect(d.planned).toBe(2);
    const ahead = buildWeeklyDigest({ ...base, log: done, moves });
    expect(ahead.ahead.sessions).toBe(3); // and it lands in next week's count
  });

  it('missed = strictly past and unlogged; a session sitting on today is not missed yet', () => {
    const d = buildWeeklyDigest({ ...base, log: done, todayISO: '2026-07-11' });
    // 0-1 (Jul 8) unlogged and past → missed; 0-3 (Jul 11) is today → not missed
    expect(d.missed.map(m => m.title)).toEqual(['Threshold Run']);
  });

  it('quotes accepted proposals verbatim from the journal and never re-derives', () => {
    const adjustLog = [
      { at: '2026-07-09T08:00:00Z', kind: 'trim-week', headline: 'Pull back next week', why: 'Form said so.' },
      { at: '2026-06-20T08:00:00Z', kind: 'boost-week', headline: 'Old news', why: 'outside the week' },
    ];
    const d = buildWeeklyDigest({ ...base, log: done, adjustLog });
    expect(d.engine).toEqual([{ headline: 'Pull back next week', why: 'Form said so.' }]);
  });

  it('an overlay entry born from a journalled proposal is not repeated as a generic row', () => {
    const at = '2026-07-09T08:00:00.123Z'; // applyWeekly stamps both with ONE timestamp
    const adjustLog = [{ at, kind: 'trim-week', headline: 'Pull back next week', why: 'Form said so.' }];
    const adjust = { '0-1': { kind: 'trim', factor: 0.7, at }, '0-3': { kind: 'ease', at } };
    const d = buildWeeklyDigest({ ...base, log: done, adjust, adjustLog });
    expect(d.engine).toEqual([{ headline: 'Pull back next week', why: 'Form said so.' }]);
  });

  it('overlay adjustments without a journal entry get one generic line, never a factor', () => {
    const adjust = { '0-1': { kind: 'ease', at: '2026-07-08T07:00:00Z' } };
    const d = buildWeeklyDigest({ ...base, log: done, adjust });
    expect(d.engine).toHaveLength(1);
    expect(d.engine[0].headline).toContain('Threshold Run');
    expect(d.engine[0].headline).not.toMatch(/0\.\d|factor/);
  });

  it('fitness line needs both endpoints and uses the chart words verbatim', () => {
    const wellness = [
      { date: '2026-07-05', ctl: 60, atl: 60, tsb: 0 },
      { date: '2026-07-12', ctl: 63, atl: 70, tsb: -7 },
    ];
    const d = buildWeeklyDigest({ ...base, log: done, wellness });
    expect(d.fitness.delta).toBe(3);
    expect(d.fitness.word).toBe('Building');   // rampZone label verbatim
    expect(d.fitness.formWord).toBe('Grey zone'); // formZone label verbatim (tsb -7)
    // no pre-week reading → no line, never a guess
    expect(buildWeeklyDigest({ ...base, log: done, wellness: [wellness[1]] }).fitness).toBe(null);
    // no reading inside the week → stale data never relabelled as this week's
    expect(buildWeeklyDigest({ ...base, log: done, wellness: [wellness[0]] }).fitness).toBe(null);
  });

  it('a race that passed without a recording lands in missed; a logged one in raceDone', () => {
    const raced = plan();
    raced.weeks[0].workouts.push(w('0-9', '2026-07-12', { race: true, title: 'Olympic Tri', type: 'RACE' }));
    const skipped = buildWeeklyDigest({ ...base, plan: raced, log: done });
    expect(skipped.missed.map(m => m.title)).toContain('Olympic Tri');
    expect(skipped.raceDone).toEqual([]);
    const logged = buildWeeklyDigest({ ...base, plan: raced, log: { ...done, '0-9': { done: true, at: '2026-07-12T10:00:00Z' } } });
    expect(logged.raceDone).toEqual(['Olympic Tri']);
    expect(logged.missed.map(m => m.title)).not.toContain('Olympic Tri');
  });

  it('week identity survives every session moving out: phase comes from native dates', () => {
    // move the whole reviewed week into the next one; a week-1 session moves in
    const moves = { '0-0': NEXT_MON, '0-1': NEXT_MON, '0-3': NEXT_MON, '1-0': '2026-07-09' };
    const d = buildWeeklyDigest({ ...base, moves });
    expect(d.weekNo).toBe(1); // still week 1, not the week that lent a session
    expect(d.planned).toBe(1); // the moved-in session
  });

  it('the week ahead is descriptive: counts, phase, standout days, adjusted as a fact', () => {
    const d = buildWeeklyDigest({ ...base, log: done });
    expect(d.ahead).toEqual({ phase: 'Build', sessions: 2, totalMin: 100, keys: ['5k Time Trial'], adjusted: false });
    const adjusted = buildWeeklyDigest({ ...base, log: done, adjust: { '1-0': { kind: 'trim', factor: 0.7, at: 'x' } } });
    expect(adjusted.ahead.adjusted).toBe(true);
  });

  it('an empty week returns null — no digest fabricated from nothing', () => {
    const empty = { ...base, weekMonday: '2026-06-01', todayISO: '2026-06-08' };
    expect(buildWeeklyDigest(empty)).toBe(null);
  });
});

describe('buildWeeklyDigest (tracker mode)', () => {
  const tplan = { race: 'tracker', totalWeeks: 0, weeks: [] };
  const acts = [
    { id: 'a1', date: '2026-07-07', movingTimeSec: 3600, trainingLoad: 60 },
    { id: 'a2', date: '2026-07-11', movingTimeSec: 1800, trainingLoad: null },
    { id: 'a3', date: '2026-07-20', movingTimeSec: 3600, trainingLoad: 50 }, // outside
  ];

  it('reads the recorded feed directly: counts, minutes, measured load without a tilde', () => {
    const d = buildWeeklyDigest({ plan: tplan, log: {}, moves: {}, adjust: {}, adjustLog: [], wellness: [], activities: acts, todayISO: NEXT_MON, weekMonday: MON });
    expect(d.tracker).toBe(true);
    expect(d.done).toBe(2);
    expect(d.planned).toBe(null);      // no plan, no denominator
    expect(d.totalMin).toBe(90);
    expect(d.load).toBe(60);           // sums only what the feed measured
    expect(d.loadEstimated).toBe(false);
    expect(d.engine).toEqual([]);      // no engine rows without a plan
  });

  it('a week with no recordings returns null', () => {
    expect(buildWeeklyDigest({ plan: tplan, log: {}, moves: {}, adjust: {}, adjustLog: [], wellness: [], activities: [], todayISO: NEXT_MON, weekMonday: MON })).toBe(null);
  });
});
