import { describe, it, expect } from 'vitest';
import { swimKit } from './swim-kit.js';
import { SWIM_DRILLS, FOCUS_DRILLS, SWIM_EQUIPMENT } from './swim-drills.js';
import { generatePlan } from './plan.js';

/* The kit line's whole safety case is the label-suffix contract with
   drillSegs: these tests turn it from a hope into a pin. */

const equipmentIds = new Set(SWIM_EQUIPMENT.map(e => e.id));

describe('the label-suffix coupling contract', () => {
  it('every catalogue drill resolves from a drillSegs-shaped label to exactly its needs', () => {
    for (const d of SWIM_DRILLS.concat(FOCUS_DRILLS)) {
      const w = { discipline: 'swim', segments: [{ label: '2 × 50 m ' + d.name }] };
      const kit = swimKit(w);
      const expected = (d.needs || []).slice();
      if (!expected.length) {
        expect(kit, d.name).toBe(null);
      } else {
        const labels = SWIM_EQUIPMENT.filter(e => expected.includes(e.id)).map(e => e.label);
        expect(kit.items, d.name).toEqual(labels);
      }
    }
  });

  it('no drill name is a suffix of another: the match is unambiguous', () => {
    const names = SWIM_DRILLS.concat(FOCUS_DRILLS).map(d => d.name);
    for (const a of names) for (const b of names) {
      if (a !== b) expect(a.endsWith(' ' + b), a + ' vs ' + b).toBe(false);
    }
  });

  it('every needs id in both catalogues exists in SWIM_EQUIPMENT', () => {
    for (const d of SWIM_DRILLS.concat(FOCUS_DRILLS)) {
      for (const n of d.needs || []) expect(equipmentIds.has(n), d.name + ' needs ' + n).toBe(true);
    }
  });
});

describe('sessions', () => {
  it('a generated Technique swim with a gear drill yields its kit, in catalogue order', () => {
    const plan = generatePlan({
      name: 'P', raceType: 'olympic', fitness: 'intermediate',
      fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
      trainingDays: [0, 1, 3, 5, 6], longDay: 5, daysPerWeek: 5,
      startDate: '2026-06-01', raceDate: '2026-09-27',
    });
    const swims = plan.weeks.flatMap(w => w.workouts)
      .filter(w => w.discipline === 'swim' && Array.isArray(w.segments));
    const withKit = swims.map(w => swimKit(w)).filter(Boolean);
    expect(withKit.length, 'no generated swim carries gear drills').toBeGreaterThan(0);
    for (const kit of withKit) {
      // items are real labels in catalogue order
      const order = kit.items.map(i => SWIM_EQUIPMENT.findIndex(e => e.label === i));
      expect(order.every(i => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  it('an open-water wetsuit rehearsal brings the wetsuit', () => {
    const w = { discipline: 'swim', segments: [{ label: 'Open water block', ow: { skills: ['wetsuit'] } }] };
    expect(swimKit(w).items).toEqual(['Wetsuit']);
  });

  it('gearless, segment-less, adhoc and non-swim sessions yield null, never an empty Bring', () => {
    expect(swimKit({ discipline: 'swim', segments: [{ label: '4 × 100 m steady' }] })).toBe(null);
    expect(swimKit({ discipline: 'swim' })).toBe(null);
    expect(swimKit({ id: 'adhoc-1', adhoc: true, discipline: 'run', durationMin: 40 })).toBe(null);
    expect(swimKit({ discipline: 'bike', segments: [{ label: 'x' }] })).toBe(null);
    expect(swimKit(null)).toBe(null);
  });
});
