import { describe, it, expect } from 'vitest';
import { eftpProposal, EFTP_RULES } from './eftp.js';

const TODAY = '2026-07-07';
const plan = { profile: { ftp: 250 } };
const act = (date, eftp) => ({ id: 'a' + date, date, type: 'Ride', eftp });

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
