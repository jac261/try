import { describe, it, expect } from 'vitest';
import { generatePlan, swapForLimiter, detectLimiterSwap, addCustomWorkout, easeWorkout, boostWorkout, trimWorkout, upgradePlanSegments, segMinutes } from './plan.js';
import { cssFromTestIntervals, cssTestActivityFor, eftpProposal } from './eftp.js';
import { intervalRows } from './review.js';
import { SWIM_TYPES, isSwimWorkout, swimWorkoutIssues, isTrainingSwim } from './swimschema.js';
import { toClientState } from './api.js';

/* The swim pass (2026-07-18): the limiter frequency swap can now grant a
   third swim as a Long Swim, buildSwim gained a Long type and a level-gated
   drill catalog, and the swim CSS test's arithmetic is automated from the
   recording's laps. Each test here pins a design-panel catch. */

// Strong run (near-elite 5k), strong bike (4.3 W/kg), beginner swim: swim is
// the limiter by well over a full level, so the swap and the big bias engage.
const swimWeak = {
  name: 'S', raceType: 'olympic', fitness: 'intermediate',
  fivekSec: 1200, css100Sec: 140, ftp: 320, weightKg: 75,
  daysPerWeek: 6, trainingDays: [0, 1, 3, 4, 5, 6], longDay: 5,
  startDate: '2026-06-01', raceDate: '2026-08-30',
};

const TEMPLATE_6 = ['swim:easy', 'run:quality', 'bike:quality', 'swim:quality', 'run:long', 'bike:long'];

describe('swapForLimiter long fallback', () => {
  it('grants swim:long when swim already holds easy and quality, appended last', () => {
    const out = swapForLimiter(TEMPLATE_6, { weakest: 'swim', strongest: 'bike' }, 'Base');
    expect(out).not.toBe(TEMPLATE_6);
    expect(out[out.length - 1]).toBe('swim:long');
    expect(out).not.toContain('bike:quality'); // the donor left
    expect(out).toContain('run:long');
    expect(out).toContain('bike:long');
    expect(out.length).toBe(6);
  });

  it('never grants a long to run or bike (their longs are already in the template)', () => {
    // A hypothetical template where run holds easy+quality but no long cannot
    // arise from the shipped tables; the guard keeps the fallback swim-only.
    const t = ['run:easy', 'run:quality', 'bike:quality', 'swim:quality', 'bike:long'];
    const out = swapForLimiter(t, { weakest: 'run', strongest: 'bike' }, 'Base');
    expect(out).toBe(t); // no role available for run: skip, not a run:long
  });

  it('still skips outside Base and Build', () => {
    expect(swapForLimiter(TEMPLATE_6, { weakest: 'swim', strongest: 'bike' }, 'Peak')).toBe(TEMPLATE_6);
  });
});

