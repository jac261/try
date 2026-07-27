import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import {
  SWIM_DRILLS, FOCUS_DRILLS, TECHNIQUE_FOCUS, SWIM_EQUIPMENT,
  saneTechnique, drillPool, focusOrder, cueFocusBias,
} from './swim-drills.js';

/* Phase 5. The load-bearing property is the same one every swim phase has
   held: an athlete who has declared nothing gets byte-identical sessions.
   Everything else is what happens once they do declare something. */

const base = {
  name: 'D', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 320, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
};
const techSwims = p => p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'swim' && x.type === 'Technique');
// a drill segment is "2 × <50 m> <drill name>"; the main set also uses
// "n × <dist> steady", so the steady blocks are excluded by name
const drillLabels = w => w.segments.map(s => s.label)
  .filter(l => /^2 × \d+ (?:m|yd) /.test(l) && !/ steady$/.test(l));
const named = (w, name) => drillLabels(w).some(l => l.endsWith(' ' + name));

describe('the catalogue is metadata over an untouched list', () => {
  it('every drill carries structured focus metadata (§1, §8)', () => {
    const ids = TECHNIQUE_FOCUS.map(f => f.id);
    const kit = SWIM_EQUIPMENT.map(e => e.id);
    SWIM_DRILLS.concat(FOCUS_DRILLS).forEach(d => {
      expect(d.focus.length).toBeGreaterThan(0);
      d.focus.forEach(f => expect(ids).toContain(f));
      (d.needs || []).forEach(n => expect(kit).toContain(n));
      expect(typeof d.purpose).toBe('string');
      expect(d.difficulty).toBeGreaterThan(0);
      // gear and needs must agree: a drill that names kit must require it
      if (d.gear) expect((d.needs || []).length).toBeGreaterThan(0);
    });
  });
  it('the twelve original drills keep their order, cues and level gates', () => {
    expect(SWIM_DRILLS.map(d => d.name)).toEqual([
      'Catch-up', 'Single-arm', 'Scull', 'Fingertip drag', 'Kick on side', 'Backstroke lengths',
      'Fist', '6-1-6', 'Doggy paddle', 'Pull buoy swim', 'Paddle pull', 'Snorkel swim']);
    expect(SWIM_DRILLS.filter(d => d.level === -1).length).toBe(6);
  });
});

describe('saneTechnique: garbage never becomes a setting', () => {
  it('reads nothing declared as null, and keeps a declared empty kit', () => {
    [null, undefined, {}, 'x', { focus: [] }, { focus: 'catch' }].forEach(t => expect(saneTechnique(t)).toBe(null));
    expect(saneTechnique({ kit: [] })).toEqual({ focus: [], kit: [], updatedAt: null });
    expect(saneTechnique({ focus: ['catch', 'nonsense'] }).focus).toEqual(['catch']);
    expect(saneTechnique({ focus: ['catch', 'kick', 'breathing'] }).focus.length).toBe(2);
    expect(saneTechnique({ kit: ['pull-buoy', 'jetpack'] }).kit).toEqual(['pull-buoy']);
  });
});

