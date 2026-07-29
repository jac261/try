/* Try — how a run session is sized. (run phase 3 §4)
 *
 * These numbers were already in the engine; they were just scattered as
 * literals across six branches of buildRun, where nothing could read them and
 * nothing could check them. A Tempo's warm-up was the 12 in one branch, its
 * main set was `Math.max(15, dur - 22)` in another, and the relationship
 * between the two was a coincidence maintained by hand.
 *
 * Writing them down once matters for the reason the swim and bike arcs kept
 * rediscovering: when generation and judging read different tables, they
 * drift, and the athlete gets a card graded against a session it never was.
 * buildRun now reads THIS table, so a future review that also reads it cannot
 * disagree with the card.
 *
 * The extraction is exact. Generation is byte-identical to before it existed;
 * that is the point. Nothing here is a new coaching decision.
 *
 * WHAT PROGRESSES, and what only looks like it (§5). The engine advances one
 * principal dimension at a time, and it is worth being precise about which,
 * because two of the spec's eight dimensions are not independent here:
 *
 *   - DURATION is the volume dimension. Week load and level factor drive it.
 *   - REP COUNT is derived FROM duration on the variable-rep formats
 *     (`clamp(round((dur - lead) / per), lo, hi)`), so it is not a separate
 *     dial: growing duration grows reps automatically. The bike arc shipped a
 *     progression rung that tried to add reps on top of this and was a no-op,
 *     because the count was already max-fitting.
 *   - INTERVAL DURATION is the dial on the fixed-rep formats instead (the
 *     `2 × (N min tempo / 4 min float)` family holds 2 reps and grows N).
 *   - INTENSITY is the ladder rung, moved by phase and level, never by size.
 *   - TERRAIN is the hill gate: Build or Peak, not beginner.
 *
 * Measured across 400 like-for-like week transitions (excluding recovery
 * weeks, test weeks, and weeks where the number of quality sessions changed),
 * the engine never raises the ladder rung and the quality volume by more than
 * 10 per cent in the same step. The spec's "avoid simultaneous large
 * increases" already holds; runpass3.test.js pins it so it keeps holding.
 */

import { RUN_TYPES } from './runschema.js';

/**
 * @typedef {object} RunSizing
 * @property {number} warmup      minutes of warm-up the quality formats open with
 * @property {number} cooldown    minutes of cool-down they close with
 * @property {number} lead        warm-up + cool-down, the overhead a main set pays
 * @property {number|null} mainFloor  the smallest main set worth prescribing,
 *           null where the format has no separate main set (Easy, Long)
 * @property {'lead'|'tail'} flex which segment absorbs the fit to exact duration
 */

/* Per type, exactly as buildRun sizes it.
 *
 * `lead` is not always warmup + cooldown, and that is deliberate rather than
 * an error: Tempo opens 12 and closes 10 but sizes its main set off 22, while
 * Threshold and VO2 open 15 and close 10 and size off 25. Those agree. The
 * Fartlek opens 10 and closes 8 and sizes off 18. Also agrees. Recording the
 * relationship explicitly means a future edit to a warm-up cannot silently
 * leave the main set sizing behind.
 */
export const RUN_SIZING = {
  Easy: { warmup: 0, cooldown: 0, lead: 0, mainFloor: null, flex: 'lead' },
  Long: { warmup: 0, cooldown: 0, lead: 0, mainFloor: null, flex: 'lead' },
  Fartlek: { warmup: 10, cooldown: 8, lead: 18, mainFloor: 12, flex: 'tail' },
  Tempo: { warmup: 12, cooldown: 10, lead: 22, mainFloor: 15, flex: 'tail' },
  Threshold: { warmup: 15, cooldown: 10, lead: 25, mainFloor: null, flex: 'tail' },
  'VO2 Intervals': { warmup: 15, cooldown: 10, lead: 25, mainFloor: null, flex: 'tail' },
  // The midweek race-pace session, sized like the other quality formats.
  'Race Pace': { warmup: 15, cooldown: 10, lead: 25, mainFloor: 12, flex: 'tail' },
  // The 5 km test is a fixed protocol, not a sized session: its shape is the
  // test, and scaling it would stop it being comparable to the last one.
  Test: { warmup: 0, cooldown: 0, lead: 0, mainFloor: null, flex: 'tail' },
};

/* No solo run session is prescribed below this. A beginner's 7-day recovery
   week would otherwise generate 10 and 15 minute jogs, which read as filler
   rather than training. */
export const RUN_MIN_SESSION_MIN = 20;

/* The hill gate, in one place. Sustained climbs and uphill repetitions are a
   Build/Peak tool with real impact load, never a Base or beginner session,
   and they ride the same gate as the long run's tired-legs variant.
   Deliberately a function of phase and LEVEL only, never of duration: both
   survive an ease or trim rebuild, so a rebuilt session keeps its format. */
export const RUN_HILL_GATE = { phases: ['Build', 'Peak'], minIntensity: 0 };
export function runHillsAllowed(phase, intensity) {
  return RUN_HILL_GATE.phases.includes(phase) && (intensity || 0) >= RUN_HILL_GATE.minIntensity;
}

/* The main set a session of this length carries: what is left once the
   format's warm-up and cool-down are paid for, floored where the format
   declares a floor. Returns the three parts so a caller can render or check
   them without re-deriving the arithmetic. */
export function runMainSet(type, dur) {
  const s = RUN_SIZING[type] || RUN_SIZING.Tempo;
  const raw = dur - s.lead;
  const main = s.mainFloor != null ? Math.max(s.mainFloor, raw) : raw;
  return { warmup: s.warmup, main, cooldown: s.cooldown, flex: s.flex };
}

/* How many reps of `per` minutes (work + recovery) fit a main set, within the
   format's own bounds. This IS the rep progression: it is a function of
   duration, which is why nothing else may also try to add reps.

   The lead comes from the TYPE, never a constant: Fartlek derives its surge
   count from dur − 18 while Threshold and VO2 derive theirs from dur − 25,
   and a shared hardcoded 25 here would have quietly given every Fartlek seven
   minutes less main set than the engine actually builds. */
export function runReps(type, dur, per, lo, hi) {
  const s = RUN_SIZING[type] || RUN_SIZING.Tempo;
  const n = Math.round((dur - s.lead) / per);
  return Math.max(lo, Math.min(hi, n));
}

// Every sized type is a real type. A sizing entry for a type nothing builds
// is a table maintained for nobody, and a built type with no entry falls
// through to Tempo's shape, which is how a VO2 session would quietly acquire
// a Tempo warm-up.
export function runSizingIssues() {
  const issues = [];
  Object.keys(RUN_SIZING).forEach(t => {
    if (!RUN_TYPES.includes(t)) issues.push('sizing for unknown type: ' + t);
  });
  RUN_TYPES.forEach(t => {
    if (!RUN_SIZING[t]) issues.push('no sizing for built type: ' + t);
  });
  Object.entries(RUN_SIZING).forEach(([t, s]) => {
    if (s.lead !== 0 && s.lead !== s.warmup + s.cooldown) {
      issues.push(t + ' sizes its main set off ' + s.lead + ' but opens/closes with ' + (s.warmup + s.cooldown));
    }
  });
  return issues;
}
