import { describe, it, expect } from 'vitest';
import { generatePlan } from './plan.js';
import { RUN_RAMP_RULES, LONG_RUN_RULES, runLoadFromActivities } from './runload.js';
import { weeklyRunKm } from './runstats.js';
import {
  RUN_VOLUME_RULES, runVolumeModel, runDurabilitySignals,
  RUN_LONG_OBJECTIVES, HARD_LONG_OBJECTIVES, MAX_HARD_LONG_SHARE,
  runLongObjective, longRunMix,
} from './run-durability.js';

/* Run phase 6 — run load, the long run, and durability.
 *
 * §4's rotation rule already held: measured across every solo plan in the
 * matrix, hard long runs are 12.5% of all long runs against a 25% ceiling,
 * and objectives genuinely rotate. What was missing is that nothing could
 * SAY so — the long run's objective existed only as a shape the builder
 * happened to produce, and the load model tracked two dimensions when a ramp
 * is made of four.
 */

const DAYSETS = { 3: [1, 3, 5], 5: [0, 1, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const base = {
  name: 'R', fivekSec: 1500, css100Sec: 110, ftp: 250, weightKg: 70,
  startDate: '2026-06-01', raceDate: '2026-10-03',
};
const SOLO = ['run5k', 'run10k', 'runhalf', 'runmarathon'];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
const TODAY = '2026-07-29';
const planFor = (rt, fit, d) => generatePlan({ ...base, raceType: rt, fitness: fit, daysPerWeek: d, trainingDays: DAYSETS[d], longDay: 5 });
const longsOf = p => {
  const rwi = p.weeks.findIndex(w => w.workouts.some(x => x.race));
  return p.weeks.filter((w, i) => i < rwi).flatMap(w => w.workouts.filter(x => x.discipline === 'run' && x.type === 'Long'));
};
/* Fixtures are built on explicit CALENDAR WEEKS, not day offsets from today.
   An offset-based generator spreads each notional week across two real ones,
   so the baseline it produces is not the block the test says it is — which is
   how the first version of this file failed to fire a signal it should have.

   `weeks` complete past weeks, one indoor run each, plus whatever the test
   adds to the current week. TODAY is a Wednesday; its Monday is 2026-07-27. */
const MONDAY = '2026-07-27';
const dayOf = (weeksBack, offset) => {
  const d = new Date(MONDAY);
  d.setDate(d.getDate() - weeksBack * 7 + offset);
  return d.toISOString().slice(0, 10);
};
const run = (date, min, indoor) => ({
  type: indoor ? 'VirtualRun' : 'Run', date,
  movingTimeSec: min * 60, distance: min * 200,
});
const steady = ({ weeks = 6, perWeek = 3, longMin = 90, easyMin = 40 } = {}) => {
  const acts = [];
  const slots = [0, 2, 4, 1, 3, 5, 6];            // Mon, Wed, Fri, Tue, ...
  for (let w = 1; w <= weeks; w++) {
    for (let r = 0; r < perWeek; r++) {
      acts.push(run(dayOf(w, slots[r]), r === perWeek - 1 ? longMin : easyMin, r === 0));
    }
  }
  return acts;
};
// the current (in-progress) week: Mon 27th, Tue 28th, Wed 29th
const thisWeek = (mins = []) => mins.map((m, i) => run(dayOf(0, i), m, false));

describe('the shipped guardrails are untouched', () => {
  it('the rule tables still hold their shipped thresholds', () => {
    expect(RUN_RAMP_RULES.buildPct).toBe(0.30);
    expect(RUN_RAMP_RULES.riskPct).toBe(0.50);
    expect(RUN_RAMP_RULES.minBaselineWeeks).toBe(2);
    expect(LONG_RUN_RULES.jumpPct).toBe(0.4);
    expect(LONG_RUN_RULES.lookbackDays).toBe(28);
  });

  it('runLoadFromActivities still measures against the athlete own baseline', () => {
    /* Asserting the RELATIONSHIP rather than an absolute ramp figure. This
       function uses a rolling seven-day window, which does not line up with
       the calendar weeks the fixtures are built on, so a "steady block" has a
       non-zero ramp here for reasons that say nothing about the code. What
       must hold is that adding load raises the ramp and the baseline is the
       athlete's own. */
    expect(runLoadFromActivities({ activities: [], todayISO: TODAY })).toBe(null);
    const calm = runLoadFromActivities({ activities: steady(), todayISO: TODAY });
    expect(calm.baselineWeekly).toBeGreaterThan(0);
    const spiked = runLoadFromActivities({
      activities: steady().concat(thisWeek([60, 60, 60])), todayISO: TODAY,
    });
    expect(spiked.rampPct).toBeGreaterThan(calm.rampPct);
    expect(spiked.baselineWeekly).toBe(calm.baselineWeekly); // the past did not move
  });
});

describe('the volume model tracks the dimensions a ramp is made of', () => {
  const model = runVolumeModel({ activities: steady(), todayISO: TODAY });

  it('reports every dimension the data can support', () => {
    const w = model[model.length - 2]; // a complete week
    ['start', 'runs', 'km', 'minutes', 'longestMin', 'longShare', 'qualityMin', 'qualityShare', 'indoorMin', 'outdoorMin']
      .forEach(k => expect(w[k], k + ' missing').not.toBeUndefined());
    expect(w.runs).toBe(3);
    expect(w.minutes).toBeGreaterThan(0);
    expect(w.longestMin).toBe(90);
  });

  it('the long run share is visible and is a real fraction of the week', () => {
    const w = model[model.length - 2];
    expect(w.longShare).toBeGreaterThan(0);
    expect(w.longShare).toBeLessThanOrEqual(1);
    expect(w.longShare).toBeCloseTo(w.longestMin / w.minutes, 2);
  });

  it('indoor runs count toward volume, and are still identifiable', () => {
    // §2 and §6. A treadmill run is real load; only its DERIVED pace is
    // meaningless. Excluding it would under-report the ramp it caused.
    const w = model[model.length - 2];
    expect(w.indoorMin).toBeGreaterThan(0);
    expect(w.indoorMin + w.outdoorMin).toBe(w.minutes);
    // and the shipped km chart counts them too
    const km = weeklyRunKm({ activities: steady(), todayISO: TODAY });
    expect(km.some(x => x.km > 0)).toBe(true);
  });

  it('quality share reads the PLAN, not the pace of the recording', () => {
    // A hard session run badly is still a hard session. Classifying by pace
    // would drop exactly the sessions that matter to a density signal.
    const plan = planFor('runhalf', 'intermediate', 5);
    const w = plan.weeks.find(x => x.phase === 'Build' && !x.isRecovery);
    const acts = w.workouts.filter(x => x.discipline === 'run' && !x.race)
      .map(x => ({ type: 'Run', date: x.date, movingTimeSec: x.durationMin * 60, distance: x.durationMin * 200 }));
    const m = runVolumeModel({ activities: acts, plan, todayISO: iso7(w.start), weeks: 2 });
    const wk = m.find(x => x.minutes > 0);
    expect(wk.qualityMin).toBeGreaterThan(0);
    expect(wk.qualityShare).toBeGreaterThan(0);
    expect(wk.qualityShare).toBeLessThan(1);
  });
  function iso7(d) { const x = new Date(d); x.setDate(x.getDate() + 6); return x.toISOString().slice(0, 10); }
});

describe('durability signals are cautions, never a score', () => {
  it('say nothing when the history is too thin to mean anything', () => {
    /* An athlete two weeks in must not be told their training is escalating.

       The fixture carries a REAL SPIKE on top of the thin history — one past
       week, then six runs this week — so the guard is the only thing keeping
       the signal quiet. Without the spike this test passed even with the
       guard deleted, because a fixture with no current-week load produces no
       signal either way: it proved nothing. */
    expect(runDurabilitySignals({ activities: [], todayISO: TODAY })).toEqual([]);
    const thin = steady({ weeks: 1 }).concat(thisWeek([40, 40, 40, 40, 40, 40]));
    expect(runDurabilitySignals({ activities: thin, todayISO: TODAY })).toEqual([]);
    // and the same spike on a full history DOES speak, so the silence above
    // is the guard rather than the fixture
    const thick = steady({ weeks: 6 }).concat(thisWeek([40, 40, 40, 40, 40, 40]));
    expect(runDurabilitySignals({ activities: thick, todayISO: TODAY }).length).toBeGreaterThan(0);
  });

  it('say nothing when the baseline is too small to ramp from', () => {
    /* A separate guard from the one above, and it needs its own fixture: an
       athlete running fifteen minutes a week can triple that and still be
       running very little. Percentage change on a tiny base is noise, which
       is why RUN_RAMP_RULES has carried a minute floor since it shipped. */
    const tiny = steady({ weeks: 6, perWeek: 3, easyMin: 5, longMin: 5 })
      .concat(thisWeek([5, 5, 5, 5, 5, 5]));
    const model = runVolumeModel({ activities: tiny, todayISO: TODAY });
    expect(model[0].minutes).toBeLessThan(RUN_VOLUME_RULES.minWeeklyMin); // the fixture really is tiny
    expect(runDurabilitySignals({ activities: tiny, todayISO: TODAY })).toEqual([]);
  });

  it('say nothing about a steady block', () => {
    expect(runDurabilitySignals({ activities: steady(), todayISO: TODAY })).toEqual([]);
  });

  it('fire on a frequency jump, and name the change that caused it', () => {
    // three runs a week for six weeks, then six in the current week
    const acts = steady({ weeks: 6 }).concat(thisWeek([40, 40, 40, 40, 40, 40]));
    const sig = runDurabilitySignals({ activities: acts, todayISO: TODAY });
    const freq = sig.find(s => s.key === 'frequency-jump');
    expect(freq).toBeTruthy();
    // §5: the explanation states WHICH recent change triggered the response
    expect(freq.why).toMatch(/\d/);
    expect(freq.change.dimension).toBe('frequency');
    expect(freq.change.to).toBeGreaterThan(freq.change.from);
  });

  it('fire on a long run jump, naming both numbers', () => {
    const acts = steady({ weeks: 6, longMin: 60 }).concat(thisWeek([40, 120]));
    const sig = runDurabilitySignals({ activities: acts, todayISO: TODAY });
    const jump = sig.find(s => s.key === 'long-run-jump');
    expect(jump).toBeTruthy();
    expect(jump.change.to).toBeGreaterThan(jump.change.from);
    expect(jump.why).toContain(String(jump.change.to));
  });

  it('never present a score, a risk number or a diagnosis', async () => {
    /* §3 and §6. A single number invites an athlete to read an injury
       probability into arithmetic carrying nothing of the sort, which is why
       bike readiness has no score either. Asserted on the MODULE SURFACE, not
       on one output: a score added later would pass a per-signal check. */
    const mod = await import('./run-durability.js');
    Object.keys(mod).forEach(k =>
      expect(/score|risk|injur|probab/i.test(k), k + ' looks like a score').toBe(false));
    const acts = steady({ weeks: 6 }).concat(thisWeek([40, 40, 40, 40, 40, 40]));
    runDurabilitySignals({ activities: acts, todayISO: TODAY }).forEach(s => {
      // a signal carries a cause and a plain-language caution, nothing else
      expect(Object.keys(s).sort()).toEqual(['caution', 'change', 'key', 'why']);
      expect(/injur|risk|probab|\bscore\b/i.test(s.caution + ' ' + s.why), s.key + ' claims to diagnose').toBe(false);
    });
  });
});

describe('the long run rotates its objective', () => {
  it('every generated long run is classifiable, none falls through', () => {
    // An unnamed long run would under-report the hard share the rule depends
    // on, so 'other' appearing at all is a defect rather than a default.
    const all = [];
    for (const rt of SOLO) for (const fit of LEVELS) for (const d of [3, 5, 7]) all.push(...longsOf(planFor(rt, fit, d)));
    const mix = longRunMix(all);
    expect(mix.total).toBeGreaterThan(700);
    expect(mix.counts.other || 0).toBe(0);
    Object.keys(mix.counts).forEach(k => expect(RUN_LONG_OBJECTIVES[k], k + ' has no description').toBeTruthy());
  });

  it('does not make every long run harder', () => {
    // §4's rule, as a number. The engine sits at 12.5%.
    const all = [];
    for (const rt of SOLO) for (const fit of LEVELS) for (const d of [3, 5, 7]) all.push(...longsOf(planFor(rt, fit, d)));
    const mix = longRunMix(all);
    expect(mix.withinGuidance).toBe(true);
    expect(mix.hardShare).toBeLessThan(MAX_HARD_LONG_SHARE);
    expect(MAX_HARD_LONG_SHARE).toBeLessThan(0.5);
    HARD_LONG_OBJECTIVES.forEach(k => expect(RUN_LONG_OBJECTIVES[k]).toBeTruthy());
  });

  it('every single plan rotates rather than repeating one objective', () => {
    for (const rt of SOLO) {
      for (const fit of LEVELS) {
        const mix = longRunMix(longsOf(planFor(rt, fit, 5)));
        expect(mix.distinct, rt + '/' + fit + ' uses one objective throughout').toBeGreaterThanOrEqual(2);
        expect(mix.withinGuidance, rt + '/' + fit + ' makes too many long runs hard').toBe(true);
      }
    }
  });

  it('the classifier reads the built session rather than re-deciding it', () => {
    // Fixtures built by hand from the SHAPES the builder emits, so the
    // classifier is checked against an independent statement of intent.
    const L = segments => ({ discipline: 'run', type: 'Long', segments });
    expect(runLongObjective(L([{ label: 'Steady aerobic', zone: 'Z2' }]))).toBe('easy-endurance');
    expect(runLongObjective(L([{ label: 'Steady aerobic', zone: 'Z2' }, { label: 'Fast finish', zone: 'Z3' }]))).toBe('fast-finish');
    expect(runLongObjective(L([{ label: '4 × (3 min threshold / 2 min easy) — on tired legs', zone: 'Z4' }]))).toBe('late-run-stability');
    expect(runLongObjective(L([{ label: 'Final 35 min at your marathon effort', zone: 'Z3' }]))).toBe('race-pace');
    // the tired-legs variant also holds hard work, so the most specific
    // intent must win rather than the first match
    expect(runLongObjective(L([
      { label: 'Steady aerobic', zone: 'Z2' },
      { label: '4 × (3 min threshold / 2 min easy) — on tired legs', zone: 'Z4' },
    ]))).toBe('late-run-stability');
    // and it declines anything that is not a long run
    expect(runLongObjective({ discipline: 'run', type: 'Threshold', segments: [] })).toBe(null);
    expect(runLongObjective({ discipline: 'bike', type: 'Long', segments: [] })).toBe(null);
    expect(runLongObjective({ discipline: 'run', type: 'Long', race: true, segments: [] })).toBe(null);
    expect(runLongObjective(null)).toBe(null);
  });

  it('an eased long run keeps being judged as a long run', () => {
    // easeWorkout rewrites the type but records easedFrom; losing the long
    // here would silently drop it out of the hard-share denominator
    expect(runLongObjective({ discipline: 'run', type: 'Easy', easedFrom: 'Long', segments: [{ label: 'Relaxed', zone: 'Z2' }] })).toBe('easy-endurance');
  });
});

describe('the barrel exports the durability module', () => {
  it('run-durability is reachable from the package entry point', async () => {
    const barrel = await import('./index.js');
    ['runVolumeModel', 'runDurabilitySignals', 'runLongObjective', 'longRunMix',
      'RUN_LONG_OBJECTIVES', 'MAX_HARD_LONG_SHARE', 'RUN_VOLUME_RULES']
      .forEach(k => expect(barrel[k], k + ' missing from the barrel').toBeTruthy());
  });
});
