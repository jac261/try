import { describe, it, expect } from 'vitest';
import { athleteState } from './athleteState.js';
import { RUN_RAMP_RULES } from '@/lib/runload.js';

// A load series: n days, ctl/atl ramped linearly from (c0,a0) to (c1,a1).
const loadSeries = (c0, a0, c1, a1, n = 30, derived = false) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 1 : i / (n - 1);
    const ctl = c0 + (c1 - c0) * f, atl = a0 + (a1 - a0) * f;
    out.push({ date: '2026-06-' + String(i + 1).padStart(2, '0'), ctl, atl, tsb: ctl - atl, ...(derived ? { derived: true } : {}) });
  }
  return out;
};
const tileFor = (s, key) => s.tiles.find(t => t.key === key);

describe('athleteState (the strip mapper)', () => {
  it('tiles are word-led: no raw CTL/ATL/TSB values duplicate the charts below', () => {
    const s = athleteState({ wellness: loadSeries(50, 40, 60, 45), runLoad: { acute7d: 40, rampPct: 0.1 } });
    s.tiles.forEach(t => expect(t.value).toBeUndefined());
  });

  it('brand-new athlete: no load, no runs → whole strip hidden', () => {
    const s = athleteState({ wellness: [], runLoad: null, recovery: null });
    expect(s.show).toBe(false);
  });

  it('only run history → strip shows, load tiles empty, run-load populated', () => {
    const s = athleteState({ wellness: [], runLoad: { acute7d: 45, baselineWeekly: 40, rampPct: 0.12 }, recovery: null });
    expect(s.show).toBe(true);
    expect(tileFor(s, 'fitness').empty).toBe(true);
    expect(tileFor(s, 'fatigue').empty).toBe(true);
    expect(tileFor(s, 'recovery').empty).toBe(true);
    const rl = tileFor(s, 'runload');
    expect(rl.empty).toBe(false);
    expect(rl.word).toBe('Steady');
    expect(rl.sub).toBe('45 min · last 7 days'); // the strip's one number
  });

  it('only load history → load tiles populated, run-load empty with its own word', () => {
    const s = athleteState({ wellness: loadSeries(50, 40, 60, 45), runLoad: null, recovery: null });
    expect(s.show).toBe(true);
    expect(tileFor(s, 'fitness').empty).toBe(false);
    const rl = tileFor(s, 'runload');
    expect(rl.empty).toBe(true);
    expect(rl.emptyWord).toBe('Not enough runs yet');
  });

  it('sensor-less parity: derived load reads identically and flips the footnote', () => {
    const measured = athleteState({ wellness: loadSeries(50, 40, 60, 45, 30, false), runLoad: null, recovery: null });
    const derived = athleteState({ wellness: loadSeries(50, 40, 60, 45, 30, true), runLoad: null, recovery: null });
    expect(derived.derived).toBe(true);
    expect(measured.derived).toBe(false);
    expect(tileFor(derived, 'fitness').word).toBe(tileFor(measured, 'fitness').word);
    expect(tileFor(derived, 'recovery').word).toBe(tileFor(measured, 'recovery').word);
  });

  it('fitness trend words track the CTL direction over the window', () => {
    const up = tileFor(athleteState({ wellness: loadSeries(50, 40, 62, 45) }), 'fitness');
    expect(up.word).toBe('Rising'); expect(up.arrow).toBe('▲');
    const down = tileFor(athleteState({ wellness: loadSeries(62, 40, 50, 45) }), 'fitness');
    expect(down.word).toBe('Easing'); expect(down.arrow).toBe('▼');
    const flat = tileFor(athleteState({ wellness: loadSeries(55, 40, 55, 45) }), 'fitness');
    expect(flat.word).toBe('Holding'); expect(flat.arrow).toBe('–');
  });

  it('fatigue reads ATL directly, not through TSB', () => {
    // ctl flat, atl rising: through TSB this would read as recovery falling —
    // the tile must say fatigue is climbing, its own axis.
    const climb = tileFor(athleteState({ wellness: loadSeries(55, 30, 55, 50) }), 'fatigue');
    expect(climb.word).toBe('Climbing'); expect(climb.arrow).toBe('▲');
    const drop = tileFor(athleteState({ wellness: loadSeries(55, 50, 55, 30) }), 'fatigue');
    expect(drop.word).toBe('Dropping');
    const flat = tileFor(athleteState({ wellness: loadSeries(55, 40, 55, 40) }), 'fatigue');
    expect(flat.word).toBe('Steady'); expect(flat.arrow).toBe('–');
  });

  it('recovery word is the form-zone label verbatim, with the zone colour', () => {
    // tsb at end sets the zone: use a flat ctl so tsb == -20 (Optimal).
    const optimal = tileFor(athleteState({ wellness: loadSeries(60, 60, 60, 80) }), 'recovery');
    expect(optimal.word).toBe('Optimal');
    expect(optimal.color).toBe('#34d399');
    const fresh = tileFor(athleteState({ wellness: loadSeries(60, 60, 60, 50) }), 'recovery');
    expect(fresh.word).toBe('Fresh');       // tsb +10
    const risk = tileFor(athleteState({ wellness: loadSeries(60, 60, 60, 95) }), 'recovery');
    expect(risk.word).toBe('High risk');    // tsb -35
  });

  it('recovery enrichment mirrors the readiness card across all four branches', () => {
    const highRisk = loadSeries(60, 60, 60, 95); // tsb -35
    const sub = recovery => tileFor(athleteState({ wellness: highRisk, recovery }), 'recovery').sub;
    expect(sub({ readyDate: 'x', days: 5 })).toBe('recovers in about 5 days');   // 2..7 gets a day count
    expect(sub({ days: 1 })).toBe('clear by tomorrow');
    expect(sub({ readyDate: 'x', days: 12 })).toBe('clears in a week or two');   // 8..14 softened, no false precision
    // beyond-horizon: unbounded floor, keeps "at least" — but NOT the card's
    // "high risk" prefix, which would double the headline word above it
    expect(sub({ readyDate: null, days: null })).toBe('at least another week or two');
    // not high risk → no sub even if a projection is passed
    const optimal = loadSeries(60, 60, 60, 80);
    expect(tileFor(athleteState({ wellness: optimal, recovery: { days: 5 } }), 'recovery').sub).toBe(null);
  });

  it('stopped running reads as "No runs logged", not a reassuring green Steady', () => {
    const t = tileFor(athleteState({ wellness: [], runLoad: { acute7d: 0, baselineWeekly: 60, rampPct: -1 } }), 'runload');
    expect(t.empty).toBe(false);
    expect(t.sub).toBe('0 min · last 7 days');
    expect(t.word).toBe('No runs logged');
    expect(t.color).toBe('var(--muted)');
    // an absolute stopped state is not a trend: no "No runs logged \u25bc"
    expect(t.arrow).toBe(null);
  });

  it('recovery empty when there is no load at all', () => {
    const s = athleteState({ wellness: [], runLoad: { acute7d: 30, rampPct: 0.1 } });
    expect(tileFor(s, 'recovery').empty).toBe(true);
  });

  it('run-load banding sits exactly on the named thresholds', () => {
    const word = rampPct => tileFor(athleteState({ wellness: [], runLoad: { acute7d: 50, rampPct } }), 'runload').word;
    expect(word(RUN_RAMP_RULES.riskPct)).toBe('Ramping hard');          // >= risk
    expect(word(RUN_RAMP_RULES.riskPct - 0.001)).toBe('Building');      // below risk, above build
    expect(word(RUN_RAMP_RULES.buildPct)).toBe('Building');            // >= build
    expect(word(RUN_RAMP_RULES.buildPct - 0.001)).toBe('Steady');      // below build
    expect(word(-0.2)).toBe('Steady');                                 // negative
  });

  it('run-load null guards fall through to the empty state', () => {
    expect(tileFor(athleteState({ wellness: [], runLoad: null }), 'runload').empty).toBe(true);
    expect(tileFor(athleteState({ wellness: loadSeries(50, 40, 60, 45), runLoad: { acute7d: 10, rampPct: null } }), 'runload').empty).toBe(true);
    // rampPct present but no acute7d must not render "undefined min"
    const noMin = tileFor(athleteState({ wellness: loadSeries(50, 40, 60, 45), runLoad: { rampPct: 0.4 } }), 'runload');
    expect(noMin.empty).toBe(true);
    expect(noMin.sub).toBe(null);
  });

  it('a single load reading is too thin to trend: load tiles empty, no strip on its own', () => {
    const one = loadSeries(55, 45, 55, 45, 1); // one row, tsb 10
    // On its own it hides (a lone reading is not a "where you stand").
    expect(athleteState({ wellness: one, runLoad: null }).show).toBe(false);
    // With run history the strip shows; fitness/fatigue stay empty (no trend),
    // recovery reads its zone off the one row.
    const s = athleteState({ wellness: one, runLoad: { acute7d: 30, rampPct: 0.1 } });
    expect(s.show).toBe(true);
    expect(tileFor(s, 'fitness').empty).toBe(true);
    expect(tileFor(s, 'fatigue').empty).toBe(true);
    expect(tileFor(s, 'recovery').empty).toBe(false);
    expect(tileFor(s, 'recovery').word).toBe('Fresh');
  });

  it('each tile carries its support topic', () => {
    const s = athleteState({ wellness: loadSeries(50, 40, 60, 45), runLoad: { acute7d: 40, rampPct: 0.1 } });
    expect(tileFor(s, 'fitness').topic).toBe('fitness-fatigue');
    expect(tileFor(s, 'fatigue').topic).toBe('fitness-fatigue');
    expect(tileFor(s, 'recovery').topic).toBe('form');
    expect(tileFor(s, 'runload').topic).toBe('ramp-rate');
  });
});


describe('athleteState with running excluded (injured state)', () => {
  it('the empty run tile reads paused, not thin data', () => {
    const s = athleteState({ wellness: [], runLoad: null, excludedDiscipline: 'run' });
    // strip may hide entirely with no data at all; force it visible via load history
    const withLoad = athleteState({
      wellness: Array.from({ length: 5 }, (_, i) => ({ date: '2026-07-0' + (i + 1), ctl: 50 + i, atl: 45, tsb: 5 })),
      runLoad: null, excludedDiscipline: 'run',
    });
    expect(tileFor(withLoad, 'runload').emptyWord).toBe('Run paused for now');
  });
  it('a run logged anyway outranks the schedule: normal tile, no paused wording', () => {
    const s = athleteState({ wellness: [], runLoad: { acute7d: 45, baselineWeekly: 40, rampPct: 0.12 }, excludedDiscipline: 'run' });
    const t = tileFor(s, 'runload');
    expect(t.empty).toBe(false);
    expect(t.word).toBe('Steady');
  });
});
