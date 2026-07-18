import { describe, it, expect } from 'vitest';
import { weakestLink, weakBias, WEAK_BIAS, WEAK_BIAS_BIG } from './weakest.js';
import { generatePlan, swapForLimiter, detectLimiterSwap, upgradePlanSegments } from './plan.js';

describe('weakestLink (which sport is limiting)', () => {
  it('a strong runner and rider with an intermediate swim gets the swim named, with its race share', () => {
    // Jon-shaped: 20:18 5k (~2.5 on the ladder), 222 W at 64.3 kg (~2.3), CSS 2:00 (1.0)
    const wl = weakestLink({ profile: { raceType: 'olympic', fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 } });
    expect(wl.weakest).toBe('swim');
    expect(wl.gap).toBeGreaterThanOrEqual(1);
    expect(wl.share).toBeGreaterThan(10); // swim ≈ 20% of an olympic
    expect(wl.share).toBeLessThan(30);
  });

  it('a maintenance block has no race, so the limiter carries no race share', () => {
    const wl = weakestLink({ profile: { raceType: 'maintenance', fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 } });
    expect(wl.weakest).toBe('swim');
    expect(wl.share).toBe(null); // never "33% of your race" when there is no race
  });

  it('balanced athletes get no limiter — near-ties never name a weakest link', () => {
    const wl = weakestLink({ profile: { raceType: 'olympic', fivekSec: 1620, css100Sec: 120, ftp: 167, weightKg: 64.2 } });
    expect(wl.weakest).toBe(null); // all ≈ intermediate
  });

  it('missing data removes a sport honestly instead of guessing', () => {
    const wl = weakestLink({ profile: { raceType: 'olympic', fivekSec: 1218, css100Sec: 120 } }); // no ftp/weight
    expect(wl.missing).toContain('bike');
    expect(wl.weakest).toBe('swim'); // judged between the two known sports
    expect(weakestLink({ profile: { fivekSec: 1218 } })).toBe(null); // one sport is no comparison
    expect(weakestLink({ profile: null })).toBe(null);
  });

  it('weakBias graduates by gap: a modest gap nudges, over a full level shoves', () => {
    // Jon-shaped: swim sits ~1.5 levels behind the run — the big multiplier
    expect(weakBias({ fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 })).toEqual({ swim: WEAK_BIAS_BIG });
    // intermediate run (1.0) vs advanced swim (2.0): gap exactly 1.0 stays modest
    expect(weakBias({ fivekSec: 1620, css100Sec: 105 })).toEqual({ run: WEAK_BIAS });
    expect(weakBias({ fivekSec: 1620, css100Sec: 120 })).toEqual({});
  });

  it('the tier thresholds the RAW gap, not the display-rounded one', () => {
    // raw gap 1.0125 displays as 1.0; the tier must still read it as > 1
    const wl = weakestLink({ profile: { fivekSec: 1620, css100Sec: 140.25 } });
    expect(wl.gap).toBe(1);
    expect(wl.gapRaw).toBeGreaterThan(1);
    expect(weakBias({ fivekSec: 1620, css100Sec: 140.25 })).toEqual({ swim: WEAK_BIAS_BIG });
  });

  it('names the strongest sport only alongside a declared limiter (it is the swap donor)', () => {
    const wl = weakestLink({ profile: { raceType: 'olympic', fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 } });
    expect(wl.weakest).toBe('swim');
    expect(wl.strongest).toBe('run'); // 20:18 5k outranks 3.45 W/kg on the ladder
    const balanced = weakestLink({ profile: { raceType: 'olympic', fivekSec: 1620, css100Sec: 120, ftp: 167, weightKg: 64.2 } });
    expect(balanced.strongest).toBe(null); // near-ties never name a donor either
  });
});

