/* Try — the adaptive engine.
 *
 * Phase 1 (proposeToday): this morning's readiness band → at most ONE proposed
 * change to today's sessions (rules D1-D4). Phase 2 (proposeWeek): the ramp-rate
 * trend → at most ONE week-level proposal (rules R1-R3). Thresholds, rationale
 * and guardrails G1-G5 in docs/ADAPTIVE_ENGINE.md. Pure: takes state, returns a
 * proposal object (or null); the UI renders it and the athlete accepts or
 * ignores. The engine never mutates the plan itself.
 */
import { INTENSITY_TYPES } from './tuning.js';
import { iso, addDays, startOfWeekMonday } from './date.js';
import { wellness as wellnessLib } from './wellness.js';

// A proposal: { kind, workout, headline, why, action }
//   kind: 'ease' | 'restore' | 'move-test'
//   action: what accepting it should invoke ('easeToday' | 'restoreToday' | 'moveTest')
export function proposeToday({ band, score, todays }) {
  if (!band || !Array.isArray(todays) || !todays.length) return null;

  // Guardrails: race day is immutable (G1); completed sessions are history (G4).
  const candidates = todays.filter(w => !w.race && !w.done);
  if (!candidates.length) return null;

  const test = candidates.find(w => w.test);
  const hard = candidates.find(w => INTENSITY_TYPES[w.type] && !w.eased && !w.test);
  const eased = candidates.find(w => w.eased);

  // D4 — red + test day: never soften a test, propose moving it (G2).
  if (band === 'red' && test) {
    return {
      kind: 'move-test', workout: test, action: 'moveTest',
      headline: `Move today's ${test.title}`,
      why: `Readiness ${score} — a fitness test on a red day produces false-low baselines that would mis-target every pace. Move it to your next quality slot.`,
    };
  }

  // D1 — red + hard session: swap to easy aerobic at reduced volume.
  if (band === 'red' && hard) {
    return {
      kind: 'ease', workout: hard, action: 'easeToday',
      headline: `Swap ${hard.title} for easy aerobic`,
      why: `Readiness ${score} — hard work on a suppressed system digs the hole deeper. An easy ${Math.max(25, Math.round(hard.durationMin * 0.65 / 5) * 5)} min aids recovery more than pushing through.`,
    };
  }

  // D2 — amber + hard session: same swap, athlete's call.
  if (band === 'amber' && hard) {
    return {
      kind: 'ease', workout: hard, action: 'easeToday',
      headline: `Ease ${hard.title} → easy aerobic`,
      why: `Readiness ${score} — a little down. Swap for easy aerobic, or ride the planned session with controlled effort; your call.`,
    };
  }

  // D3 — green + a session eased earlier today: offer the hard session back.
  if (band === 'green' && eased) {
    return {
      kind: 'restore', workout: eased, action: 'restoreToday',
      headline: `Restore ${eased.easedFrom || 'the planned session'}`,
      why: `Readiness ${score} — you're recovered. The morning read improved; don't leave training on the table.`,
    };
  }

  return null; // G5: nothing urgent → no proposal
}

/* ---------------- Phase 2 — the ramp guardrail ---------------- */

// Named thresholds (argue with these, not with buried literals). The ramp zones
// they anchor on are RAMP_ZONES in wellness.js: ~+5 CTL/week is the sustainable
// building ceiling, sustained > +8 is injury/illness territory.
export const RAMP_RULES = {
  aggressive: 5,      // R1 trips when BOTH trailing weeks average above this
  risky: 8,           // R2 trips when the trailing week averages above this
  trimAggressive: 0.8, // R1: trim next week to 80% volume
  trimRisky: 0.7,      // R2: trim next week to 70% volume
  minReadings: 3,      // fitness readings per 7-day window before a verdict
  freshDays: 3,        // latest fitness data must be at most this old
};

const fmtRamp = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);

// Mean weekly ramp across the readings in (fromISO, toISO], or null when the
// window is too thin to judge (missing data never triggers an adaptation).
function windowAvg(ramps, fromISO, toISO) {
  const vals = ramps.filter(r => r.date > fromISO && r.date <= toISO).map(r => r.ramp);
  if (vals.length < RAMP_RULES.minReadings) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
}

