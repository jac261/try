import { describe, it, expect } from 'vitest';
import { mergeActivities, manualToActivity, SPORT_FEED_TYPE } from './manual.js';

const entry = over => ({
  id: 'm1', date: '2026-07-14', sport: 'run', sessionType: 'Easy',
  durationMin: 40, trainingLoad: 33, feel: 'right', createdAt: 'x', editedAt: null, ...over,
});

describe('manualToActivity (the diary in feed shape)', () => {
  it('maps sport to the feed type vocabulary and wears the honesty flags', () => {
    const a = manualToActivity(entry());
    expect(a.type).toBe('Run');
    expect(a.movingTimeSec).toBe(2400);
    expect(a.manual).toBe(true);
    expect(a.estimated).toBe(true);
    expect(a.manualId).toBe('m1');
    expect(a.id).toBe('manual-m1');
    expect(SPORT_FEED_TYPE.strength).toBe('WeightTraining');
  });
});

describe('mergeActivities (feed + diary, shadow dedup)', () => {
  it('with no feed the diary IS the list, date sorted', () => {
    const out = mergeActivities(null, [entry({ id: 'b', date: '2026-07-15' }), entry({ id: 'a' })]);
    expect(out.map(a => a.date)).toEqual(['2026-07-14', '2026-07-15']);
    expect(out.every(a => a.manual)).toBe(true);
  });

  it('a feed recording that would have auto-matched shadows the manual entry', () => {
    // same day, same sport, 45 min recorded vs 40 logged: inside [0.5x, 1.7x]
    const feed = [{ id: 9, date: '2026-07-14', type: 'Run', movingTimeSec: 45 * 60 }];
    const out = mergeActivities(feed, [entry()]);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe(9); // the recording wins, the manual row steps aside
  });

  it('feed variant types shadow too: a treadmill VirtualRun hides a logged run', () => {
    const feed = [{ id: 9, date: '2026-07-14', type: 'VirtualRun', movingTimeSec: 42 * 60 }];
    const out = mergeActivities(feed, [entry()]);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe(9);
  });

  it('a clearly different session on the same day survives the merge', () => {
    // 90 min recorded vs 40 logged: outside the window — two real sessions
    const feed = [{ id: 9, date: '2026-07-14', type: 'Run', movingTimeSec: 90 * 60 }];
    const out = mergeActivities(feed, [entry()]);
    expect(out.length).toBe(2);
    // and a different sport never shadows
    const ride = [{ id: 8, date: '2026-07-14', type: 'Ride', movingTimeSec: 45 * 60 }];
    expect(mergeActivities(ride, [entry()]).length).toBe(2);
  });

  it('shadowing hides, never deletes: the entry returns when the feed row goes', () => {
    const feed = [{ id: 9, date: '2026-07-14', type: 'Run', movingTimeSec: 45 * 60 }];
    const entries = [entry()];
    expect(mergeActivities(feed, entries).length).toBe(1);
    expect(mergeActivities([], entries).length).toBe(1);
    expect(mergeActivities([], entries)[0].manual).toBe(true);
  });
});
