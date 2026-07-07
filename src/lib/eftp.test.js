import { describe, it, expect } from 'vitest';
import { eftpProposal, EFTP_RULES } from './eftp.js';

const TODAY = '2026-07-07';
const plan = { profile: { ftp: 250 } };
const act = (date, eftp, type = 'Ride') => ({ id: 'a' + date, date, type, eftp });

describe('eftpProposal (eFTP watcher)', () => {
  it('proposes a retarget when the estimate has moved up', () => {
    const p = eftpProposal({ activities: [act('2026-07-05', 265)], plan, todayISO: TODAY });
    expect(p.up).toBe(true);
    expect(p.eftp).toBe(265);
    expect(p.why).toContain('265 W');
    expect(p.why).toContain('250 W');
  });

  it('flags targets set too high when the estimate has dropped', () => {
    const p = eftpProposal({ activities: [act('2026-07-05', 230)], plan, todayISO: TODAY });
    expect(p.up).toBe(false);
    expect(p.eftp).toBe(230);
  });

  it('stays quiet inside the drift threshold', () => {
    expect(eftpProposal({ activities: [act('2026-07-05', 255)], plan, todayISO: TODAY })).toBe(null); // +2%
  });

  it('uses the latest fresh estimate and ignores stale ones', () => {
    const p = eftpProposal({ activities: [act('2026-07-01', 300), act('2026-07-06', 262)], plan, todayISO: TODAY });
    expect(p.eftp).toBe(262); // newest wins
    expect(eftpProposal({ activities: [act('2026-06-20', 300)], plan, todayISO: TODAY })).toBe(null); // > freshDays old
  });

  it('ignores non-ride estimates: running power FTP must never reach the bike watcher', () => {
    // the real bug: a run's rolling estimate (359 W running power) vs a 222 W bike FTP
    expect(eftpProposal({ activities: [act('2026-07-06', 359, 'Run')], plan: { profile: { ftp: 222 } }, todayISO: TODAY })).toBe(null);
    const p = eftpProposal({ activities: [act('2026-07-06', 359, 'Run'), act('2026-07-04', 214, 'VirtualRide')], plan: { profile: { ftp: 222 } }, todayISO: TODAY });
    expect(p.eftp).toBe(214); // the ride's estimate, not the newer run's
  });

  it('is quiet without a plan FTP, activities, or estimates', () => {
    expect(eftpProposal({ activities: [act('2026-07-05', 265)], plan: { profile: {} }, todayISO: TODAY })).toBe(null);
    expect(eftpProposal({ activities: null, plan, todayISO: TODAY })).toBe(null);
    expect(eftpProposal({ activities: [{ id: 'x', date: '2026-07-05', type: 'Ride' }], plan, todayISO: TODAY })).toBe(null);
  });

  it('rules are sane', () => {
    expect(EFTP_RULES.minDriftPct).toBeGreaterThan(0);
    expect(EFTP_RULES.freshDays).toBeGreaterThan(0);
  });
});

describe('fitness watcher v2 (run and swim thresholds)', () => {
  // intermediate estimates: 5k 1620 → threshold 336 s/km; CSS 120 s/100m
  const p2 = { profile: {}, paces: { run: { threshold: 336 }, swim: { css: 120 } } };

  it('proposes a run retarget from the configured threshold pace', () => {
    const r = eftpProposal({ thresholds: { runThresholdPace: 1000 / 310 }, plan: p2, todayISO: TODAY });
    expect(r.sport).toBe('run');
    expect(r.up).toBe(true); // 310 s/km is faster than the plan's 336
    expect(r.retarget).toEqual({ fivekSec: Math.round((310 - 12) * 5) });
    expect(r.why).toContain('/km');
  });

  it('proposes a swim retarget from the configured CSS', () => {
    const r = eftpProposal({ thresholds: { swimThresholdPace: 100 / 113 }, plan: p2, todayISO: TODAY });
    expect(r.sport).toBe('swim');
    expect(r.retarget.css100Sec).toBe(113);
  });

  it('the biggest drift wins the single banner', () => {
    const r = eftpProposal({
      activities: [act('2026-07-06', 214)],
      thresholds: { runThresholdPace: 1000 / 300 }, // ~11% run drift vs ~14% bike? bike: |214-250|/250 = 14.4%
      plan: { profile: { ftp: 250 }, paces: { run: { threshold: 336 }, swim: { css: 120 } } },
      todayISO: TODAY,
    });
    expect(r.sport).toBe('bike');
  });

  it('ignores implausible paces and tiny drifts', () => {
    expect(eftpProposal({ thresholds: { runThresholdPace: 25 }, plan: p2, todayISO: TODAY })).toBe(null); // 40 s/km nonsense
    expect(eftpProposal({ thresholds: { swimThresholdPace: 100 / 121 }, plan: p2, todayISO: TODAY })).toBe(null); // <1% drift
  });

  it('bike-only callers keep working without thresholds', () => {
    const r = eftpProposal({ activities: [act('2026-07-05', 265)], plan: { profile: { ftp: 250 } }, todayISO: TODAY });
    expect(r.sport).toBe('bike');
    expect(r.retarget).toEqual({ ftp: 265 });
  });
});