describe('swapForLimiter (the frequency swap)', () => {
  const T5 = ['swim:easy', 'run:quality', 'bike:quality', 'run:long', 'bike:long'];
  const wl = (weakest, strongest) => ({ weakest, strongest });

  it('the strongest sport donates its quality slot when it has no easy slot', () => {
    const out = swapForLimiter(T5, wl('swim', 'run'), 'Base');
    expect(out).toContain('swim:quality'); // incoming role dodges the existing swim:easy
    expect(out).not.toContain('run:quality');
    expect(out).toContain('run:long'); // the strongest keeps a session
    expect(out.length).toBe(T5.length);
    expect(T5).toContain('run:quality'); // pure: the input template is untouched
  });

  it('only building phases swap: Peak, Taper and Maintain keep the template', () => {
    ['Peak', 'Taper', 'Maintain'].forEach(ph =>
      expect(swapForLimiter(T5, wl('swim', 'run'), ph)).toBe(T5));
  });

  it('never donates a long or brick, so a 3-day week cannot swap', () => {
    const T3 = ['swim:quality', 'bike:long', 'run:long'];
    expect(swapForLimiter(T3, wl('swim', 'bike'), 'Build')).toBe(T3);
  });

  it('a brick counts as run/bike presence, so the 4-day week CAN swap', () => {
    const T4 = ['swim:easy', 'bike:quality', 'run:quality', 'brick:long'];
    const out = swapForLimiter(T4, wl('swim', 'run'), 'Base');
    expect(out).toContain('swim:quality'); // the run still trains via the brick's run leg
    expect(out).not.toContain('run:quality');
    expect(out).toContain('brick:long');
  });

  it('never donates the strongest sport\'s only session', () => {
    // swim's single easy slot is the only swim of the 5-day week
    expect(swapForLimiter(T5, wl('run', 'swim'), 'Base')).toBe(T5);
  });

  it('a swim holding both roles now earns a LONG instead of skipping (swim pass 2026-07-18)', () => {
    // The caller still never swaps injured-state templates; this documents
    // the pure function's fallback: easy -> quality -> long, swim only.
    const NR4 = ['swim:easy', 'swim:quality', 'bike:quality', 'bike:long'];
    const out = swapForLimiter(NR4, wl('swim', 'bike'), 'Base');
    expect(out[out.length - 1]).toBe('swim:long'); // appended, so template longs keep their weekend slots
    expect(out).not.toContain('bike:quality');
    expect(out).toContain('bike:long');
  });

  it('skips only when swim holds easy, quality AND long', () => {
    const full = ['swim:easy', 'swim:quality', 'swim:long', 'bike:quality', 'bike:long'];
    expect(swapForLimiter(full, wl('swim', 'bike'), 'Base')).toBe(full);
  });

  it('no verdict, no swap', () => {
    expect(swapForLimiter(T5, null, 'Base')).toBe(T5);
    expect(swapForLimiter(T5, { weakest: null, strongest: null }, 'Base')).toBe(T5);
  });
});

describe('generatePlan weakest-link bias', () => {
  const base = { name: 'J', raceType: 'olympic', fitness: 'intermediate',
    trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
    startDate: '2026-07-06', raceDate: '2026-09-21' };
  // Sum across the building weeks: round5 can absorb 10% on one short session,
  // never across a month of them.
  const mins = (p, disc) => p.weeks.slice(0, 4).flatMap(w => w.workouts)
    .filter(w => w.discipline === disc && !w.test && !w.race).reduce((a, w) => a + w.durationMin, 0);

  it('the limiter earns extra time AND an extra weekly session; the strongest sport donates', () => {
    const plain = generatePlan(base);
    const biased = generatePlan({ ...base, fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 });
    expect(mins(biased, 'swim')).toBeGreaterThan(mins(plain, 'swim'));
    // the frequency swap: the strongest sport (run) hands a session to the swim
    expect(mins(biased, 'run')).toBeLessThan(mins(plain, 'run'));
    const count = (p, w, disc) => p.weeks[w].workouts.filter(x => x.discipline === disc).length;
    expect(count(biased, 0, 'swim')).toBe(count(plain, 0, 'swim') + 1); // Base week: extra swim
    expect(count(biased, 0, 'run')).toBe(count(plain, 0, 'run') - 1);   // donated by the run
    // recovery week (intermediate: every 4th) keeps the even template
    expect(count(biased, 3, 'swim')).toBe(count(plain, 3, 'swim'));
  });

  it('balanced profiles generate byte-identical plans: no bias, no swap', () => {
    const plain = generatePlan(base);
    const balanced = generatePlan({ ...base, fivekSec: 1620, css100Sec: 120, ftp: 167, weightKg: 64.2 });
    expect(balanced.weeks.map(w => w.workouts.map(x => x.discipline + ':' + x.durationMin)))
      .toEqual(plain.weeks.map(w => w.workouts.map(x => x.discipline + ':' + x.durationMin)));
  });

  it('a week hosting the strongest sport\'s benchmark test keeps its quality slot for the test', () => {
    const biased = generatePlan({ ...base, fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 });
    const testWeek = biased.weeks.find(wk => wk.workouts.some(x => x.test && x.testKind === 'run5k'));
    expect(testWeek).toBeTruthy();
    const test = testWeek.workouts.find(x => x.test && x.testKind === 'run5k');
    expect(test.role).toBe('quality');          // the test replaced the quality slot, as designed
    expect(testWeek.workouts.some(x => x.discipline === 'run' && x.role === 'long' && !x.test)).toBe(true); // the long run survives
  });

  it('injured-state plans never swap: the remaining sports keep their template, as onboarding promises', () => {
    // strong cyclist, weak runner, swim excluded: without the guard the bike
    // would donate its quality slot every building week
    const p = generatePlan({ ...base, excludedDiscipline: 'swim', fivekSec: 2400, ftp: 260, weightKg: 65 });
    expect(p.limiterSwap).toBe(null);
    const bikes = p.weeks[0].workouts.filter(x => x.discipline === 'bike').length;
    const plain = generatePlan({ ...base, excludedDiscipline: 'swim' });
    expect(bikes).toBe(plain.weeks[0].workouts.filter(x => x.discipline === 'bike').length);
  });

  it('the swap verdict is stamped on the plan and a locked retarget cannot flip disciplines at ids', () => {
    const first = generatePlan({ ...base, fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 });
    expect(first.limiterSwap).toEqual({ weakest: 'swim', strongest: 'run' });
    // the retarget flips the verdict (swim now strong, run now weak) but the
    // structure must not move: pass the stamped verdict, as App.retarget does
    const flipped = { ...base, fivekSec: 2400, css100Sec: 85, ftp: 222, weightKg: 64.3 };
    const held = generatePlan(flipped, { lockedSwap: first.limiterSwap });
    expect(held.limiterSwap).toEqual(first.limiterSwap);
    // strength doubles ride the hardest session, which retargeted durations
    // may legitimately move; the log-joining invariant is about the sessions
    const layout = p => p.weeks.map(w => w.workouts.filter(x => x.discipline !== 'strength')
      .map(x => x.id + ':' + x.discipline));
    expect(layout(held)).toEqual(layout(first));
    // a legacy plan locks to null: no swap appears mid-flight
    const legacy = generatePlan({ ...base, fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 }, { lockedSwap: null });
    expect(legacy.limiterSwap).toBe(null);
    expect(legacy.weeks[0].workouts.filter(x => x.discipline === 'swim').length)
      .toBe(generatePlan(base).weeks[0].workouts.filter(x => x.discipline === 'swim').length);
  });

  it('detectLimiterSwap recovers the verdict from structure alone, surviving the stamp-dropping hydrate', () => {
    const swapped = generatePlan({ ...base, fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 });
    // simulate the backend's typed DTO: the stamp is gone, the weeks remain
    const hydrated = { ...swapped, limiterSwap: undefined };
    expect(detectLimiterSwap(hydrated)).toEqual({ weakest: 'swim', strongest: 'run' });
    // unswapped, injured and tracker plans all detect to null
    expect(detectLimiterSwap(generatePlan(base))).toBe(null);
    expect(detectLimiterSwap(generatePlan({ ...base, excludedDiscipline: 'swim', fivekSec: 2400, ftp: 260, weightKg: 65 }))).toBe(null);
    expect(detectLimiterSwap({ race: 'tracker', weeks: [] })).toBe(null);
    expect(detectLimiterSwap(null)).toBe(null);
  });

  it('a stale locked verdict can never drag an excluded discipline back into an injured plan', () => {
    const p = generatePlan({ ...base, excludedDiscipline: 'run', fivekSec: 2400, ftp: 260, weightKg: 65 },
      { lockedSwap: { weakest: 'run', strongest: 'bike' } });
    expect(p.limiterSwap).toBe(null);
    expect(p.weeks.some(wk => wk.workouts.some(x => x.discipline === 'run'))).toBe(false);
  });

  it('taper and the post-race recovery week keep their shape: no bias applied', () => {
    const biased = generatePlan({ ...base, fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 });
    const plain = generatePlan(base);
    // last week = the post-race recovery week; the week before = race/taper week
    const swimAt = (p, fromEnd) => p.weeks[p.weeks.length - fromEnd].workouts.filter(w => w.discipline === 'swim' && !w.race);
    [1, 2].forEach(fromEnd =>
      expect(swimAt(biased, fromEnd).map(w => w.durationMin)).toEqual(swimAt(plain, fromEnd).map(w => w.durationMin)));
  });
});


