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
import { iso, addDays, startOfWeekMonday, daysBetween } from './date.js';
import { wellness as wellnessLib } from './wellness.js';

// A proposal: { kind, workout, headline, why, action }
//   kind: 'ease' | 'restore' | 'move-test'
//   action: what accepting it should invoke ('easeToday' | 'restoreToday' | 'moveTest')
export function proposeToday({ band, score, todays }) {
  if (!band || !Array.isArray(todays) || !todays.length) return null;

  // Guardrails: race day is immutable (G1); completed sessions are history (G4).
  const candidates = todays.filter(w => !w.race && !w.bRace && !w.done);
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

/* ---------------- Phase 3 — form-aware blocks ---------------- */

// Form (TSB) thresholds anchor on FORM_ZONES in wellness.js: high risk below
// −30, transition (detraining-fresh) above +25, grey −10..+5.
export const FORM_RULES = {
  highRiskDays: 3,     // F1 trips after this many consecutive high-risk readings
  recoveryFactor: 0.6, // F1: convert next week to recovery-depth volume
  greyReadings: 7,     // F2 trips when this many trailing readings sit in grey
  boostFactor: 1.1,    // F2: nudge next week's volume +10%
};

const fmtRamp = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
const fmtTsb = v => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v));

// Mean weekly ramp across the readings in (fromISO, toISO], or null when the
// window is too thin to judge (missing data never triggers an adaptation).
function windowAvg(ramps, fromISO, toISO) {
  const vals = ramps.filter(r => r.date > fromISO && r.date <= toISO).map(r => r.ramp);
  if (vals.length < RAMP_RULES.minReadings) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
}

