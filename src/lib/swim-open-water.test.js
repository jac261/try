import { describe, it, expect } from 'vitest';
import { generatePlan, segMinutes, addCustomWorkout, easeWorkout, trimWorkout, boostWorkout, upgradePlanSegments } from './plan.js';
import { buildICS } from './ics.js';
import {
  OW_SKILLS, OW_CATEGORIES, OW_SAFETY, OW_SKILL_CEILING,
  owCategory, poolFallback, openWaterExposure,
} from './swim-open-water.js';

/* Phase 6. The rules that existed before this phase are the ones most worth
   testing: Peak substitutes only the quality swim, the easy swim keeps its
   technique work, and a week's two swims are never the same session. */

const base = {
  name: 'O', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 320, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
};
const swims = p => p.weeks.flatMap(w => w.workouts).filter(x => x.discipline === 'swim' && !x.test && !x.race);
const ow = p => swims(p).filter(x => x.type === 'Open Water');

describe('the catalogue and its categories (§1, §2)', () => {
  it('every skill has a cue and a pool equivalent (§4)', () => {
    Object.values(OW_SKILLS).forEach(s => {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.cue.length).toBeGreaterThan(0);
      expect(s.pool.length).toBeGreaterThan(0);
    });
  });
  it('every category names real skills and its shares sum to one', () => {
    expect(OW_CATEGORIES.length).toBe(5);
    OW_CATEGORIES.forEach(c => {
      const sum = c.blocks.reduce((t, b) => t + b.share, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      c.blocks.forEach(b => {
        (b.skills || []).forEach(k => expect(OW_SKILLS[k]).toBeTruthy());
        if (b.skill) expect(OW_SKILLS[b.skill]).toBeTruthy();
      });
    });
  });
  it('category choice is deterministic, and the two roles can never collide', () => {
    expect(owCategory(3, 'quality').id).toBe(owCategory(3, 'quality').id);
    for (let seed = 0; seed < 24; seed++) {
      expect(owCategory(seed, 'easy').id).not.toBe(owCategory(seed, 'quality').id);
    }
  });

  it('the category does NOT move when a session is re-sized', () => {
    // trim, boost and the de-collision resize all re-length a session and
    // must hand back the same session, shorter (review catch 2026-07-27)
    for (let seed = 0; seed < 12; seed++) {
      const id = owCategory(seed, 'quality').id;
      [20, 35, 45, 60, 75, 90, 120].forEach(() => expect(owCategory(seed, 'quality').id).toBe(id));
    }
  });
});

describe('generated open-water sessions (§8)', () => {
  const plan = generatePlan(base);

  it('Peak substitutes the quality swim only; the easy swim keeps technique', () => {
    const peak = plan.weeks.filter(w => w.phase === 'Peak' && !w.isRecovery);
    expect(peak.length).toBeGreaterThan(0);
    peak.forEach(w => {
      w.workouts.filter(x => x.discipline === 'swim' && !x.test && !x.race).forEach(x => {
        if (x.role === 'easy') expect(x.type).toBe('Technique');
        else if (x.role !== 'long') expect(x.type).toBe('Open Water');
      });
    });
  });

  it('two swims in the same week are never the same session', () => {
    plan.weeks.forEach(w => {
      const s = w.workouts.filter(x => x.discipline === 'swim' && !x.test && !x.race);
      for (let i = 0; i < s.length; i++) {
        for (let j = i + 1; j < s.length; j++) {
          expect(JSON.stringify(s[i].segments)).not.toBe(JSON.stringify(s[j].segments));
        }
      }
    });
  });

  it('every open-water session carries the safety wording, and nothing else does', () => {
    expect(ow(plan).length).toBeGreaterThan(0);
    ow(plan).forEach(x => expect(x.safety).toBe(OW_SAFETY));
    swims(plan).filter(x => x.type !== 'Open Water').forEach(x => expect(x.safety).toBeFalsy());
  });

  it('the card sums to the session and skills never become filler', () => {
    ow(plan).forEach(x => {
      const total = x.segments.reduce((a, s) => a + segMinutes(s), 0);
      expect(total / x.durationMin).toBeGreaterThan(0.85);
      expect(total / x.durationMin).toBeLessThan(1.15);
      const skill = x.segments.filter(s => s.ow && s.ow.timed).reduce((a, s) => a + segMinutes(s), 0);
      expect(skill / total).toBeLessThanOrEqual(OW_SKILL_CEILING + 0.05);
    });
  });

  it('sessions carry race-specific content, not one repeated template (§8)', () => {
    const titles = new Set(ow(plan).map(x => x.title));
    expect(titles.size).toBeGreaterThan(1);
    ow(plan).forEach(x => {
      expect(x.segments.some(s => s.ow && (s.ow.skills || []).length)).toBe(true);
    });
  });

  it('every open-water session has a pool equivalent (§4, §8)', () => {
    ow(plan).forEach(x => {
      const fb = poolFallback(x);
      expect(fb).toBeTruthy();
      expect(fb.lines.length).toBeGreaterThan(0);
    });
    // and nothing else claims one
    expect(poolFallback(swims(plan).find(x => x.type === 'Technique'))).toBe(null);
  });

  it('easing an open-water session drops both its safety note and its category', () => {
    const x = ow(plan)[0];
    const eased = easeWorkout(x, plan);
    expect(eased.type).not.toBe('Open Water');
    expect(eased.safety).toBeFalsy();
    expect(poolFallback(eased)).toBe(null);
  });

  it('time-based skill blocks are supported and carry their minutes (§3)', () => {
    const timed = ow(plan).flatMap(x => x.segments).filter(s => s.ow && s.ow.timed);
    expect(timed.length).toBeGreaterThan(0);
    timed.forEach(s => {
      expect(s.min).toBeGreaterThan(0);
      expect(segMinutes(s)).toBe(s.min);
      expect(s.distance).toBeUndefined(); // no invented GPS distance
    });
  });
});