// Week-level proposal from the CTL ramp trend (rules R1-R3), or null.
//   R2 risky ramp  → { kind:'trim-week', factor:.7, targets, ease } (one quality session eased)
//   R1 aggressive  → { kind:'trim-week', factor:.8, targets, ease:null }
//   R3 stalled     → { kind:'catch-up', action:'catchUp' } (build week, negative ramp, ≥2 missed)
// Guardrails: recovery/taper/race weeks are never trimmed (the relief is already
// scheduled); a week with any adjusted session is not re-proposed (G3).
export function proposeWeek({ wellness, plan, log, moves, adjust, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const today = todayISO || iso(new Date());

  // Freshness: the ramp is a week-scale signal, but stale fitness data (no CTL
  // reading within freshDays) means the sensors are off — stay quiet.
  const withCtl = (wellness || []).filter(r => r.ctl != null);
  const lastCtl = withCtl.length ? withCtl[withCtl.length - 1].date : null;
  const fresh = lastCtl && lastCtl >= iso(addDays(today, -RAMP_RULES.freshDays));
  const ramps = fresh ? wellnessLib.rampHistory(wellness) : [];
  const thisWk = windowAvg(ramps, iso(addDays(today, -7)), today);
  const priorWk = windowAvg(ramps, iso(addDays(today, -14)), iso(addDays(today, -7)));

  const curWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= today))
    || plan.weeks[plan.weeks.length - 1];

  // R1/R2 target NEXT week — this week is already underway.
  const next = plan.weeks[curWeek.index + 1] || null;
  const trimmable = next && !next.isRecovery && next.phase !== 'Taper' && !next.workouts.some(w => w.race)
    ? next.workouts.filter(w => (w.discipline === 'run' || w.discipline === 'bike' || w.discipline === 'swim') && !w.test)
    : [];
  const untouched = trimmable.length > 0 && trimmable.every(w => !(adjust || {})[w.id]);

  // R2 — risky ramp: trim 30% AND take the biggest quality session easy.
  if (thisWk != null && thisWk > RAMP_RULES.risky && untouched) {
    const quality = trimmable.filter(w => INTENSITY_TYPES[w.type])
      .sort((a, b) => b.durationMin - a.durationMin)[0] || null;
    return {
      kind: 'trim-week', action: 'trimWeek', week: next.index,
      factor: RAMP_RULES.trimRisky,
      targets: trimmable.filter(w => !quality || w.id !== quality.id).map(w => w.id),
      ease: quality ? quality.id : null,
      headline: 'Pull back next week',
      why: `Your fitness is climbing ${fmtRamp(thisWk)}/wk — injury and illness odds rise steeply above +${RAMP_RULES.risky}. Trim next week 30%${quality ? ` and take the ${quality.title} easy` : ''} to bank the gains safely.`,
    };
  }

  // R1 — aggressive ramp two weeks running: trim 20% to consolidate.
  if (thisWk != null && priorWk != null && thisWk > RAMP_RULES.aggressive && priorWk > RAMP_RULES.aggressive && untouched) {
    return {
      kind: 'trim-week', action: 'trimWeek', week: next.index,
      factor: RAMP_RULES.trimAggressive,
      targets: trimmable.map(w => w.id), ease: null,
      headline: 'Ease off the ramp',
      why: `Two straight weeks above +${RAMP_RULES.aggressive}/wk fitness ramp (${fmtRamp(priorWk)}, then ${fmtRamp(thisWk)}). Sustainable building tops out around +${RAMP_RULES.aggressive} — trim next week 20% to consolidate.`,
    };
  }

  // R3 — the build has stalled: negative ramp in a Base/Build week with ≥2
  // missed sessions → the existing catch-up redistribution, urgently framed.
  const rampNow = ramps.length ? ramps[ramps.length - 1].ramp : null;
  if (rampNow != null && rampNow < 0 && (curWeek.phase === 'Base' || curWeek.phase === 'Build')) {
    const weekStart = iso(startOfWeekMonday(today));
    const missed = plan.weeks.flatMap(w => w.workouts).filter(w => {
      if (w.discipline === 'rest' || w.race) return false;
      const d = (moves && moves[w.id]) || w.date;
      return d < today && d >= weekStart && !(log || {})[w.id];
    });
    if (missed.length >= 2) {
      return {
        kind: 'catch-up', action: 'catchUp',
        headline: 'Your build has stalled',
        why: `Fitness is drifting down (${fmtRamp(rampNow)}/wk) in a ${curWeek.phase} week with ${missed.length} sessions missed. Reschedule them onto your free days to restart the climb.`,
      };
    }
  }

  return null;
}