// Week-level proposal from the ramp trend (R1-R2) and the form trend (F1-F3),
// most urgent first: F1 > R2 > R1 > F3 > F2.
//   F1 sustained high risk → { kind:'trim-week', factor:.6 } (recovery-depth week)
//   R2 risky ramp          → { kind:'trim-week', factor:.7, ease:[quality] }
//   R1 aggressive ×2       → { kind:'trim-week', factor:.8 }
//   F3 transition in build → { kind:'restore-week' }
//   F2 grey all week       → { kind:'boost-week', factor:1.1 }
// Missed sessions are never auto-rescheduled (field decision 2026-07-11: a
// missed session stays missed unless the athlete moves it themselves — the
// old catch-up redistribution stacked sessions onto already-loaded days).
// Guardrails: recovery/taper/race weeks are never adjusted (the relief is
// already scheduled); a week with any adjusted session is not re-proposed (G3).
export function proposeWeek({ wellness, plan, log, moves, adjust, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const today = todayISO || iso(new Date());

  // Freshness: week-scale signals, but stale fitness data (no reading within
  // freshDays) means the sensors are off — stay quiet.
  const withCtl = (wellness || []).filter(r => r.ctl != null);
  const lastCtl = withCtl.length ? withCtl[withCtl.length - 1].date : null;
  const fresh = lastCtl && lastCtl >= iso(addDays(today, -RAMP_RULES.freshDays));
  const ramps = fresh ? wellnessLib.rampHistory(wellness) : [];
  const thisWk = windowAvg(ramps, iso(addDays(today, -7)), today);
  const priorWk = windowAvg(ramps, iso(addDays(today, -14)), iso(addDays(today, -7)));
  const tsbOf = r => (r.tsb != null ? r.tsb : (r.ctl != null && r.atl != null ? r.ctl - r.atl : null));
  const tsbs = fresh ? (wellness || []).map(tsbOf).filter(v => v != null) : [];
  const tsbNow = tsbs.length ? tsbs[tsbs.length - 1] : null;

  const curWeek = plan.weeks.find(w => w.workouts.some(x => x.date >= today))
    || plan.weeks[plan.weeks.length - 1];
  const inBuild = curWeek.phase === 'Base' || curWeek.phase === 'Build';

  // Volume rules target NEXT week — this week is already underway.
  const next = plan.weeks[curWeek.index + 1] || null;
  const trimmable = next && !next.isRecovery && next.phase !== 'Taper' && !next.workouts.some(w => w.race)
    ? next.workouts.filter(w => (w.discipline === 'run' || w.discipline === 'bike' || w.discipline === 'swim') && !w.test && !w.bRace)
    : [];
  const untouched = trimmable.length > 0 && trimmable.every(w => !(adjust || {})[w.id]);
  const quality = trimmable.filter(w => INTENSITY_TYPES[w.type])
    .sort((a, b) => b.durationMin - a.durationMin);
  const missed = plan.weeks.flatMap(w => w.workouts).filter(w => {
    if (w.discipline === 'rest' || w.race) return false;
    const d = (moves && moves[w.id]) || w.date;
    return d < today && d >= iso(startOfWeekMonday(today)) && !(log || {})[w.id];
  });

  // F1 — form in high risk for highRiskDays straight: convert next week to a
  // recovery week (recovery-depth volume, every quality session taken easy).
  // "Pull the recovery week forward", implemented through the same overlay.
  const highRiskRun = (() => {
    let n = 0;
    for (let i = tsbs.length - 1; i >= 0 && tsbs[i] < -30; i--) n++;
    return n;
  })();
  if (highRiskRun >= FORM_RULES.highRiskDays && untouched) {
    return {
      kind: 'trim-week', action: 'trimWeek', week: next.index,
      factor: FORM_RULES.recoveryFactor,
      targets: trimmable.filter(w => !INTENSITY_TYPES[w.type]).map(w => w.id),
      ease: quality.map(w => w.id),
      headline: 'Take a recovery week now',
      why: `Form has sat in high risk (below −30) for ${highRiskRun} days. Digging deeper invites illness and injury. Convert next week to recovery volume and come back up stronger.`,
    };
  }

  // R2 — risky ramp: trim 30% AND take the biggest quality session easy.
  if (thisWk != null && thisWk > RAMP_RULES.risky && untouched) {
    const q = quality[0] || null;
    return {
      kind: 'trim-week', action: 'trimWeek', week: next.index,
      factor: RAMP_RULES.trimRisky,
      targets: trimmable.filter(w => !q || w.id !== q.id).map(w => w.id),
      ease: q ? [q.id] : [],
      headline: 'Pull back next week',
      why: `Your fitness is climbing ${fmtRamp(thisWk)}/wk — injury and illness odds rise steeply above +${RAMP_RULES.risky}. Trim next week 30%${q ? ` and take the ${q.title} easy` : ''} to bank the gains safely.`,
    };
  }

  // R1 — aggressive ramp two weeks running: trim 20% to consolidate.
  if (thisWk != null && priorWk != null && thisWk > RAMP_RULES.aggressive && priorWk > RAMP_RULES.aggressive && untouched) {
    return {
      kind: 'trim-week', action: 'trimWeek', week: next.index,
      factor: RAMP_RULES.trimAggressive,
      targets: trimmable.map(w => w.id), ease: [],
      headline: 'Ease off the ramp',
      why: `Two straight weeks above +${RAMP_RULES.aggressive}/wk fitness ramp (${fmtRamp(priorWk)}, then ${fmtRamp(thisWk)}). Sustainable building tops out around +${RAMP_RULES.aggressive} — trim next week 20% to consolidate.`,
    };
  }

  // F3 — form in transition mid-Base/Build: fitness is leaking. Restore any
  // engine-adjusted upcoming sessions; with nothing to restore, stay quiet
  // (missed volume is the athlete's to reschedule, never the engine's).
  if (tsbNow != null && tsbNow > 25 && inBuild) {
    const byId = new Map(plan.weeks.flatMap(w => w.workouts).map(w => [w.id, w]));
    const restorable = Object.keys(adjust || {}).filter(id => {
      const w = byId.get(id);
      return w && ((moves && moves[id]) || w.date) >= today && !(log || {})[id];
    });
    if (restorable.length) {
      return {
        kind: 'restore-week', action: 'restoreWeek', targets: restorable,
        headline: 'Restore your full sessions',
        why: `Form ${fmtTsb(tsbNow)} is transition territory: so fresh that fitness is leaking. You're recovered enough to absorb the full planned load again.`,
      };
    }
  }

  // F2 — form stuck in the grey zone for a full week of Build with nothing
  // missed: the plan itself is too light to drive adaptation → nudge +10%.
  const greyWindow = tsbs.slice(-FORM_RULES.greyReadings);
  if (inBuild && !missed.length && untouched
    && greyWindow.length >= FORM_RULES.greyReadings
    && greyWindow.every(v => v >= -10 && v < 5)) {
    return {
      kind: 'boost-week', action: 'boostWeek', week: next.index,
      factor: FORM_RULES.boostFactor,
      targets: trimmable.map(w => w.id), ease: [],
      headline: 'Room to build',
      why: `Form has sat in the grey zone all week: recovered, but the load isn't quite enough to drive adaptation. Nudge next week's volume up 10%.`,
    };
  }

  return null;
}

/* ---------------- Phase 4 — race-day form targeting ---------------- */

export const RACE_RULES = {
  freshLo: 5, freshHi: 25, // arrive on race morning inside the Fresh band
  horizonDays: 14,         // steer only inside the final two weeks
  trimFactor: 0.6,         // arriving heavy: shorten sessions, keep their intensity
  boostFactor: 1.15,       // arriving flat: a touch more volume, early in the taper
};

// Rough per-type intensity factors for estimating a session's training load:
// TSS ≈ hours × IF² × 100. Estimates only — the projection needs the shape of
// the taper, not watt-accurate numbers.
const TYPE_IF = {
  'Easy': 0.65, 'Recovery': 0.6, 'Endurance': 0.7, 'Technique': 0.6, 'Long': 0.72,
  'Fartlek': 0.78, 'Tempo': 0.85, 'Sweet Spot': 0.9, 'Threshold': 0.95, 'VO2 Intervals': 1.05,
  'CSS Intervals': 0.95, 'Race Pace': 0.95, 'Open Water': 0.75, 'Brick': 0.8,
  'Strength': 0.5, 'Test': 0.9, 'RACE': 0.95,
};
const DEFAULT_IF = 0.7;

export function estimateTss(w, adj, actualMin) {
  let dur = w.durationMin || 0;
  let type = w.type;
  if (adj) {
    if (adj.kind === 'ease') { dur *= 0.65; type = 'Easy'; }
    else if (adj.factor) dur *= adj.factor;
  }
  // A recorded moving time beats any planned/adjusted duration — it's what
  // actually happened. The type (and an ease's intensity change) still applies.
  if (actualMin != null) dur = actualMin;
  const f = TYPE_IF[type] != null ? TYPE_IF[type] : DEFAULT_IF;
  return (dur / 60) * f * f * 100;
}

// Project race-morning form: walk each day from the last fitness reading to the
// day before the race with the standard impulse-response model
// (CTL' = CTL + (TSS − CTL)/42, ATL' = ATL + (TSS − ATL)/7), feeding it the
// planned sessions on their effective dates with the adjustment overlay applied.
// Returns { tsb, raceDate, daysToRace } or null (no race / no data / stale data).
export function projectRaceForm({ wellness, plan, log, moves, adjust, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const today = todayISO || iso(new Date());
  const race = plan.weeks.flatMap(w => w.workouts).find(w => w.race);
  if (!race) return null;
  const raceDate = (moves && moves[race.id]) || race.date;
  if (raceDate <= today) return null;
  const recs = (wellness || []).filter(r => r.ctl != null && r.atl != null);
  if (!recs.length) return null;
  const last = recs[recs.length - 1];
  if (last.date < iso(addDays(today, -RAMP_RULES.freshDays))) return null; // stale sensors

  const byDate = {};
  plan.weeks.flatMap(w => w.workouts).forEach(w => {
    if (w.race || w.discipline === 'rest' || (log || {})[w.id]) return;
    const d = (moves && moves[w.id]) || w.date;
    if (d > last.date && d < raceDate) (byDate[d] = byDate[d] || []).push(w);
  });

  let ctl = last.ctl, atl = last.atl;
  for (let d = iso(addDays(last.date, 1)); d < raceDate; d = iso(addDays(d, 1))) {
    const tss = (byDate[d] || []).reduce((s, w) => s + estimateTss(w, (adjust || {})[w.id]), 0);
    ctl += (tss - ctl) / 42;
    atl += (tss - atl) / 7;
  }
  return { tsb: Math.round((ctl - atl) * 10) / 10, raceDate, daysToRace: daysBetween(today, raceDate) };
}

// Race-level proposal: inside the final horizonDays, if projected race-morning
// form misses the Fresh window, steer the taper — arriving heavy trims the
// sessions closest to the race (volume down, intensity kept: standard taper
// practice); arriving flat adds volume where it hurts freshness least, at the
// far end of the taper. Sessions are added to the plan one at a time, re-running
// the projection, until it lands (or every candidate is used: best effort).
export function proposeRace({ wellness, plan, log, moves, adjust, todayISO }) {
  if (plan && plan.race === 'maintenance') return null; // no race day to peak for
  const today = todayISO || iso(new Date());
  const proj = projectRaceForm({ wellness, plan, log, moves, adjust, todayISO: today });
  if (!proj || proj.daysToRace > RACE_RULES.horizonDays) return null;
  if (proj.tsb >= RACE_RULES.freshLo && proj.tsb <= RACE_RULES.freshHi) return null;

  const heavy = proj.tsb < RACE_RULES.freshLo;
  const eff = w => (moves && moves[w.id]) || w.date;
  const cands = plan.weeks.flatMap(w => w.workouts).filter(w => {
    if (w.race || w.bRace || w.test || (log || {})[w.id] || (adjust || {})[w.id]) return false;
    if (w.discipline !== 'run' && w.discipline !== 'bike' && w.discipline !== 'swim') return false;
    return eff(w) > today && eff(w) < proj.raceDate;
  }).sort((a, b) => (heavy ? (eff(a) < eff(b) ? 1 : -1) : (eff(a) < eff(b) ? -1 : 1)));
  if (!cands.length) return null;

  const kind = heavy ? 'trim' : 'boost';
  const factor = heavy ? RACE_RULES.trimFactor : RACE_RULES.boostFactor;
  const chosen = [];
  let landed = proj.tsb;
  for (const c of cands) {
    chosen.push(c);
    const overlay = { ...(adjust || {}) };
    chosen.forEach(w => { overlay[w.id] = { kind, factor }; });
    landed = projectRaceForm({ wellness, plan, log, moves, adjust: overlay, todayISO: today }).tsb;
    if (heavy ? landed >= RACE_RULES.freshLo : landed <= RACE_RULES.freshHi) break;
  }

  const n = chosen.length === 1 ? 'session' : chosen.length + ' sessions';
  if (heavy) return {
    kind: 'trim-week', action: 'trimWeek', factor,
    targets: chosen.map(w => w.id), ease: [],
    headline: 'Protect your race freshness',
    why: `Projected race-morning form is ${fmtTsb(proj.tsb)}, below the +${RACE_RULES.freshLo} fresh window. Lighten your final ${n} (shorter, same intensity): projected form improves to ${fmtTsb(landed)}.`,
  };
  return {
    kind: 'boost-week', action: 'boostWeek', factor,
    targets: chosen.map(w => w.id), ease: [],
    headline: 'Too fresh for race day',
    why: `Projected race-morning form is ${fmtTsb(proj.tsb)}, past the +${RACE_RULES.freshHi} ceiling where fitness leaks. A touch more volume early in the taper brings you to ${fmtTsb(landed)} with the same freshness and more fitness.`,
  };
}

/* ---------------- Recovery timeline ---------------- */

// Beyond two weeks a session-by-session projection is fiction — the same
// honest reach as the race-form horizon.
export const RECOVERY_RULES = { horizonDays: 14 };

// When form sits in the high-risk zone: walk the plan AS SCHEDULED (accepted
// adjustments included — accepting a trim visibly shortens the date) and
// report the first day projected form climbs out of high risk and STAYS out
// for the rest of the horizon, so a Thursday that dips back under Saturday's
// big session is never reported. Silent (null) when: no plan, no or stale
// fitness data, not currently in high risk, or a race inside the horizon
// (projectRaceForm owns that airspace). readyDate null = still in high risk
// at the horizon — day 15 simply wasn't looked at.
export function projectRecovery({ wellness, plan, log, moves, adjust, todayISO }) {
  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) return null;
  const today = todayISO || iso(new Date());
  const recs = (wellness || []).filter(r => r.ctl != null && r.atl != null);
  if (!recs.length) return null;
  const seed = recs[recs.length - 1];
  if (seed.date < iso(addDays(today, -RAMP_RULES.freshDays))) return null;
  if (seed.date > today) return null; // a future-dated record (account-timezone skew) can't seed an honest projection
  const zone = wellnessLib.formZone(seed.ctl - seed.atl);
  if (!zone || zone.key !== 'highRisk') return null;
  const horizon = iso(addDays(today, RECOVERY_RULES.horizonDays));
  const all = plan.weeks.flatMap(w => w.workouts);
  const eff = w => (moves && moves[w.id]) || w.date;
  // Race airspace covers today and the seed-to-today gap too: a race the model
  // can't load must silence the sentence, not read as a rest day.
  if (all.some(w => w.race && eff(w) > seed.date && eff(w) <= horizon)) return null;

  // Sessions the walk must charge: future days take unlogged planned sessions;
  // the seed-to-today gap takes what was actually DONE (with recorded moving
  // time when a recording matched) — treating a logged 4 h ride as rest was
  // the gauntlet's optimistic-bias finding.
  const byDate = {};
  all.forEach(w => {
    if (w.race || w.discipline === 'rest') return;
    const d = eff(w);
    if (d <= seed.date || d > horizon) return;
    const entry = (log || {})[w.id];
    if (d <= today ? entry && entry.done : !entry) {
      (byDate[d] = byDate[d] || []).push({ w, actualMin: entry ? entry.actualMin : undefined });
    }
  });

  let ctl = seed.ctl, atl = seed.atl;
  let lastRisk = null; // the last projected in-horizon day still in high risk
  for (let d = iso(addDays(seed.date, 1)); d <= horizon; d = iso(addDays(d, 1))) {
    const tss = (byDate[d] || []).reduce((s, x) => s + estimateTss(x.w, (adjust || {})[x.w.id], x.actualMin), 0);
    ctl += (tss - ctl) / 42;
    atl += (tss - atl) / 7;
    const z = wellnessLib.formZone(ctl - atl);
    if (d > today && z && z.key === 'highRisk') lastRisk = d;
  }
  if (lastRisk === null) return { readyDate: iso(addDays(today, 1)), days: 1 };
  const readyDate = iso(addDays(lastRisk, 1));
  if (readyDate > horizon) return { readyDate: null, days: null };
  return { readyDate, days: daysBetween(today, readyDate) };
}