describe('drill selection responds to the athlete (§3, §8)', () => {
  const swimsWith = technique => techSwims(generatePlan({ ...base, technique }));

  it('nothing declared: selection is exactly the level-gated catalogue', () => {
    expect(drillPool(0, null).map(d => d.name)).toEqual(SWIM_DRILLS.filter(d => d.level <= 0).map(d => d.name));
    expect(focusOrder(drillPool(0, null), null).matching).toBe(0);
  });

  it('a declared focus actually changes what is prescribed, and is not vacuous', () => {
    const plain = swimsWith(undefined).map(drillLabels).join('|');
    const catchy = swimsWith({ focus: ['catch'] }).map(drillLabels).join('|');
    expect(catchy).not.toBe(plain);
    // and the focus drills dominate: every session leads with catch work
    swimsWith({ focus: ['catch'] }).forEach(w => {
      const first = drillLabels(w)[0].replace(/^2 × \S+ \S+ /, '');
      const all = SWIM_DRILLS.concat(FOCUS_DRILLS);
      const d = all.find(x => drillLabels(w)[0].endsWith(' ' + x.name));
      expect(d && d.focus).toContain('catch');
    });
  });

  it('sighting work only exists for an athlete who asked for it', () => {
    expect(swimsWith(undefined).some(w => named(w, 'Sighting freestyle'))).toBe(false);
    expect(swimsWith({ focus: ['sighting'] }).some(w => named(w, 'Sighting freestyle') || named(w, 'Sight and turn'))).toBe(true);
  });

  it('level gates still hold: a beginner is never given an advanced drill', () => {
    const all = SWIM_DRILLS.concat(FOCUS_DRILLS);
    TECHNIQUE_FOCUS.forEach(f => {
      techSwims(generatePlan({ ...base, fitness: 'beginner', technique: { focus: [f.id] } })).forEach(w => {
        drillLabels(w).forEach(l => {
          const d = all.find(x => l.endsWith(' ' + x.name));
          expect(d).toBeTruthy();
          expect(d.level).toBeLessThanOrEqual(0);
        });
      });
    });
  });

  it('kit the athlete does not own is never prescribed, and an empty kit still fills a session', () => {
    const none = swimsWith({ kit: [] });
    expect(none.length).toBeGreaterThan(0);
    none.forEach(w => {
      expect(drillLabels(w).length).toBeGreaterThanOrEqual(2);
      w.segments.forEach(s => expect(s.detail || '').not.toMatch(/pull buoy|paddles|snorkel|kickboard|ankles banded/));
    });
    // declaring the buoy brings its drill back into reach
    expect(swimsWith({ kit: ['pull-buoy'] }).some(w => named(w, 'Pull buoy swim'))).toBe(true);
  });

  it('a focused session explains why each drill is there; an undeclared one is untouched (§7)', () => {
    swimsWith({ focus: ['body-position'] }).forEach(w => {
      const seg = w.segments.find(s => /^2 × /.test(s.label));
      expect(seg.detail.split(' · ').length).toBeGreaterThanOrEqual(2);
    });
    swimsWith(undefined).forEach(w => {
      const seg = w.segments.find(s => /^2 × /.test(s.label));
      const all = SWIM_DRILLS.find(x => seg.label.endsWith(' ' + x.name));
      expect(seg.detail).toBe(all.cue + (all.gear ? ' · ' + all.gear : ''));
    });
  });
});

describe('cueFocusBias: the athlete own-word signal, treated as weak evidence', () => {
  it('orders by how often a cue helped, deterministically, ignoring noise', () => {
    expect(cueFocusBias(['catch', 'catch', 'breathing'])).toEqual(['catch', 'breathing']);
    expect(cueFocusBias(['none', 'none'])).toEqual([]);
    expect(cueFocusBias([])).toEqual([]);
    expect(cueFocusBias(null)).toEqual([]);
    expect(cueFocusBias(['nonsense', 'kick'])).toEqual(['kick']);
    // a tie always resolves the same way: no coin-flip coaching
    expect(cueFocusBias(['kick', 'catch'])).toEqual(cueFocusBias(['catch', 'kick']));
  });
});

describe('the invariants that survive every declared setting', () => {
  // the same-week discriminator (a week's two Technique swims must never be
  // byte-identical) was won twice before; a focus block must not undo it
  it('sweeps levels, race types, focus and kit: no duplicate pair, no repeated drill, no missing kit', () => {
    const focusIds = TECHNIQUE_FOCUS.map(f => f.id);
    const combos = focusIds.map(f => [f]).concat([[], ['catch', 'breathing'], ['sighting', 'kick']]);
    const kits = [undefined, [], ['pull-buoy'], ['pull-buoy', 'paddles', 'snorkel', 'kickboard', 'band'], SWIM_EQUIPMENT.map(e => e.id)];
    let cases = 0, dup = 0, repeat = 0, badKit = 0;
    ['beginner', 'intermediate', 'advanced', 'elite'].forEach(fitness => {
      ['olympic', 'sprint', 'maintenance', 'half'].forEach(raceType => {
        combos.forEach(focus => kits.forEach(kit => {
          cases++;
          const p = generatePlan({ ...base, fitness, raceType, technique: { focus, kit } });
          p.weeks.forEach(wk => {
            const t = wk.workouts.filter(x => x.discipline === 'swim' && x.type === 'Technique');
            for (let i = 0; i < t.length; i++) {
              for (let j = i + 1; j < t.length; j++) {
                if (JSON.stringify(t[i].segments) === JSON.stringify(t[j].segments)) dup++;
              }
            }
          });
          techSwims(p).forEach(w => {
            const names = drillLabels(w);
            if (new Set(names).size !== names.length) repeat++;
            if (kit) w.segments.forEach(s => {
              const need = [['pull buoy', 'pull-buoy'], ['paddles', 'paddles'], ['snorkel', 'snorkel'], ['kickboard', 'kickboard'], ['ankles banded', 'band']];
              need.forEach(([text, id]) => { if ((s.detail || '').includes(text) && !kit.includes(id)) badKit++; });
            });
          });
        }));
      });
    });
    expect(cases).toBe(800);
    expect(dup).toBe(0);
    expect(repeat).toBe(0);
    expect(badKit).toBe(0);
  });
});
