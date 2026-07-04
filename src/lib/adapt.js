/* Try — the adaptive engine, Phase 1: readiness-driven days.
 *
 * Turns this morning's readiness band into at most ONE proposed change to
 * today's sessions (rules D1-D4 + guardrails G1-G5 — thresholds and rationale
 * in docs/ADAPTIVE_ENGINE.md). Pure: takes state, returns a proposal object
 * (or null); the UI renders it and the athlete accepts or ignores. The engine
 * never mutates the plan itself.
 */
import { INTENSITY_TYPES } from './tuning.js';

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