describe('the third swim in a generated plan', () => {
  const p = generatePlan(swimWeak);
  const buildingWeeks = p.weeks.filter(w => (w.phase === 'Base' || w.phase === 'Build') && !w.isRecovery);
  const swapped = buildingWeeks.filter(w => w.workouts.filter(x => x.discipline === 'swim').length === 3);

  it('swim-limited 6-day weeks carry three swims including a Long Swim', () => {
    expect(swapped.length).toBeGreaterThan(0);
    swapped.forEach(w => {
      const long = w.workouts.find(x => x.discipline === 'swim' && x.role === 'long');
      expect(long).toBeTruthy();
      expect(long.type).toBe('Long');
      expect(long.title).toBe('Long Swim');
    });
  });

  it('the weekend anchors keep their days; the swim long lands on a weekday', () => {
    swapped.forEach(w => {
      const day = x => (new Date(x.date + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0=Mon..6=Sun
      const runLong = w.workouts.find(x => x.discipline === 'run' && x.role === 'long');
      const bikeLong = w.workouts.find(x => x.discipline === 'bike' && x.role === 'long');
      const swimLong = w.workouts.find(x => x.discipline === 'swim' && x.role === 'long');
      // longDay (Sat) goes to the first template long; the other weekend day
      // to the second; the appended swim long must NOT hold Sat or Sun.
      expect([day(runLong), day(bikeLong)].sort()).toEqual([5, 6]);
      expect(day(swimLong)).toBeLessThan(5);
    });
  });

  it('the swim long never exceeds the 90-minute cap, even for an elite athlete', () => {
    const elite = generatePlan({ ...swimWeak, fitness: 'elite', raceType: 'full', raceDate: '2027-02-28' });
    elite.weeks.flatMap(w => w.workouts)
      .filter(x => x.discipline === 'swim' && x.role === 'long')
      .forEach(x => expect(x.durationMin).toBeLessThanOrEqual(90));
  });

  it('detectLimiterSwap recovers the long-swap verdict from structure alone', () => {
    const verdict = detectLimiterSwap(p);
    expect(verdict).toEqual({ weakest: 'swim', strongest: 'bike' });
    // and a retarget-style regeneration under the locked verdict keeps it
    const again = generatePlan(swimWeak, { lockedSwap: verdict });
    expect(detectLimiterSwap(again)).toEqual(verdict);
  });
});

describe('the Long Swim builder', () => {
  const p = generatePlan(swimWeak);
  const someDate = wk => p.weeks[wk].start;
  const custom = (wk, dur) => addCustomWorkout(p, { discipline: 'swim', type: 'Long', durationMin: dur, dateISO: someDate(wk) }).workout;

  it('sizes volume from the session duration instead of the saturating reps formula', () => {
    const w = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
    const long75 = addCustomWorkout(p, { discipline: 'swim', type: 'Long', durationMin: 75, dateISO: w.start }).workout;
    // 75 minutes at an estimated-intermediate CSS swims well past the ~2.1 km
    // the shared reps formula tops out at.
    expect(long75.distance).toBeGreaterThan(2.6);
    expect(long75.unit).toBe('km');
    long75.segments.forEach(s => expect(s.swim).toBeTruthy()); // watch DSL for every segment
  });

  it('keeps the harder formats out of Base', () => {
    // every Base-week seed: variant menu is 2 (continuous or broken), never
    // the pyramid (which prescribes five stepped reps)
    p.weeks.filter(w => w.phase === 'Base' && !w.isRecovery).forEach(w => {
      const wo = addCustomWorkout(p, { discipline: 'swim', type: 'Long', durationMin: 60, dateISO: w.start }).workout;
      const repSegs = wo.segments.filter(s => s.swim && s.swim.n === 1);
      expect(repSegs.length).toBe(0); // pyramid steps are 1-rep swimReps
    });
  });

  it('every generated Long Swim actually swims about its stated minutes (gauntlet: clamp-budget divergence)', () => {
    // The old 2..8 rep clamp swam +24% on a beginner 30-min long and -20% or
    // worse on a capped elite 90; every variant must now track its budget.
    const profiles = [
      { ...swimWeak, fitness: 'beginner', css100Sec: 160, raceType: 'sprint' },
      swimWeak,
      { ...swimWeak, fitness: 'elite', css100Sec: 105, raceType: 'full', raceDate: '2027-02-28' },
    ];
    profiles.forEach(prof => {
      generatePlan(prof).weeks.flatMap(w => w.workouts)
        .filter(x => x.discipline === 'swim' && x.role === 'long')
        .forEach(x => {
          const actual = x.segments.reduce((a, s) => a + segMinutes(s), 0);
          const r = actual / x.durationMin;
          expect(r, x.durationMin + 'min ' + x.segments.map(s => s.label).join(' / ')).toBeGreaterThan(0.8);
          expect(r, x.durationMin + 'min ' + x.segments.map(s => s.label).join(' / ')).toBeLessThan(1.18);
        });
    });
  });

  it('boostWorkout cannot push a capped Long Swim past the pool ceiling (gauntlet)', () => {
    const elite = generatePlan({ ...swimWeak, fitness: 'elite', css100Sec: 105, raceType: 'full', raceDate: '2027-02-28' });
    const capped = elite.weeks.flatMap(w => w.workouts)
      .find(x => x.discipline === 'swim' && x.role === 'long' && x.durationMin === 90);
    expect(capped).toBeTruthy();
    expect(boostWorkout(capped, elite, 1.1).durationMin).toBe(90);
  });

  it('the continuous variant never coaches a split the review would flag (gauntlet)', () => {
    const p2 = generatePlan(swimWeak);
    p2.weeks.flatMap(w => w.workouts)
      .filter(x => x.discipline === 'swim' && x.role === 'long')
      .forEach(x => x.segments.forEach(s => expect(s.detail || '').not.toMatch(/quicker|faster/)));
  });

  it('eases to a Technique swim like every other swim', () => {
    const w = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
    const long = addCustomWorkout(p, { discipline: 'swim', type: 'Long', durationMin: 60, dateISO: w.start }).workout;
    const eased = easeWorkout(long, p);
    expect(eased.type).toBe('Technique');
    expect(eased.eased).toBe(true);
  });
});

describe('the drill catalog', () => {
  const techniques = plan => plan.weeks.flatMap(w => w.workouts)
    .filter(x => x.discipline === 'swim' && x.type === 'Technique');
  const drillSegsOf = wo => wo.segments.filter(s => /× 50 m /.test(s.label));

  it('every technique swim carries per-drill segments with a focus cue', () => {
    const p = generatePlan(swimWeak);
    const t = techniques(p);
    expect(t.length).toBeGreaterThan(0);
    t.forEach(wo => {
      const drills = drillSegsOf(wo);
      expect(drills.length).toBeGreaterThanOrEqual(3);
      drills.forEach(s => {
        expect(s.detail.length).toBeGreaterThan(10); // a cue, not a bare name
        expect(s.swim).toBeTruthy();
      });
    });
  });

  it('beginners only ever see the fundamentals; kit drills need an established stroke', () => {
    const p = generatePlan({ ...swimWeak, fitness: 'beginner' });
    techniques(p).forEach(wo => drillSegsOf(wo).forEach(s => {
      expect(s.detail).not.toMatch(/paddles|snorkel|pull buoy/);
    }));
    // an advanced athlete's rotation does reach the kit drills
    const adv = generatePlan({ ...swimWeak, fitness: 'advanced' });
    const kit = techniques(adv).some(wo => drillSegsOf(wo).some(s => /paddles|snorkel|pull buoy/.test(s.detail)));
    expect(kit).toBe(true);
  });

  it('the two technique swims of one week never share a byte-identical drill list (gauntlet + re-verify)', () => {
    // RECOVERY weeks included on purpose: they collapse both swim roles to
    // Technique at clamped rep counts, which is exactly where the first salt
    // (rep-count based) silently re-collided (re-verify catch 2026-07-18).
    ['beginner', 'intermediate', 'advanced', 'elite'].forEach(fitness => {
      ['sprint', 'olympic', 'half', 'full'].forEach(raceType => {
        const p = generatePlan({ ...swimWeak, fitness, raceType, css100Sec: 160, raceDate: raceType === 'full' ? '2027-02-28' : swimWeak.raceDate });
        p.weeks.forEach(w => {
          const t = w.workouts.filter(x => x.discipline === 'swim' && x.type === 'Technique');
          if (t.length < 2) return;
          const lists = t.map(wo => JSON.stringify(drillSegsOf(wo).map(s => s.label)));
          expect(new Set(lists).size, fitness + '/' + raceType + ' week ' + w.index).toBe(lists.length);
        });
      });
    });
  });

  it('same seed, same drills (rebuild stability)', () => {
    const a = generatePlan(swimWeak), b = generatePlan(swimWeak);
    expect(JSON.stringify(techniques(a).map(x => x.segments)))
      .toBe(JSON.stringify(techniques(b).map(x => x.segments)));
  });
});

describe('cssFromTestIntervals', () => {
  const work = (distance, movingTimeSec) => ({ type: 'WORK', distance, movingTimeSec });
  const rest = (distance, movingTimeSec) => ({ type: 'RECOVERY', distance, movingTimeSec });

  it('derives CSS from a clean metric test', () => {
    // 400 in 7:00 (105 /100m), 200 in 3:16 (98 /100m) → CSS = (420-196)/2 = 112
    const r = cssFromTestIntervals([rest(400, 500), work(400, 420), rest(200, 260), work(200, 196), rest(200, 250)]);
    expect(r).toBeTruthy();
    expect(r.css100Sec).toBe(112);
  });

  it('normalises by recorded distance for a yard pool, never a nominal /2', () => {
    // 400 yd = 365.8 m in 6:24, 200 yd = 182.9 m in 3:00: same swimmer as a
    // metric athlete with CSS (384-180)/(182.9/100) = 111.5 → 112. A naive /2
    // would claim 102, nine seconds per 100 m too fast.
    const r = cssFromTestIntervals([work(365.8, 384), work(182.9, 180)]);
    expect(r).toBeTruthy();
    expect(r.css100Sec).toBe(112);
  });

  it('fails closed on ambiguity, a missing effort, or a slower 200', () => {
    expect(cssFromTestIntervals([work(400, 420), work(380, 400), work(200, 196)])).toBe(null); // two 400 candidates
    expect(cssFromTestIntervals([work(400, 420)])).toBe(null); // no 200
    expect(cssFromTestIntervals([work(400, 420), work(200, 230)])).toBe(null); // 200 slower than the 400: busted test
    expect(cssFromTestIntervals(null)).toBe(null);
    expect(cssFromTestIntervals([])).toBe(null);
  });

  it('rejects an implausible result', () => {
    expect(cssFromTestIntervals([work(400, 200), work(200, 99)])).toBe(null); // sub-World-Record slope
  });
});

describe('cssTestActivityFor (the dedicated test-recording finder)', () => {
  const swim = (id, movingTimeSec, date = '2026-06-10', type = 'Swim') => ({ id, type, date, movingTimeSec });

  it('matches a fast swimmer\'s ~21-minute test that activityFor\'s window would reject (gauntlet)', () => {
    expect(cssTestActivityFor({ activities: [swim('a', 1286)], date: '2026-06-10' }).id).toBe('a');
  });

  it('prefers the swim closest to a realistic test length and ignores other sports and days', () => {
    const acts = [
      swim('long', 4200), swim('test', 2000),
      swim('otherday', 2100, '2026-06-09'),
      { id: 'run', type: 'Run', date: '2026-06-10', movingTimeSec: 2100 },
    ];
    expect(cssTestActivityFor({ activities: acts, date: '2026-06-10' }).id).toBe('test');
    expect(cssTestActivityFor({ activities: [], date: '2026-06-10' })).toBe(null);
    expect(cssTestActivityFor({ activities: [swim('tiny', 300)], date: '2026-06-10' })).toBe(null);
  });
});

describe('auto-CSS proposal precedence', () => {
  const plan = generatePlan({ ...swimWeak, css100Sec: 120 });
  const today = '2026-06-10';

  it('a measured test outranks the passive intervals.icu threshold setting', () => {
    const prop = eftpProposal({
      activities: [], plan, todayISO: today,
      thresholds: { swimThresholdPace: 100 / 130 }, // config says 130 (drift 8%)
      cssTest: { actId: 'a1', date: today, test: { css100Sec: 112, t400Sec: 420, t200Sec: 196, d400: 400, d200: 200 } },
    });
    expect(prop.kind).toBe('csstest');
    expect(prop.retarget).toEqual({ css100Sec: 112 });
    expect(prop.why).toContain('/100m');
    expect(prop.why).toContain('the plan trains to');
    // recorded distances, never nominal labels: a yard-pool 366 m must not
    // be dressed up as a metric 400
    expect(prop.why).toContain('400 m in');
    expect(prop.why).toContain('200 m in');
    const yard = eftpProposal({
      activities: [], plan, todayISO: today, thresholds: null,
      cssTest: { actId: 'a2', date: today, test: { css100Sec: 112, t400Sec: 384, t200Sec: 180, d400: 366, d200: 183 } },
    });
    expect(yard.why).toContain('366 m in');
    expect(yard.why).toContain('183 m in');
    expect(yard.why).not.toContain('400 m in');
  });

  it('stays quiet when the measurement matches the plan', () => {
    const prop = eftpProposal({
      activities: [], plan, todayISO: today, thresholds: null,
      cssTest: { actId: 'a1', date: today, test: { css100Sec: 120, t400Sec: 440, t200Sec: 200, d400: 400, d200: 200 } },
    });
    expect(prop).toBe(null);
  });
});

describe('swim sizing honesty (sizing pass 2026-07-18)', () => {
  // The shared reps formula ignored CSS pace, so a slow swimmer's stated
  // minutes bought far more built time than the card admitted (a beginner
  // "35 min" quality Technique swim built ~46 real minutes). Every type now
  // sizes from its own budget, the way Long already did.
  const profiles = [
    { ...swimWeak, fitness: 'beginner', css100Sec: 160, raceType: 'sprint' },
    { ...swimWeak, fitness: 'beginner', css100Sec: 170, raceType: 'olympic' },
    swimWeak,
    { ...swimWeak, fitness: 'elite', css100Sec: 105, raceType: 'full', raceDate: '2027-02-28' },
  ];
  const allSwims = prof => generatePlan(prof).weeks.flatMap(w => w.workouts)
    .filter(x => x.discipline === 'swim' && !x.test && !x.race && x.durationMin > 0);

  it('every generated swim of every type swims about its stated minutes', () => {
    profiles.forEach(prof => allSwims(prof).forEach(x => {
      const actual = x.segments.reduce((a, s) => a + segMinutes(s), 0);
      const r = actual / x.durationMin;
      const tag = prof.fitness + ' ' + x.type + ' ' + x.durationMin + 'min: ' + x.segments.map(s => s.label).join(' / ');
      expect(r, tag).toBeGreaterThan(0.8);
      expect(r, tag).toBeLessThan(1.18);
    }));
  });

  it('rep distance scales before the count turns silly (Long precedent)', () => {
    profiles.forEach(prof => allSwims(prof).forEach(x => x.segments.forEach(s => {
      if (s.swim && s.swim.n) expect(s.swim.n, x.type + ' ' + x.durationMin + 'min: ' + s.label).toBeLessThanOrEqual(24);
    })));
  });

  it('the variant menu never moves with duration (rebuild contract)', () => {
    const p = generatePlan(swimWeak);
    const wk = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
    const flavour = wo => /fast/.test(wo.segments[1].label) ? 'fast'
      : /\+ 2 s/.test(wo.segments[1].label) ? 'twos' : 'css';
    const kinds = [30, 45, 60, 75].map(d =>
      flavour(addCustomWorkout(p, { discipline: 'swim', type: 'CSS Intervals', durationMin: d, dateISO: wk.start }).workout));
    expect(new Set(kinds).size).toBe(1);
  });

  it('a deep-taper 15-minute swim still fits inside itself (shoulders step down, drills survive)', () => {
    const p = generatePlan({ ...swimWeak, fitness: 'beginner', css100Sec: 170 });
    const tech = addCustomWorkout(p, { discipline: 'swim', type: 'Technique', durationMin: 15, dateISO: p.weeks[1].start }).workout;
    const actual = tech.segments.reduce((a, s) => a + segMinutes(s), 0);
    expect(actual / 15).toBeLessThan(1.18);
    expect(tech.segments.filter(s => /× 50 m /.test(s.label)).length).toBeGreaterThanOrEqual(2);
  });

  it('an Open Water session carries its skills minutes so the card sums honestly', () => {
    const p = generatePlan(swimWeak);
    const peak = p.weeks.find(x => x.phase === 'Peak' && !x.isRecovery);
    const ow = addCustomWorkout(p, { discipline: 'swim', type: 'Open Water', durationMin: 45, dateISO: peak.start }).workout;
    const skills = ow.segments.find(s => /skills/.test(s.label));
    expect(skills.min).toBeGreaterThan(0);
    const actual = ow.segments.reduce((a, s) => a + segMinutes(s), 0);
    expect(actual / 45).toBeGreaterThan(0.85);
    expect(actual / 45).toBeLessThan(1.15);
  });
});

describe('swim coaching ceilings (sizing gauntlet 2026-07-18)', () => {
  const elite = { ...swimWeak, fitness: 'elite', css100Sec: 90, raceType: 'olympic', raceDate: '2026-10-04' };
  const allSwims = prof => generatePlan(prof).weeks.flatMap(w => w.workouts)
    .filter(x => x.discipline === 'swim' && !x.test && !x.race && x.durationMin > 0);

  it('never prescribes an unswimmable continuous block at race pace (blocker)', () => {
    // Filling the budget honestly with one 4100 m continuous CSS effort is
    // arithmetic, not coaching: past the ceiling the volume goes into reps.
    [elite, { ...elite, fitness: 'advanced', css100Sec: 105 }, swimWeak].forEach(prof => {
      allSwims(prof).filter(x => x.type === 'Race Pace').forEach(x => {
        x.segments.forEach(s => {
          const m = /^(\d+) m continuous$/.exec(s.label);
          if (m) expect(+m[1], x.durationMin + 'min ' + s.label).toBeLessThanOrEqual(1500);
        });
      });
    });
  });

  it('an Open Water session is mostly race-specific swimming, not skills filler', () => {
    allSwims(elite).filter(x => x.type === 'Open Water').forEach(x => {
      const skills = x.segments.find(s => /skills/.test(s.label));
      const total = x.segments.reduce((a, s) => a + segMinutes(s), 0);
      expect(segMinutes(skills) / total, x.durationMin + 'min').toBeLessThan(0.3);
    });
  });

  it('a long Technique swim adds drill rounds instead of becoming an endurance set', () => {
    allSwims(elite).filter(x => x.type === 'Technique' && x.durationMin >= 55).forEach(x => {
      const drills = x.segments.filter(s => /× 50 m /.test(s.label));
      expect(drills.length, x.durationMin + 'min').toBeGreaterThanOrEqual(5);
    });
  });

  it('quality sessions keep a real warm-up in front of threshold work', () => {
    const slow = { ...swimWeak, fitness: 'beginner', css100Sec: 170, raceType: 'sprint' };
    [slow, swimWeak, elite].forEach(prof => {
      allSwims(prof).filter(x => x.type === 'CSS Intervals' || x.type === 'Open Water').forEach(x => {
        const m = /^Warm-up (\d+) m$/.exec(x.segments[0].label);
        expect(+m[1], x.type + ' ' + x.durationMin + 'min').toBeGreaterThanOrEqual(200);
      });
    });
  });

  it('never prescribes the same drill twice in one session (round-2 catch)', () => {
    // The drill block grows with the budget, but the catalog a level unlocks
    // is finite (six for a beginner) and the rotation wraps, so the count has
    // to respect the pool as well as the time.
    const p = generatePlan({ ...swimWeak, fitness: 'beginner', css100Sec: 140 });
    [40, 55, 70, 85, 120, 240].forEach(d => {
      const w = addCustomWorkout(p, { discipline: 'swim', type: 'Technique', durationMin: d, dateISO: p.weeks[1].start }).workout;
      const drills = w.segments.filter(s => /× 50 m /.test(s.label)).map(s => s.label);
      expect(new Set(drills).size, d + 'min: ' + drills.join(' / ')).toBe(drills.length);
    });
  });

  it('a short Long Swim steps its shoulders down like every other type (round-2 catch)', () => {
    // Long was the last branch hardcoding 500 m of warm-up and cool-down,
    // which for a slow swimmer alone outran a trimmed session's whole budget.
    const p = generatePlan({ ...swimWeak, fitness: 'beginner', css100Sec: 180 });
    [20, 25, 30, 40].forEach(d => {
      const w = addCustomWorkout(p, { discipline: 'swim', type: 'Long', durationMin: d, dateISO: p.weeks[1].start }).workout;
      const r = w.segments.reduce((a, s) => a + segMinutes(s), 0) / d;
      expect(r, d + 'min: ' + w.segments.map(s => s.label).join(' / ')).toBeLessThan(1.18);
    });
  });

  it('the broken Endurance format keeps the budget its rounding discarded (round-2 catch)', () => {
    // Flooring the per-rep metres and then multiplying by three threw away up
    // to 297 m — a 20% undershoot at a slow pace.
    [140, 160, 180].forEach(css => {
      const p = generatePlan({ ...swimWeak, fitness: 'beginner', css100Sec: css });
      [35, 45, 55].forEach(d => {
        const w = addCustomWorkout(p, { discipline: 'swim', type: 'Endurance', durationMin: d, dateISO: p.weeks[1].start }).workout;
        const r = w.segments.reduce((a, s) => a + segMinutes(s), 0) / d;
        expect(r, 'css' + css + ' ' + d + 'min: ' + w.segments.map(s => s.label).join(' / ')).toBeGreaterThan(0.85);
      });
    });
  });

  it('an interval session always prescribes a real set, never two reps', () => {
    const slow = { ...swimWeak, fitness: 'beginner', css100Sec: 170, raceType: 'sprint' };
    [slow, swimWeak, elite].forEach(prof => {
      allSwims(prof).filter(x => x.type === 'CSS Intervals').forEach(x => {
        x.segments.forEach(s => {
          if (s.swim && s.swim.n && /@ CSS/.test(s.label)) expect(s.swim.n, x.durationMin + 'min ' + s.label).toBeGreaterThanOrEqual(3);
        });
      });
    });
  });
});

describe('two swims in a week are never the same session (role pass 2026-07-18)', () => {
  // The profile that broke the contract before roles reached buildSwim: a deep
  // recovery week pins seed to 0, collapses both swim slots to Technique, and
  // round5(35 × load) and round5(45 × load) both land on 15 min. Type, seed and
  // duration all matched, so the duration salt had nothing left to separate.
  const recoveryCollide = {
    name: 'S', raceType: 'full', fitness: 'beginner',
    fivekSec: 1200, css100Sec: 90, ftp: 320, weightKg: 75,
    daysPerWeek: 6, longDay: 5, startDate: '2026-06-01', raceDate: '2027-03-14',
  };

  it('the recovery week that used to collide now builds two distinct swims', () => {
    const swims = generatePlan(recoveryCollide).weeks[2].workouts.filter(x => x.discipline === 'swim');
    // Pin the collision preconditions too: if a future sizing change stops the
    // two slots landing on the same type/seed/duration, this test would go on
    // passing for the wrong reason and stop guarding anything.
    expect(swims.map(x => x.type)).toEqual(['Technique', 'Technique']);
    expect(swims.map(x => x.seed)).toEqual([0, 0]);
    expect(swims.map(x => x.durationMin)).toEqual([15, 15]);
    expect(swims.map(x => x.role)).toEqual(['easy', 'quality']);
    expect(JSON.stringify(swims[0].segments)).not.toBe(JSON.stringify(swims[1].segments));
  });

  it('holds across the profile matrix, not just the one repro', () => {
    ['sprint', 'olympic', 'half', 'full'].forEach(raceType => {
      ['beginner', 'intermediate', 'advanced', 'elite'].forEach(fitness => {
        [70, 90, 140, 170].forEach(css100Sec => {
          const p = generatePlan({ ...recoveryCollide, raceType, fitness, css100Sec });
          p.weeks.forEach(wk => {
            const sw = wk.workouts.filter(x => x.discipline === 'swim' && !x.race && !x.test && x.durationMin > 0);
            const seen = new Set();
            sw.forEach(x => {
              const sig = JSON.stringify(x.segments);
              expect(seen.has(sig), `${raceType}/${fitness}/${css100Sec} wk${wk.index} ${x.type} ${x.durationMin}min`).toBe(false);
              seen.add(sig);
            });
          });
        });
      });
    });
  });

  // Role only earns its place if EVERY rebuild path passes it. A path that
  // forgets rebuilds a quality swim as an easy one — a different session than
  // the one it replaced, which is the rebuild-stability contract breaking.
  //   These tests drive each path until it produces two sessions that differ in
  // NOTHING BUT role, then assert they differ. Asserting instead that a rebuild
  // at the stored duration reproduces the stored segments proves nothing:
  // trimWorkout and boostWorkout early-return the SAME OBJECT when the target
  // duration does not move (plan.js `if (dur >= w.durationMin) return w`), so
  // the assertion compares an array to itself and holds even if the path drops
  // role entirely. That vacuous version shipped here first and a gauntlet
  // mutation test caught it: deleting w.role from all three rebuild paths left
  // the whole suite green (2026-07-18).
  it('easeWorkout preserves role: two swims easing onto the same slot stay distinct', () => {
    const p = generatePlan(recoveryCollide);
    const [easy, quality] = p.weeks[2].workouts.filter(x => x.discipline === 'swim');
    // Both ease to Technique at the same 25 min floor, off the same seed, so
    // role is the only input left that differs.
    const a = easeWorkout(easy, p), b = easeWorkout(quality, p);
    expect([a.type, b.type]).toEqual(['Technique', 'Technique']);
    expect([a.durationMin, b.durationMin]).toEqual([25, 25]);
    expect(JSON.stringify(a.segments)).not.toBe(JSON.stringify(b.segments));
  });

  it('boostWorkout preserves role', () => {
    const p = generatePlan(recoveryCollide);
    const [easy, quality] = p.weeks[2].workouts.filter(x => x.discipline === 'swim');
    const a = boostWorkout(easy, p, 2), b = boostWorkout(quality, p, 2);
    expect([a.durationMin, b.durationMin]).toEqual([30, 30]);
    expect(JSON.stringify(a.segments)).not.toBe(JSON.stringify(b.segments));
  });

  it('trimWorkout preserves role', () => {
    // The recovery pair sits at 15 min, under trimWorkout's 20 min floor, so it
    // early-returns and cannot exercise this path at all. This week holds two
    // Technique swims at 30 and 35 min off one seed: trim both to 25 and only
    // role is left to tell them apart.
    const p = generatePlan({ ...recoveryCollide, raceType: 'sprint', css100Sec: 140, daysPerWeek: 5 });
    const [easy, quality] = p.weeks[27].workouts.filter(x => x.discipline === 'swim' && !x.test && !x.race && x.durationMin > 0);
    expect([easy.type, quality.type]).toEqual(['Technique', 'Technique']);
    const a = trimWorkout(easy, p, 25 / easy.durationMin), b = trimWorkout(quality, p, 25 / quality.durationMin);
    expect([a.durationMin, b.durationMin]).toEqual([25, 25]);
    expect(JSON.stringify(a.segments)).not.toBe(JSON.stringify(b.segments));
  });

  it('a rebuild is deterministic, not merely different', () => {
    const p = generatePlan(recoveryCollide);
    const quality = p.weeks[2].workouts.find(x => x.discipline === 'swim' && x.role === 'quality');
    expect(easeWorkout(quality, p).segments).toEqual(easeWorkout(quality, p).segments);
    expect(boostWorkout(quality, p, 2).segments).toEqual(boostWorkout(quality, p, 2).segments);
  });

  it('upgradePlanSegments is a no-op on a freshly generated plan', () => {
    // The migration reads the STORED w.role. If it passed undefined, every
    // quality swim in every cached plan would silently rebuild on the easy
    // rotation — a plan changing under an athlete who changed nothing.
    const p = generatePlan(recoveryCollide);
    expect(upgradePlanSegments(p)).toBe(p);
  });

  it('a custom swim takes a defined role rather than undefined', () => {
    const p = generatePlan(recoveryCollide);
    const wk = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
    const custom = addCustomWorkout(p, { discipline: 'swim', type: 'Technique', durationMin: 40, dateISO: wk.start }).workout;
    expect(custom.role).toBe('custom');
    // Stored role and built session agree, so its own rebuilds are stable.
    expect(trimWorkout(custom, p, 1).segments).toEqual(custom.segments);
  });
});

describe('swim floors yield to the budget (sizing gauntlet round 3, 2026-07-18)', () => {
  // The round-2 fixes added fixed-metre floors (a 200 m quality warm-up, a
  // two-rep race set, a 6-12 min skills band, a two-drill minimum). On a short
  // session at a slow CSS these are jointly unaffordable, and none yielded, so
  // the card silently swelled up to +48%. Every swim now degrades to an honest
  // continuous swim rather than overrun.
  const slow = css => ({ name: 'S', raceType: 'olympic', fitness: 'beginner', fivekSec: 1900, css100Sec: css, ftp: 150, weightKg: 75, daysPerWeek: 6, trainingDays: [0, 1, 3, 4, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-10-30' });
  const built = w => w.segments.reduce((a, s) => a + segMinutes(s), 0);

  it('a starved short session tracks its stated minutes for every type and slow CSS', () => {
    [160, 184, 200, 240].forEach(css => {
      const p = generatePlan(slow(css));
      ['Technique', 'CSS Intervals', 'Endurance', 'Race Pace', 'Open Water', 'Long'].forEach(type => {
        [15, 20, 25].forEach(dur => {
          const w = addCustomWorkout(p, { discipline: 'swim', type, durationMin: dur, dateISO: p.weeks[0].start }).workout;
          const r = built(w) / dur;
          const tag = 'css' + css + ' ' + type + ' ' + dur + 'min ' + w.segments.map(s => s.label).join('/');
          expect(r, tag).toBeGreaterThan(0.8);
          expect(r, tag).toBeLessThan(1.18);
        });
      });
    });
  });

  it('an Open Water skills block always carries real minutes, never advertises free work', () => {
    [120, 140, 160, 200].forEach(css => {
      const p = generatePlan(slow(css));
      [30, 45, 60, 75].forEach(dur => {
        const w = addCustomWorkout(p, { discipline: 'swim', type: 'Open Water', durationMin: dur, dateISO: p.weeks[0].start }).workout;
        const skills = w.segments.find(s => /skills/.test(s.label));
        // either the session is roomy enough to carry a real skills block, or
        // it degraded to a plain continuous swim with no skills segment
        if (skills) expect(skills.min, 'css' + css + ' ' + dur + 'min').toBeGreaterThan(0);
      });
    });
  });

  it('a degraded swim keeps its warm-up and cool-down, never collapses to a bare block with room to spare', () => {
    // The overrun-degrade must not strip the shoulders off a session that had
    // room for them: an elite endurance swim at the one duration where the
    // rep count rounds up used to drop straight to a bare set (gauntlet catch
    // 2026-07-18). It now keeps a warm-up and cool-down like fitFlex does.
    const p = generatePlan({ name: 'S', raceType: 'olympic', fitness: 'elite', fivekSec: 1100, css100Sec: 85, ftp: 300, weightKg: 70, daysPerWeek: 6, trainingDays: [0, 1, 3, 4, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2027-03-14' });
    const wk = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery && x.index % 2 === 0) || p.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
    for (let d = 55; d <= 90; d++) {
      const w = addCustomWorkout(p, { discipline: 'swim', type: 'Endurance', durationMin: d, dateISO: wk.start }).workout;
      expect(/^Warm-up/.test(w.segments[0].label), d + 'min ' + w.segments.map(s => s.label).join('/')).toBe(true);
      expect(/^Cool-down/.test(w.segments[w.segments.length - 1].label), d + 'min').toBe(true);
    }
  });

  it('no swim prescribes an uncoachable continuous block or mega-rep, even at 240 custom min', () => {
    const p = generatePlan({ ...slow(90), fitness: 'elite', raceType: 'full', raceDate: '2027-03-14' });
    const wk = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
    ['Endurance', 'Race Pace', 'CSS Intervals', 'Open Water', 'Long'].forEach(type => {
      const w = addCustomWorkout(p, { discipline: 'swim', type, durationMin: 240, dateISO: wk.start }).workout;
      w.segments.forEach(s => {
        if (!s.swim) return;
        const per = s.swim.distM != null ? s.swim.distM : s.swim.repM || 0;
        // a steady/continuous chunk never exceeds the 3000 m ceiling; race-pace
        // reps are shorter still
        const cap = /race/i.test(s.label) || /CSS/.test(s.label) ? 1500 : 3000;
        expect(per, type + ': ' + s.label).toBeLessThanOrEqual(cap);
      });
    });
  });
});

describe('Long Swim review', () => {
  const p = generatePlan(swimWeak);
  const w = p.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
  const long = addCustomWorkout(p, { discipline: 'swim', type: 'Long', durationMin: 60, dateISO: w.start }).workout;

  it('judges Long Swim reps against the steady band in the rep table', () => {
    const steady = p.paces.swim.steady;
    const rows = intervalRows({
      workout: long, paces: p.paces,
      intervals: [
        { type: 'WORK', movingTimeSec: steady * 4, distance: 400, averageSpeed: 400 / (steady * 4) },
        { type: 'WORK', movingTimeSec: (steady + 20) * 4, distance: 400, averageSpeed: 400 / ((steady + 20) * 4) },
      ],
    });
    expect(rows.judged).toBe(2);
    expect(rows.rows[0].tone).toBe('good');
    expect(rows.rows[1].tone).toBe('info');
  });
});

describe('role survives the wire (the drill-divergence guarantee depends on it)', () => {
  it('a hydrate that keeps role keeps the recovery week distinct; the mapping preserves it', () => {
    // The backend stores and returns each workout's role (PlanResponse.Role);
    // this pins the client mapping so a refactor can never quietly drop the
    // field the byte-identical-swims guarantee rides on (landing verification
    // catch 2026-07-20).
    const p = generatePlan(swimWeak);
    const wire = {
      id: 'guid-1', profile: p.profile, race: p.race, createdAt: p.createdAt,
      updatedAt: p.createdAt, totalWeeks: p.totalWeeks, paces: p.paces,
      weeks: p.weeks.map(w => ({
        index: w.index, phase: w.phase, isRecovery: w.isRecovery, start: w.start, totalMin: w.totalMin,
        // the segment DTO strips profile data; role rides on the WORKOUT and survives
        workouts: w.workouts.map(wo => ({
          ...wo, id: 'guid-' + wo.id, clientWorkoutRef: wo.id,
          segments: (wo.segments || []).map(s => ({ label: s.label, min: s.min, detail: s.detail })),
        })),
      })),
    };
    const hydrated = toClientState(wire).plan;
    hydrated.weeks.flatMap(w => w.workouts).filter(x => x.discipline !== 'rest' && !x.race)
      .forEach(x => expect(x.role, x.id).toBeTruthy());
    const rebuilt = upgradePlanSegments(hydrated);
    rebuilt.weeks.filter(w => w.isRecovery).forEach(w => {
      const swims = w.workouts.filter(x => x.discipline === 'swim');
      if (swims.length < 2) return;
      const lists = swims.map(x => JSON.stringify(x.segments));
      expect(new Set(lists).size, 'week ' + w.index).toBe(lists.length);
    });
  });
});


describe('Phase 1: the swim generation matrix conforms and is covered', () => {
  // Swim-limited so the frequency swap grants a Long and swim volume is high;
  // spread across levels so the intensity ladder surfaces every rung.
  const base = {
    fivekSec: 1200, css100Sec: 150, ftp: 320, weightKg: 75,
    trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, daysPerWeek: 6,
    startDate: '2026-06-01', raceDate: '2026-09-27',
  };
  const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
  const plans = [];
  LEVELS.forEach(fitness => {
    plans.push(generatePlan({ ...base, name: 'M', raceType: 'olympic', fitness }));
    plans.push(generatePlan({ ...base, name: 'M', raceType: 'maintenance', horizonWeeks: 12, fitness }));
  });

  const swims = plans.flatMap(p => p.weeks.flatMap(w => w.workouts.map(x => ({ x, phase: w.phase, rec: w.isRecovery, plan: p }))))
    .filter(e => isTrainingSwim(e.x));

  it('every generated swim training session across levels, phases and roles conforms to the schema', () => {
    expect(swims.length).toBeGreaterThan(50);
    const bad = swims.map(e => ({ e, issues: swimWorkoutIssues(e.x) })).filter(r => r.issues.length);
    expect(bad.map(r => r.e.x.type + ':' + r.issues.join(','))).toEqual([]);
  });

  it('the sweep actually exercises every swim type, every phase, and all three roles (not vacuous)', () => {
    const typesSeen = new Set(swims.map(e => e.x.type));
    const phasesSeen = new Set(swims.map(e => e.phase));
    const rolesSeen = new Set(swims.map(e => e.x.role));
    SWIM_TYPES.forEach(t => expect(typesSeen.has(t), 'type ' + t + ' never generated').toBe(true));
    ['Base', 'Build', 'Peak', 'Taper', 'Maintain'].forEach(ph => expect(phasesSeen.has(ph), 'phase ' + ph + ' unseen').toBe(true));
    ['easy', 'quality', 'long'].forEach(r => expect(rolesSeen.has(r), 'role ' + r + ' unseen').toBe(true));
  });

  it('holds the core weekly invariants at scale', () => {
    // no Long swim exceeds the 90-minute cap
    swims.filter(e => e.x.type === 'Long').forEach(e => expect(e.x.durationMin).toBeLessThanOrEqual(90));
    // a Long swim only ever appears on a plan whose limiter swap granted swim
    swims.filter(e => e.x.type === 'Long').forEach(e =>
      expect(e.plan.limiterSwap && e.plan.limiterSwap.weakest).toBe('swim'));
    // the Peak easy swim keeps its technique work; non-easy Peak swims are Open Water
    swims.filter(e => e.phase === 'Peak' && !e.rec).forEach(e =>
      expect(e.x.role === 'easy' ? e.x.type === 'Technique' : e.x.type === 'Open Water').toBe(true));
    // two swims in any week are never byte-identical (type + duration)
    plans.forEach(p => p.weeks.forEach(w => {
      const sw = w.workouts.filter(isTrainingSwim).map(x => x.type + '|' + x.durationMin);
      expect(new Set(sw).size).toBe(sw.length);
    }));
  });

  it('swim retargeting stays disabled on a solo run plan (no swim plan to retarget)', () => {
    const solo = generatePlan({ ...base, name: 'R', raceType: 'runmarathon', fitness: 'intermediate' });
    // a live intervals.icu swim threshold must propose nothing on a run-only plan
    expect(eftpProposal({ activities: [], thresholds: { swimThresholdPace: 1.4 }, plan: solo, todayISO: '2026-07-01' })).toBe(null);
  });
});


describe('Phase 2: the pool profile', () => {
  const base = {
    name: 'P', raceType: 'olympic', fitness: 'intermediate',
    fivekSec: 1200, css100Sec: 150, ftp: 320, weightKg: 75,
    daysPerWeek: 6, trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5,
    startDate: '2026-06-01', raceDate: '2026-09-27',
  };
  const gen = pool => generatePlan(pool ? { ...base, pool } : base);
  const swimsOf = plan => plan.weeks.flatMap(w => w.workouts).filter(isTrainingSwim);
  const Y25 = { length: 25, unit: 'yards' };

  it('a yard pool gives yard-native, whole-length instructions and never a partial length', () => {
    const swims = swimsOf(gen(Y25));
    expect(swims.length).toBeGreaterThan(30);
    let mLabels = 0, ydLabels = 0;
    swims.forEach(x => x.segments.forEach(sg => {
      if (/\b\d+ m\b/.test(sg.label)) mLabels++;
      if (/\b\d+ yd\b/.test(sg.label)) ydLabels++;
      if (sg.swim) {
        const per = sg.swim.distM != null ? sg.swim.distM : sg.swim.repM;
        if (per) expect(Math.abs(Math.round(per / 22.86) - per / 22.86)).toBeLessThan(1e-6); // whole lengths
      }
    }));
    expect(mLabels).toBe(0);         // no stray metres in a yard plan
    expect(ydLabels).toBeGreaterThan(50);
  });

  it('changing pool never alters CSS or the swim threshold (§8)', () => {
    const m = gen(null), y = gen(Y25);
    expect(y.profile.css100Sec).toBe(m.profile.css100Sec);
    expect(y.paces.swim.css).toBe(m.paces.swim.css);
    // the pool only rode along on paces for construction
    expect(y.paces.pool).toEqual(Y25);
    expect(m.paces.pool).toEqual({ length: 25, unit: 'metres' }); // default
  });

  it('a yard pool preserves session duration (counts re-derive from actual metres)', () => {
    const y = swimsOf(gen(Y25));
    y.forEach(x => {
      const built = x.segments.reduce((a, sg) => a + segMinutes(sg), 0);
      // within the same band the default sizing tests use, and NOT systematically short
      expect(built).toBeGreaterThanOrEqual(x.durationMin * 0.85);
      expect(built).toBeLessThanOrEqual(x.durationMin * 1.15);
    });
  });

  it('an unset pool falls back to 25 m and is byte-identical (helpers are the identity there)', () => {
    const noPool = swimsOf(generatePlan({ ...base, pool: undefined }));
    const explicit25 = swimsOf(gen({ length: 25, unit: 'metres' }));
    expect(noPool.map(x => x.segments.map(s => s.label))).toEqual(explicit25.map(x => x.segments.map(s => s.label)));
    // a garbage pool also falls back, never generates a partial
    const bad = swimsOf(generatePlan({ ...base, pool: { length: 0, unit: 'furlongs' } }));
    expect(bad.map(x => x.segments.map(s => s.label))).toEqual(explicit25.map(x => x.segments.map(s => s.label)));
  });

  it('the CSS test protocol follows the pool, and stays canonical in seconds per 100', () => {
    // the swim CSS test lands in a plan as a scheduled benchmark
    const yTest = gen(Y25).weeks.flatMap(w => w.workouts).find(x => x.test && x.testKind === 'swimCss');
    const mTest = gen(null).weeks.flatMap(w => w.workouts).find(x => x.test && x.testKind === 'swimCss');
    if (yTest && mTest) {
      expect(yTest.segments.some(s => /400 yd/.test(s.label))).toBe(true);
      expect(mTest.segments.some(s => /400 m/.test(s.label))).toBe(true);
    }
  });
});

describe('Phase 2a gauntlet fixes', () => {
  const base = {
    name: 'G', raceType: 'olympic', fitness: 'intermediate',
    fivekSec: 1200, css100Sec: 150, ftp: 320, weightKg: 75,
    daysPerWeek: 6, trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5,
    startDate: '2026-06-01', raceDate: '2026-09-27',
  };
  const swimsOf = pool => ['beginner', 'intermediate', 'advanced', 'elite']
    .flatMap(fitness => generatePlan({ ...base, fitness, pool }).weeks.flatMap(w => w.workouts).filter(isTrainingSwim));
  const Y25 = { length: 25, unit: 'yards' };
  const M50 = { length: 50, unit: 'metres' };

  it('a yard pool shows pace per 100 yd on every swim line, never /100m', () => {
    swimsOf(Y25).forEach(x => x.segments.forEach(sg => {
      if (sg.detail) {
        expect(sg.detail).not.toMatch(/\/100m/);
        if (/\/100/.test(sg.detail)) expect(sg.detail).toMatch(/\/100yd/);
      }
      expect(sg.label).not.toMatch(/s\/100 m/);
    }));
  });

  it('the Technique drill split is whole pool lengths that sum to the rep', () => {
    [{ pool: null, len: 25 }, { pool: M50, len: 50 }, { pool: Y25, len: 25 }].forEach(({ pool, len }) => {
      swimsOf(pool).filter(x => x.type === 'Technique').forEach(x => x.segments.forEach(sg => {
        const m = sg.label.match(/(\d+) (?:m|yd) as (\d+) (?:m|yd) drill \/ (\d+) (?:m|yd) smooth/);
        if (m) {
          const rep = Number(m[1]), drill = Number(m[2]), smooth = Number(m[3]);
          expect(drill + smooth).toBe(rep);
          expect(drill % len).toBe(0);
        }
      }));
    });
  });

  it('the 25 m Technique split is byte-identical to before', () => {
    expect(swimsOf(null).some(x => x.segments.some(sg => /100 m as 25 m drill \/ 75 m smooth/.test(sg.label)))).toBe(true);
  });
});

describe('Phase 2b: the CSS test rounds to whole lengths on any pool', () => {
  const base = {
    name: 'C', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
    css100Sec: 150, ftp: 320, weightKg: 75, daysPerWeek: 6,
    trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
  };
  const cssTest = pool => generatePlan({ ...base, pool }).weeks.flatMap(w => w.workouts).find(x => x.test && x.testKind === 'swimCss');

  it('presets keep the 400/200 protocol (byte-identical)', () => {
    [null, { length: 50, unit: 'metres' }, { length: 25, unit: 'yards' }].forEach(pool => {
      const t = cssTest(pool);
      if (t) {
        const u = pool && pool.unit === 'yards' ? 'yd' : 'm';
        expect(t.segments.some(sg => sg.label === '400 ' + u + ' time trial — all out')).toBe(true);
        expect(t.note).toMatch(/÷ 2\b/);
      }
    });
  });

  it('a custom non-divisor pool rounds the test to whole lengths with an exact divisor', () => {
    const t = cssTest({ length: 33, unit: 'metres' });
    if (t) {
      // 400 -> 12 lengths -> 396; 200 -> 6 -> 198; every distance a multiple of 33
      const nums = (t.segments.map(sg => sg.label).join(' ').match(/\d+/g) || []).map(Number).filter(n => n > 50);
      nums.forEach(n => expect(n % 33).toBe(0));
      expect(t.note).toMatch(/T396 − T198.*÷ 1\.98/);
    }
  });
});

describe('Phase 3: cool-downs move to the Recovery zone', () => {
  const p = generatePlan({
    name: 'Z', raceType: 'olympic', fitness: 'intermediate', fivekSec: 1200,
    css100Sec: 150, ftp: 320, weightKg: 75, daysPerWeek: 6,
    trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-09-27',
  });
  const swims = p.weeks.flatMap(w => w.workouts).filter(isTrainingSwim);

  it('the cool-down swims slower than the warm-up (Recovery +20 vs Technique +12)', () => {
    let checked = 0;
    swims.forEach(x => {
      const wu = x.segments.find(g => /Warm-up/.test(g.label));
      const cd = x.segments.find(g => /Cool-down/.test(g.label));
      if (wu && cd) {
        // pace shows in the detail; recovery is a bigger sec/100m than technique
        const pace = d => Number((d.match(/(\d+):(\d\d) \/100/) || []).slice(1).reduce((a, b, i) => i ? a + Number(b) : Number(b) * 60, 0));
        expect(pace(cd.detail)).toBeGreaterThan(pace(wu.detail));
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(5);
  });

  it('the CSS test cool-down is Recovery too, not the faster warm-up pace', () => {
    // the fitness-test swim lives in a separate builder; its cool-down must
    // follow the same Recovery rule so no cool-down in the app is an outlier
    const test = p.weeks.flatMap(w => w.workouts).find(x => x.test && x.testKind === 'swimCss');
    if (test) {
      const pace = d => Number((String(d).match(/(\d+):(\d\d) \/100/) || []).slice(1).reduce((a, b, i) => i ? a + Number(b) : Number(b) * 60, 0));
      const wu = test.segments.find(g => /Warm-up/.test(g.label));
      const cd = test.segments.find(g => /Cool-down/.test(g.label));
      expect(pace(cd.detail)).toBeGreaterThan(pace(wu.detail));
    }
  });
});