describe('early open-water skills are opt-in only (§7)', () => {
  it('Build stays pool-based unless the athlete says their race is open water', () => {
    const off = generatePlan(base);
    const build = p => p.weeks.filter(w => w.phase === 'Build' && !w.isRecovery)
      .flatMap(w => w.workouts).filter(x => x.discipline === 'swim' && x.type === 'Open Water');
    expect(build(off).length).toBe(0);
    const on = generatePlan({ ...base, openWaterRace: true });
    expect(build(on).length).toBeGreaterThan(0);
  });

  it('the opt-in never touches Peak rules, the easy swim, or a recovery week', () => {
    const on = generatePlan({ ...base, openWaterRace: true });
    on.weeks.forEach(w => {
      w.workouts.filter(x => x.discipline === 'swim' && !x.test && !x.race).forEach(x => {
        if (x.role === 'easy') expect(x.type).toBe('Technique');
        if (w.isRecovery) expect(x.type).not.toBe('Open Water');
      });
    });
  });

  it('a solo run plan and a swim-excluded athlete never get open water from the opt-in', () => {
    ['run5k', 'runmarathon'].forEach(raceType => {
      expect(ow(generatePlan({ ...base, raceType, openWaterRace: true })).length).toBe(0);
    });
    const excl = generatePlan({ ...base, excludedDiscipline: 'swim', openWaterRace: true });
    expect(ow(excl).length).toBe(0);
  });
});