describe('weakestLink with an excluded discipline', () => {
  it('never scores or names the excluded sport, even with a stale baseline on file', () => {
    const wl = weakestLink({ profile: { raceType: 'olympic', excludedDiscipline: 'swim', fivekSec: 1218, css100Sec: 120, ftp: 222, weightKg: 64.3 } });
    expect(wl.scores.swim).toBeUndefined();
    expect(wl.excludedSport).toBe('swim');
    expect(wl.weakest).not.toBe('swim');
    expect(wl.missing).not.toContain('swim'); // paused is not the same as missing data
  });
  it('fewer than two active sports still means no verdict', () => {
    expect(weakestLink({ profile: { excludedDiscipline: 'run', fivekSec: 1218, css100Sec: 120 } })).toBe(null);
  });
});

describe('sim catches 2026-07-17: structural stability and tune-up integrity', () => {
  const base = { name: 'J', raceType: 'olympic', fitness: 'beginner',
    trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
    startDate: '2026-01-05', raceDate: '2026-11-01', fivekSec: 1670, css100Sec: 110, ftp: 200, weightKg: 70 };

  it('a fitness-only retarget never moves the strength double\'s id', () => {
    const p1 = generatePlan(base);
    const p2 = generatePlan({ ...base, fivekSec: 1765 }, { lockedSwap: detectLimiterSwap(p1) });
    const ids = p => p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'strength').map(x => x.id);
    expect(ids(p2)).toEqual(ids(p1));
  });

  it('upgradePlanSegments never rewrites a tune-up race\'s instructions', () => {
    const p = generatePlan({ ...base, raceType: 'half', raceDate: '2026-09-06', fitness: 'intermediate',
      bRaces: [{ kind: 'run5k', date: '2026-03-02' }] });
    const before = p.weeks.flatMap(w => w.workouts).find(w => w.bRace);
    expect(before).toBeTruthy();
    const after = upgradePlanSegments(p).weeks.flatMap(w => w.workouts).find(w => w.bRace);
    expect(after.segments).toEqual(before.segments);
  });
});
