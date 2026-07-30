import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { arbitrateLimiters, limiterCandidates, LIMITER_TABLE } from './limiter-arbitration.js';
import { generatePlan } from '../plan.js';

/* Phase 2 §8, shadow mode: one priority across the disciplines, by ordered
 * rules — never a score, never an average — with a stated reason, and every
 * suppressed candidate reasoned rather than silently discarded. */

const cand = (discipline, id, label) => ({ discipline, id, label, evidence: [] });

describe('arbitrateLimiters (ordered rules)', () => {
  it('measured beats missing: a recorded swim fade outranks an unmeasured bike threshold', () => {
    const arb = arbitrateLimiters([
      cand('bike', 'bike:data-confidence', 'Bike targets are estimates until an FTP exists'),
      cand('swim', 'swim:endurance', 'Your swims fade late'),
    ]);
    expect(arb.winner.id).toBe('swim:endurance');
    expect(arb.reason).toContain('actually measured');
    expect(arb.suppressed).toHaveLength(1);
    expect(arb.suppressed[0].reason).toBe('a measured problem outranks it');
  });

  it('within tier 1, higher consequence first; at a tie the run comes first', () => {
    const arb = arbitrateLimiters([
      cand('swim', 'swim:threshold', 'Swim threshold drifting'),   // medium consequence
      cand('bike', 'bike:durability', 'Late-ride fade'),           // high consequence
    ]);
    expect(arb.winner.id).toBe('bike:durability');
    const tie = arbitrateLimiters([
      cand('swim', 'swim:consistency', 'Swim sessions missed'),    // high
      cand('run', 'run:at-risk', 'Long-run durability at risk'),   // high
    ]);
    expect(tie.winner.discipline).toBe('run');
    expect(tie.suppressed[0].reason).toContain('cost lands latest in the race');
  });

  it('deterministic and order-independent of the argument order', () => {
    const a = [cand('bike', 'bike:fuelling', 'x'), cand('run', 'run:building', 'y'), cand('swim', 'swim:none', 'z')];
    const fwd = arbitrateLimiters(a);
    const rev = arbitrateLimiters([...a].reverse());
    expect(fwd.winner).toEqual(rev.winner);
    expect(fwd.suppressed.map(s => s.id)).toEqual(rev.suppressed.map(s => s.id));
  });

  it('all-clear yields the tier-3 sentence and no suppression noise', () => {
    const arb = arbitrateLimiters([
      cand('swim', 'swim:none', 'All clear'),
      cand('bike', 'bike:none', 'All clear'),
    ]);
    expect(arb.allClear).toBe(true);
    expect(arb.reason).toContain('keep training the plan as written');
  });

  it('every suppressed candidate carries a reason; nothing is silently discarded', () => {
    const arb = arbitrateLimiters([
      cand('run', 'run:at-risk', 'a'), cand('bike', 'bike:threshold', 'b'), cand('swim', 'swim:too-early', 'c'),
    ]);
    expect(arb.suppressed).toHaveLength(2);
    arb.suppressed.forEach(sup => expect(sup.reason.length).toBeGreaterThan(10));
  });

  it('the copy carries no engine tokens', () => {
    const all = [
      arbitrateLimiters([cand('swim', 'swim:endurance', 'x'), cand('bike', 'bike:none', 'y')]),
      arbitrateLimiters([cand('bike', 'bike:data-confidence', 'x'), cand('swim', 'swim:too-early', 'y')]),
      arbitrateLimiters([cand('swim', 'swim:none', 'x'), cand('bike', 'bike:none', 'y')]),
    ];
    all.forEach(arb => {
      [arb.reason, ...arb.suppressed.map(s => s.reason)].forEach(t => {
        expect(t).not.toMatch(/TSB|CTL|eFTP|factor|tier|consequence rank|score/i);
        expect(t).not.toMatch(/—/);
      });
    });
  });

  it('the table is declared, complete for every dashboard rule id, and score-free', () => {
    Object.values(LIMITER_TABLE).forEach(e => {
      expect([1, 2, 3]).toContain(e.tier);
      expect(['low', 'medium', 'high']).toContain(e.consequence);
      expect(['low', 'medium', 'high']).toContain(e.actionability);
    });
    // no numeric weights anywhere: ordered decision rules only
    const src = readFileSync(new URL('./limiter-arbitration.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\* 0\.|weight|scorer?\b/i);
  });
});

describe('candidates come from the real dashboards, gated like the real cards', () => {
  const profile = {
    name: 'T', raceType: 'olympic', fitness: 'intermediate',
    fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
    trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
    startDate: '2026-06-01', raceDate: '2026-10-03',
  };
  const args = plan => ({
    plan, log: {}, moves: {}, activities: [], todayISO: '2026-06-10',
    retest: null, ftpRetest: null, durabilityReads: null, fuelLog: {}, positionLog: {},
  });

  it('a triathlon plan yields candidates; labels pass through verbatim', () => {
    const c = limiterCandidates(args(generatePlan(profile)));
    expect(c.length).toBeGreaterThanOrEqual(2);
    c.forEach(x => {
      expect(['swim', 'bike', 'run']).toContain(x.discipline);
      expect(typeof x.label).toBe('string');
      expect(LIMITER_TABLE[x.id], x.id).toBeTruthy();   // every produced id is declared
    });
  });

  it('a solo run plan yields no swim or bike candidates: the gates match the cards', () => {
    const solo = generatePlan({ ...profile, raceType: 'runhalf' });
    const c = limiterCandidates(args(solo));
    expect(c.every(x => x.discipline === 'run')).toBe(true);
  });

  it('shadow mode: the module writes nothing and imports no actuator', () => {
    // comments stripped: the header NAMES the actuators it leaves alone,
    // and naming them is documentation, not reaching for them
    const src = readFileSync(new URL('./limiter-arbitration.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    ['localStorage', 'storage.', 'sync.', 'setPlan', 'generatePlan', 'weakestLink', 'weakBias'].forEach(m =>
      expect(src, m).not.toContain(m));
  });
});