describe('open-water exposure is tracked from recordings, not intentions (§6)', () => {
  const acts = [
    { id: 'a', type: 'OpenWaterSwim', date: '2026-07-01', movingTimeSec: 1800, distance: 1500 },
    { id: 'b', type: 'OpenWaterSwim', date: '2026-07-15', movingTimeSec: 2700, distance: 2400 },
    { id: 'c', type: 'Swim', date: '2026-07-20', movingTimeSec: 3600, distance: 3000 },
    { id: 'd', type: 'OpenWaterSwim', date: '2026-01-01', movingTimeSec: 600, distance: 400 },
  ];
  it('counts only open water, only in the window, and reports the longest swim', () => {
    const e = openWaterExposure({ activities: acts, todayISO: '2026-07-25' });
    expect(e.sessions).toBe(2);          // pool swim and the January one excluded
    expect(e.minutes).toBe(75);
    expect(e.longestMin).toBe(45);
    expect(e.longestM).toBe(2400);
    expect(e.lastDate).toBe('2026-07-15');
    expect(e.daysSince).toBe(10);
  });
  it('an athlete with no open water at all reads as none, never as an error', () => {
    const e = openWaterExposure({ activities: [], todayISO: '2026-07-25' });
    expect(e.sessions).toBe(0);
    expect(e.lastDate).toBe(null);
    expect(e.daysSince).toBe(null);
  });

  /* The feed's contract is a date-only `date` (delivered-fields.test.js pins
     it), but the counting must not hinge on it: the old private helper turned
     a datetime into NaN, which dropped the session from `recent` while still
     rendering a literal "NaN d ago" off the unfiltered `latest`. The shared
     daysBetween counts the instant's calendar day instead; genuinely
     unparseable dates still drop out quietly. */
  it('a datetime-carrying date counts on its calendar day; an unparseable one stays quiet', () => {
    const dt = openWaterExposure({
      activities: [{ id: 'a', type: 'OpenWaterSwim', date: '2026-07-15T07:02:11', movingTimeSec: 2700, distance: 2400 }],
      todayISO: '2026-07-25',
    });
    expect(dt.sessions).toBe(1); // a real recording, counted — not NaN-dropped
    expect(dt.daysSince).toBe(10); // a number, not "NaN d ago"
    const bad = openWaterExposure({
      activities: [{ id: 'b', type: 'OpenWaterSwim', date: 'not a date', movingTimeSec: 600, distance: 400 }],
      todayISO: '2026-07-25',
    });
    expect(bad.sessions).toBe(0); // garbage still drops out of the count quietly
  });
});


describe('phase 6 review fixes', () => {
  const plan = generatePlan(base);
  const owAll = ow(plan);

  it('re-sizing a session never swaps it for a different category', () => {
    // trim, boost and the de-collision resize all re-length a session; the
    // athlete asked for the same workout, shorter, not a different one
    let rebuilds = 0;
    owAll.forEach(x => {
      [0.6, 0.7, 0.8, 0.9].forEach(f => {
        const y = trimWorkout(x, plan, f);
        if (y) { rebuilds++; expect(y.title).toBe(x.title); }
      });
      [1.1, 1.2, 1.3].forEach(f => {
        const y = boostWorkout(x, plan, f);
        if (y) { rebuilds++; expect(y.title).toBe(x.title); }
      });
    });
    expect(rebuilds).toBeGreaterThan(0);
  });

  it('a pool fitness test never inherits the open-water safety wording', () => {
    // reachable with the opt-in on: the Build quality swim it overwrites IS
    // an open-water session
    const on = generatePlan({ ...base, openWaterRace: true });
    const tests = on.weeks.flatMap(w => w.workouts).filter(x => x.test);
    expect(tests.length).toBeGreaterThan(0);
    tests.forEach(x => expect(x.safety).toBeFalsy());
  });

  it('a plan stored before this phase gains its safety note and fallback on load', () => {
    const stored = JSON.parse(JSON.stringify(plan));
    stored.weeks.forEach(w => w.workouts.forEach(x => {
      delete x.safety;
      (x.segments || []).forEach(sg => delete sg.ow);
    }));
    const up = upgradePlanSegments(stored);
    const upOw = up.weeks.flatMap(w => w.workouts).filter(x => x.type === 'Open Water');
    expect(upOw.length).toBeGreaterThan(0);
    upOw.forEach(x => {
      expect(x.safety).toBe(OW_SAFETY);
      expect(poolFallback(x).lines.length).toBeGreaterThan(0);
    });
  });

  it('rep counts stay coachable: the rep lengthens instead of piling up', () => {
    ['beginner', 'intermediate', 'advanced', 'elite'].forEach(fitness => {
      ['sprint', 'olympic', 'half', 'full'].forEach(raceType => {
        const css = fitness === 'elite' ? 90 : fitness === 'beginner' ? 170 : 120;
        const p = generatePlan({ ...base, fitness, raceType, css100Sec: css, openWaterRace: true });
        ow(p).forEach(x => x.segments.forEach(sg => {
          const m = /^(\d+) × /.exec(sg.label || '');
          if (m) expect(+m[1], sg.label).toBeLessThanOrEqual(10);
        }));
      });
    });
  });

  it('the safety wording travels to the calendar export', () => {
    const ics = buildICS(plan);
    expect(ics).toContain('never swim alone');
  });

  it('a skill with no pool equivalent is left out rather than instructing nothing', () => {
    owAll.forEach(x => {
      const fb = poolFallback(x);
      fb.lines.forEach(l => expect(l).not.toMatch(/no pool equivalent/));
    });
  });
});
