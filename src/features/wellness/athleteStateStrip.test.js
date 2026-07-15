import { describe, it, expect } from 'vitest';
import { ariaFor } from './AthleteStateStrip.jsx';
import { athleteState } from './athleteState.js';

// The strip's aria labels are assembled strings, and two bugs shipped through
// them unasserted (a spoken "·" separator, a doubled "high risk"). Every tile
// shape gets its label read here, over REAL mapper output, not hand-built
// tiles — so a mapper contract change breaks these instead of sliding past.
const loadSeries = (c0, a0, c1, a1, n = 30) => Array.from({ length: n }, (_, i) => {
  const f = n === 1 ? 1 : i / (n - 1);
  const ctl = c0 + (c1 - c0) * f, atl = a0 + (a1 - a0) * f;
  return { date: '2026-06-' + String(i + 1).padStart(2, '0'), ctl, atl, tsb: ctl - atl };
});
const tileFor = (s, key) => s.tiles.find(t => t.key === key);

describe('AthleteStateStrip aria labels', () => {
  const full = athleteState({
    wellness: loadSeries(50, 40, 62, 45),
    runLoad: { acute7d: 45, baselineWeekly: 40, rampPct: 0.12 },
    recovery: null,
  });

  it('every live tile label is clean prose: no null, undefined, or spoken "·"', () => {
    full.tiles.forEach(t => {
      const a = ariaFor(t);
      expect(a).not.toMatch(/null|undefined|·/);
      expect(a.endsWith('.')).toBe(true);
    });
  });

  it('fitness and fatigue speak their trend word', () => {
    expect(ariaFor(tileFor(full, 'fitness'))).toBe('Fitness rising. Open the fitness and fatigue explainer.');
    expect(ariaFor(tileFor(full, 'fatigue'))).toBe('Fatigue climbing. Open the fitness and fatigue explainer.');
  });

  it('run load speaks the minutes with a comma where the tile shows a dot', () => {
    expect(ariaFor(tileFor(full, 'runload'))).toBe('Run load steady, 45 min, last 7 days. Open the ramp explainer.');
  });

  it('high-risk recovery with a beyond-horizon projection never doubles "high risk"', () => {
    const s = athleteState({ wellness: loadSeries(60, 60, 60, 95), recovery: { readyDate: null, days: null } });
    const a = ariaFor(tileFor(s, 'recovery'));
    expect(a).toBe('Recovery, high risk, at least another week or two. Open the form explainer.');
    expect(a.match(/high risk/g)).toHaveLength(1);
  });

  it('empty tiles say so', () => {
    const thin = athleteState({ wellness: [], runLoad: { acute7d: 45, rampPct: 0.1 } });
    expect(ariaFor(tileFor(thin, 'fitness'))).toBe('Fitness, not enough data yet.');
    const noRuns = athleteState({ wellness: loadSeries(50, 40, 60, 45), runLoad: null });
    expect(ariaFor(tileFor(noRuns, 'runload'))).toBe('Run load, Not enough runs yet.');
  });
});
