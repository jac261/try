import { describe, it, expect } from 'vitest';
import { generatePlan, startVolumeShortfall, START_SHORTFALL_PCT } from './plan.js';
import { startAnchors, anchorLongCap, grownCap, weeklyHoursScale, START_VOLUME_RULES } from './start-volume.js';
import { segMinutes } from './plan.js';

/* The defect this feature exists for: a full-distance plan at advanced level
   opened week one with a 4.3 km long swim, a 3 h 25 ride and a 2 h run —
   week volume was race-anchored and nothing asked where the athlete is. */

const base = {
  name: 'J', raceType: 'full', fitness: 'advanced', fivekSec: 1200, css100Sec: 105,
  ftp: 280, weightKg: 78, daysPerWeek: 6, trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5,
  startDate: '2026-08-03', raceDate: '2026-12-06',
};
const ANCHORED = { ...base, longestSwimM: 2500, longestRideMin: 150, longestRunMin: 90, weeklyHours: 9 };
const longsOf = (p, disc) => p.weeks.map(wk => wk.workouts.find(w => w.discipline === disc && (w.role === 'long' || disc === 'brick')))
  .map(w => (w ? w.durationMin : null));

describe('absent anchors change nothing at all', () => {
  it('a profile that never answered generates the identical plan', () => {
    const a = generatePlan(base);
    const b = generatePlan({ ...base, weeklyHours: null, longestSwimM: null, longestRideMin: null, longestRunMin: null });
    expect(JSON.stringify(b.weeks)).toBe(JSON.stringify(a.weeks));
  });

  it('a typo outside the sane ranges is ignored, not obeyed', () => {
    // 500 hours a week and a 50 m longest swim are answers to a different
    // question; clamping them IN would either no-op or flatten the plan
    const a = generatePlan(base);
    const b = generatePlan({ ...base, weeklyHours: 500, longestSwimM: 50, longestRideMin: 5000, longestRunMin: 1 });
    expect(JSON.stringify(b.weeks)).toBe(JSON.stringify(a.weeks));
  });
});

describe('the reported defect is fixed', () => {
  const p = generatePlan(ANCHORED);

  it('week one starts at the athlete, not at the race', () => {
    const w1 = p.weeks[0].workouts;
    const swim = w1.find(w => w.discipline === 'swim' && w.role === 'long');
    const ride = w1.find(w => w.discipline === 'bike' && w.role === 'long');
    const run = w1.find(w => w.discipline === 'run' && w.role === 'long');
    // 2500 m at this athlete's steady pace is ~45 min, not 80 (4.3 km)
    expect(swim.durationMin).toBeLessThanOrEqual(50);
    expect(ride.durationMin).toBeLessThanOrEqual(150);
    expect(run.durationMin).toBeLessThanOrEqual(90);
    // and the week fits the stated hours (small tolerance for rounding)
    expect(p.weeks[0].totalMin).toBeLessThanOrEqual(9 * 60 * 1.02);
  });

  it('long sessions grow at about ten percent per training week, never faster', () => {
    ['swim', 'run', 'bike'].forEach(disc => {
      const seq = longsOf(p, disc);
      let tw = 0;
      for (let i = 0; i < seq.length; i++) {
        const wk = p.weeks[i];
        if (seq[i] != null && !wk.isRecovery && wk.phase !== 'Taper') {
          const anchor = disc === 'swim' ? 45 : disc === 'bike' ? 150 : 90;
          const allowed = anchor * Math.pow(1.1, tw) + 5;   // +5 for round5
          expect(seq[i], disc + ' week ' + i + ' outran the growth curve').toBeLessThanOrEqual(Math.max(allowed, seq[i - 1] || 0));
        }
        if (!wk.isRecovery) tw += 1;
      }
    });
  });

  it('the race-driven curve takes over and the peak is untouched', () => {
    const plain = generatePlan(base);
    const peakOf = (pp, disc) => Math.max(...longsOf(pp, disc).filter(v => v != null));
    // by the time the grown anchors cross the engine curve, they are a no-op:
    // the biggest week of the plan is the same plan Jon would get today
    ['swim', 'bike', 'run'].forEach(disc =>
      expect(peakOf(p, disc), disc + ' peak was flattened').toBe(peakOf(plain, disc)));
  });

  it('recovery weeks still dip below their neighbours', () => {
    const rec = p.weeks.find(w => w.isRecovery);
    const prev = p.weeks[rec.index - 1];
    expect(rec.totalMin).toBeLessThan(prev.totalMin);
  });

  it('every rebuilt card still sums to its duration', () => {
    p.weeks.flatMap(w => w.workouts)
      .filter(w => !w.race && !w.test && (w.discipline === 'run' || w.discipline === 'bike'))
      .forEach(w => {
        const sum = (w.segments || []).reduce((a, s) => a + segMinutes(s), 0);
        expect(Math.abs(sum - w.durationMin), w.type + ' wk' + w.week).toBeLessThanOrEqual(1.01);
      });
  });

  it('generating twice is identical (rebuild stability)', () => {
    expect(JSON.stringify(generatePlan(ANCHORED).weeks)).toBe(JSON.stringify(p.weeks));
  });
});

