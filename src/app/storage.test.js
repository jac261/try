// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { storageForUser } from './storage.js';

/* The bike lap cache: the client-side answer to what was briefly a backend
   ask for a `bikeReview` column. Storing the review was the wrong shape —
   it is derived, and a stored derivation goes stale the moment the engine's
   definitions move. Storing the LAPS cannot: they are a fact about a
   finished ride. These fixtures pin the three things that go wrong if the
   trim, the empty case or the eviction is written carelessly. */
describe('the bike lap cache', () => {
  const lap = (over = {}) => ({
    type: 'WORK', startTimeSec: 900, movingTimeSec: 300, averageWatts: 250,
    // fields the review never reads, and which must not be stored 25 times
    // per ride: a full window has to stay tens of KB, not hundreds
    label: 'Interval 1', distance: 8000, averageHeartrate: 160, zone: 'Z4', groupId: 'g1',
    ...over,
  });

  it('round-trips the four fields the review engine actually reads', () => {
    localStorage.clear();
    const st = storageForUser('laps-test');
    st.saveBikeLaps('a1', '2026-06-10', [lap()]);
    expect(st.loadBikeLaps().a1).toEqual([
      { type: 'WORK', startTimeSec: 900, movingTimeSec: 300, averageWatts: 250 },
    ]);
    // and nothing else rode along
    const raw = localStorage.getItem('try.user.laps-test.bikeLaps');
    expect(raw).not.toMatch(/averageHeartrate|Interval 1|groupId/);
  });

  it('drops non-WORK laps, which the matcher discards anyway', () => {
    localStorage.clear();
    const st = storageForUser('laps-test');
    st.saveBikeLaps('a1', '2026-06-10', [lap(), lap({ type: 'RECOVERY' }), lap({ type: 'WARMUP' })]);
    expect(st.loadBikeLaps().a1.length).toBe(1);
  });

  it('stores an empty result as a real answer, not as a miss', () => {
    /* A ride recorded with no structured laps is an ANSWER. Treated as a
       miss it would be refetched on every load forever, and the review would
       never settle on the read it can honestly make from a steady ride. */
    localStorage.clear();
    const st = storageForUser('laps-test');
    st.saveBikeLaps('a1', '2026-06-10', []);
    expect(st.loadBikeLaps().a1).toEqual([]);
    // truthy under the backfill's `!have[id]` cache check, which is the point
    expect(!st.loadBikeLaps().a1).toBe(false);
  });

  it('a missing averageWatts or startTimeSec survives as null, not as absent', () => {
    // an outdoor lap can carry neither; the engine null-checks both and must
    // see the same thing after a reload as it saw before one
    localStorage.clear();
    const st = storageForUser('laps-test');
    st.saveBikeLaps('a1', '2026-06-10', [{ type: 'WORK', movingTimeSec: 300 }]);
    expect(st.loadBikeLaps().a1[0]).toEqual({
      type: 'WORK', startTimeSec: null, movingTimeSec: 300, averageWatts: null,
    });
  });

  it('caps at 60 recordings, evicting the oldest ride first', () => {
    localStorage.clear();
    const st = storageForUser('laps-test');
    for (let i = 0; i < 65; i++) {
      st.saveBikeLaps('a' + i, '2026-' + String((i % 12) + 1).padStart(2, '0') + '-01', [lap()]);
    }
    const all = st.loadBikeLaps();
    expect(Object.keys(all).length).toBe(60);
  });

  it('survives clear(), because a past ride is not current-plan state', () => {
    localStorage.clear();
    const st = storageForUser('laps-test');
    st.saveBikeLaps('a1', '2026-06-10', [lap()]);
    st.clear();
    expect(st.loadBikeLaps().a1.length).toBe(1);
  });

  it('returns an empty map rather than throwing on corrupt storage', () => {
    localStorage.clear();
    const st = storageForUser('laps-test');
    localStorage.setItem('try.user.laps-test.bikeLaps', '{not json');
    expect(st.loadBikeLaps()).toEqual({});
    // and a save over the corruption recovers rather than propagating it
    st.saveBikeLaps('a1', '2026-06-10', [lap()]);
    expect(st.loadBikeLaps().a1.length).toBe(1);
  });
});
