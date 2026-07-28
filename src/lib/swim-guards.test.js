import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { generatePlan } from './plan.js';
import { swimReview, plannedSwimReps, REVIEW_RULES } from './swim-review.js';
import { prescribedSwim } from './css-retest.js';
import { swimDashboard } from './swim-dashboard.js';
import { strokeMetricsEnabled, STROKE_METRICS_FLAG } from './swim-strokes.js';
import { powerCurve, curveComparison, CURVE_DURATIONS } from './bike-power-curve.js';

/* Post-merge audit hardening (2026-07-28). The bike gauntlets found defect
   classes phase by phase; the swim module predates the generalised guards, so
   its siblings survived until the cross-module audit. These tests pin the
   fixes and extend the guards to the swim side. */

const base = {
  name: 'S', raceType: 'half', fitness: 'intermediate', fivekSec: 1200,
  css100Sec: 120, ftp: 250, weightKg: 75, daysPerWeek: 6,
  trainingDays: [0, 1, 2, 3, 5, 6], longDay: 5, startDate: '2026-06-01', raceDate: '2026-11-01',
};
const plan = generatePlan(base);

describe('audit: swim recovery is compared, not merely collected', () => {
  const w = plan.weeks.flatMap(x => x.workouts)
    .find(x => x.discipline === 'swim' && x.type === 'CSS Intervals'
      && plannedSwimReps(x, plan.paces).length >= 3
      && plannedSwimReps(x, plan.paces).every(r => r.targetSec && r.restSec));
  const lapsFor = (workout, restFactor) => {
    const reps = plannedSwimReps(workout, plan.paces);
    let t = 600;
    return reps.map(r => {
      const sec = r.targetSec * r.repM / 100;
      const lap = { type: 'WORK', startTimeSec: t, movingTimeSec: sec, distance: r.repM };
      t += sec + (r.restSec || 20) * restFactor;
      return lap;
    });
  };
  const act = workout => ({
    id: 's', type: 'Swim', date: '2026-06-10',
    movingTimeSec: 2400, distance: prescribedSwim(workout).distM,
  });

  it('notices when the recoveries were cut, and does not call it progress', () => {
    /* restTol sat in REVIEW_RULES from the day this shipped and nothing read
       it — the identical silent gap the bike review had fixed in its own
       gauntlet. A swimmer who cut every recovery did a harder set than the
       card and was congratulated for it. */
    if (!w) return;
    const r = swimReview({ workout: w, activity: act(w), intervals: lapsFor(w, 0.2), paces: plan.paces });
    expect(r.recoveryCompliance).toBe(0);
    expect(r.outcome).toBe('repeat');
    expect(r.text).toMatch(/recovery|recoveries/i);
  });

  it('is satisfied by recoveries actually taken', () => {
    if (!w) return;
    const r = swimReview({ workout: w, activity: act(w), intervals: lapsFor(w, 1), paces: plan.paces });
    expect(r.recoveryCompliance).toBe(100);
    expect(r.outcome).toBe('progress');
  });

  it('stays null rather than guessing when start times are missing', () => {
    if (!w) return;
    const noTimes = lapsFor(w, 1).map(l => ({ ...l, startTimeSec: null }));
    const r = swimReview({ workout: w, activity: act(w), intervals: noTimes, paces: plan.paces });
    expect(r.recoveryCompliance).toBe(null);
  });
});

describe('audit: the swim limiter does not give day one an all-clear', () => {
  it('says too-early rather than nothing-is-holding-you-back', () => {
    const d = swimDashboard({ plan, log: {}, moves: {}, activities: [], todayISO: '2026-06-01' });
    expect(d.limiter.id).toBe('too-early');
    expect(d.limiter.headline).not.toMatch(/Nothing is obviously/);
  });
});

describe('audit: the stroke gate has a door', () => {
  it('has a real flag, and DetailSheet consults it', () => {
    /* strokeMetricsEnabled shipped with zero callers and `enabled` was a
       parameter no caller supplied: a gate with no door, so the flag turning
       on would have rendered nothing anywhere. */
    expect(STROKE_METRICS_FLAG).toBe(false);   // off until the backend fields arrive
    expect(strokeMetricsEnabled({ activity: {}, laps: [], enabled: STROKE_METRICS_FLAG })).toBe(false);
    const sheet = readFileSync(new URL('../components/DetailSheet.jsx', import.meta.url), 'utf8');
    expect(sheet, 'DetailSheet does not consult the stroke gate').toMatch(/strokeMetricsEnabled/);
    expect(sheet).toMatch(/STROKE_METRICS_FLAG/);
  });
});

describe('audit: a missing power-meter source is named as a source problem', () => {
  it('flags sourceChanged and says why, instead of blaming the environment', () => {
    /* Phase 7 made comparability fail closed for a missing source, but the
       explanation string still required BOTH sides to name a meter — so the
       exact case the guard exists for was refused correctly, labelled
       "different environment", and never showed the device-change banner. */
    const SHAPE = { 5: 4.0, 15: 3.0, 30: 2.4, 60: 1.8, 180: 1.38, 300: 1.25, 720: 1.1, 1200: 1 / 0.95, 2400: 1.0, 3600: 0.97 };
    const mk = over => CURVE_DURATIONS.map(d => ({
      durationSec: d, watts: Math.round(250 * SHAPE[d]), date: '2026-07-01',
      indoor: false, quality: 'high', ...over,
    }));
    const cmp = curveComparison({
      current: powerCurve(mk({ source: 'NewMeter' })),
      previous: powerCurve(mk({ source: undefined })),
    });
    expect(cmp.improved).toEqual([]);
    expect(cmp.sourceChanged).toBe(true);
    cmp.rows.forEach(r => expect(r.why).toMatch(/power.meter/));
  });
});

describe('audit: the generalised guards now cover the swim modules too', () => {
  const MODULES = ['swim-zones.js', 'swim-review.js', 'swim-drills.js', 'swim-open-water.js',
    'swim-dashboard.js', 'swim-strokes.js', 'css-retest.js'];

  it('every rules-table key in every swim module is actually referenced', () => {
    // cvSteady and restTol sat unreferenced for weeks looking implemented;
    // owRecentDays duplicated a constant that could silently drift from it
    MODULES.forEach(mod => {
      const src = readFileSync(new URL('./' + mod, import.meta.url), 'utf8');
      [...src.matchAll(/export const (\w*(?:RULES|GATES)\w*) = \{([\s\S]*?)\n\};/g)].forEach(([, name, body]) => {
        [...body.matchAll(/^\s{2}([A-Za-z]\w*):/gm)].forEach(([, key]) => {
          expect(src.split(key).length - 1, mod + ': ' + name + '.' + key + ' is declared but never used')
            .toBeGreaterThan(1);
        });
      });
    });
  });

  it('every swim module has at least one export the app actually calls', () => {
    const srcFiles = [];
    const walk = dir => readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const full = dir + '/' + e.name;
      if (e.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) srcFiles.push(full);
    });
    walk(new URL('..', import.meta.url).pathname.replace(/\/$/, ''));
    MODULES.forEach(mod => {
      const src = readFileSync(new URL('./' + mod, import.meta.url), 'utf8');
      const exported = [...src.matchAll(/export function (\w+)/g)].map(m => m[1]);
      if (!exported.length) return;
      const called = exported.some(name => srcFiles.some(f => !f.endsWith('/' + mod)
        && !f.endsWith('/index.js')
        && new RegExp('\\b' + name + '\\b').test(readFileSync(f, 'utf8'))));
      expect(called, mod + ' has no export the app calls: a model with no caller').toBe(true);
    });
  });
});