describe('the pieces', () => {
  it('converts a swim anchor through the athlete own pace', () => {
    const a = startAnchors({ longestSwimM: 2500 }, { swim: { steady: 110, css: 100 } });
    expect(a.swimLongMin).toBe(Math.round(2500 / 100 * 110 / 60));
    // no pace at all: the swim anchor stands down rather than guessing
    expect(startAnchors({ longestSwimM: 2500 }, {}).swimLongMin).toBe(null);
  });

  it('a brick rides the bike anchor', () => {
    const anchors = startAnchors({ longestRideMin: 120 }, {});
    expect(anchorLongCap({ anchors, disc: 'brick', isLong: true, trainingWeeksElapsed: 0 })).toBe(120);
  });

  it('the growth clock compounds and the caps only ever lower', () => {
    expect(grownCap(60, 0)).toBe(60);
    expect(Math.round(grownCap(60, 3))).toBe(Math.round(60 * 1.331));
    const anchors = startAnchors({ longestRunMin: 60 }, {});
    // deep into the plan the cap exceeds anything the engine asks for
    expect(anchorLongCap({ anchors, disc: 'run', isLong: true, trainingWeeksElapsed: 20 })).toBeGreaterThan(300);
  });

  it('the hours scale never cuts below the floor and never touches a fitting week', () => {
    const anchors = startAnchors({ weeklyHours: 8 }, {});
    expect(weeklyHoursScale({ anchors, plannedMin: 400, flexibleMin: 200, trainingWeeksElapsed: 0 })).toBe(null);
    const f = weeklyHoursScale({ anchors, plannedMin: 700, flexibleMin: 100, trainingWeeksElapsed: 0 });
    expect(f).toBe(START_VOLUME_RULES.weeklyFloor);
  });
});


describe('the under-built warning', () => {
  it('speaks when a low anchor on a short runway cannot reach race preparation', () => {
    // 12 weeks to a full from a 60-minute longest ride: the safe ramp cannot
    // close that, and hiding it would make the anchors a comfort feature
    const short = {
      ...base, raceDate: '2026-10-25',
      longestSwimM: 1000, longestRideMin: 60, longestRunMin: 40, weeklyHours: 5,
    };
    const sf = startVolumeShortfall(short);
    expect(sf).toBeTruthy();
    expect(sf.items.length).toBeGreaterThan(0);
    sf.items.forEach(i => expect(i.pct).toBeGreaterThanOrEqual(START_SHORTFALL_PCT));
    expect(sf.text).toMatch(/peaks around/);
    expect(sf.text).toMatch(/More weeks/);
    // a statement about the plan, never an instruction to ramp faster
    expect(sf.text).not.toMatch(/train more|push harder|catch up/i);
    expect(sf.sig).toContain('start-shortfall:');
  });

  it('stays silent without anchors, and for anchors the runway absorbs', () => {
    expect(startVolumeShortfall(base)).toBe(null);
    // Jon's own case: honest anchors, 18-week runway — the curves meet, so
    // there is nothing to warn about
    expect(startVolumeShortfall(ANCHORED)).toBe(null);
  });

  it('changing the answer changes the signature, so a dismissed warning can speak again', () => {
    const short = { ...base, raceDate: '2026-10-25', longestRideMin: 60 };
    const a = startVolumeShortfall(short);
    const b = startVolumeShortfall({ ...short, longestRideMin: 90 });
    if (a && b) expect(a.sig).not.toBe(b.sig);
  });
});

describe('the anchors are editable after onboarding', () => {
  it('FitnessEditor carries the four fields and submits them', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../features/settings/FitnessEditor.jsx', import.meta.url), 'utf8');
    ['weeklyHours', 'longestSwimM', 'longestRideMin', 'longestRunMin'].forEach(k => {
      expect(src.split(k).length - 1, k + ' missing from the editor').toBeGreaterThanOrEqual(3); // state + input + payload
    });
    // clearing a field clears the anchor rather than keeping a stale one
    expect(src).toMatch(/f\.weeklyHours \? Number\(f\.weeklyHours\) : null/);
  });
});


describe('App declares every hook above its early returns', () => {
  it('no useState/useMemo/useEffect after the first conditional return', async () => {
    /* The shortfall useMemo was first placed below App's no-plan return, so
       CREATING A PLAN changed the hook count and React threw — the same
       class the audit fixed in WeeklyDigest, reintroduced one level up. */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../app/App.jsx', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function App'));
    const firstReturn = body.search(/\n  if \([^)]*\) return /);
    expect(firstReturn).toBeGreaterThan(0);
    expect(body.slice(firstReturn)).not.toMatch(/\buse(State|Effect|Memo|Ref|Callback)\s*\(/);
  });
});
