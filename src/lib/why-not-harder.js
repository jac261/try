import { RACES } from './domain.js';
import { DISCIPLINES } from './disciplines.js';
import { RUN_QUALITY_TYPES } from './runschema.js';

/* "Why not harder?" (phase 6, spec §7.7): the fold under a workout's why
 * card answering the athlete who feels good and wonders why the session is
 * not bigger. A pure READ over the workout and its plan week — every line
 * states only what the generator actually encodes, and the branches that
 * cannot be proven at render time simply do not exist here.
 *
 * THE ONE FACT THIS MODULE LIVES BY (gauntlet 2026-08-01): a workout's ROLE
 * survives every type demotion — recovery weeks, readiness eases, race-week
 * rebuilds and the solo adjacent-rung step-down all change TYPE while role
 * stays 'quality'. Any sentence keyed on role therefore lies exactly where
 * the engine softened the week, so every claim below reads the CURRENT type
 * against the engine's own type vocabulary, an eased or trimmed session
 * returns null outright (the ease note above the fold IS the true answer),
 * and a recovery week says only its own line (the collapse makes every
 * other structural claim false that week).
 *
 * NAMED NON-CLAIMS, each with its reason:
 *  - no ramp or readiness reasoning: those are reactive proposals computed
 *    from wellness history, not properties of a workout;
 *  - no numeric next-rung ("the step up would be Threshold"): the intensity
 *    ladder is private to the generator, and re-deriving it here would rot;
 *  - no adjacent-quality demotion fact: the generator leaves no flag when it
 *    demotes a would-be-adjacent quality slot, so render code cannot see it;
 *  - no day or adjacency claims of any kind: this sheet does not receive
 *    moves, so a sibling's effective day is unknowable here — and no
 *    spacing sentence either, because the generator only spacing-enforces
 *    the SECOND solo quality placement within its week; the first can land
 *    beside the long run and weeks can abut across their boundary, so any
 *    "never back-to-back" universal is false in generated output
 *    (gauntlet 2026-08-01). */

// The type collapse the generator applies wherever it softens a slot
// (plan.js typeFor recovery branch): a session wearing one of these is
// easy-intensity today whatever its role says.
const SOFT_TYPES = ['Easy', 'Endurance', 'Technique'];

// A run whose CURRENT type the engine itself counts as quality work.
const isQualityRun = s => s.discipline === 'run' && !s.test && RUN_QUALITY_TYPES.includes(s.type);

// The week's harder work, named from each sibling's own flags so no shared
// phrase can be wrong per discipline.
const siblingLabel = s => {
  const noun = s.discipline === 'bike' ? 'ride' : s.discipline === 'run' ? 'run' : 'swim';
  if (s.discipline === 'brick') return 'the brick session';
  if (s.role === 'long') return 'the long ' + noun;
  return 'the quality ' + noun;
};

const joinList = xs => xs.length <= 1 ? (xs[0] || '')
  : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

export function whyNotHarder({ workout: w, plan }) {
  if (!w || !plan || !Array.isArray(plan.weeks)) return null;
  if (w.race || w.bRace || w.test || w.adhoc || w.custom) return null;
  // An eased or trimmed session's true "why not harder" is the ease itself,
  // and the sheet already says so right above this fold. A plan-structure
  // answer here would explain a session the engine just replaced.
  if (w.eased || w.trimmed) return null;
  if (w.week == null || !plan.weeks[w.week]) return null;
  const week = plan.weeks[w.week];

  // Recovery weeks collapse every quality type to easy while roles survive,
  // so the recovery line is the ONLY structurally true sentence this week.
  if (week.isRecovery) {
    return { lines: ['This is a recovery week. The plan swaps the hard sessions for easy ones and cuts the week\'s volume on purpose, so the work of the last few weeks can sink in.'] };
  }

  const siblings = (week.workouts || []).filter(s => s.id !== w.id && s.discipline !== 'rest' && !s.race);
  const solo = (RACES[plan.race] || {}).solo || null;
  const lines = [];

  if (w.raceWeek === 'sharpen' && w.raceWeekFrom) {
    lines.push('There is a race this week, and this session was drawn up as a ' + w.raceWeekFrom + ' session before the plan eased it. Arriving sharp beats arriving tired.');
  } else if (w.raceWeek === 'recover' && w.raceWeekFrom) {
    lines.push('This sits in the days after your race. It was drawn up as a ' + w.raceWeekFrom + ' session before the plan eased it: absorbing a race is training too.');
  }

  // Two quality runs a step apart: counted by CURRENT type against the
  // engine's own quality vocabulary, and only when the viewed session is
  // one of them — a quality-role slot the ladder stepped down to Easy is
  // not a quality run, and telling its athlete otherwise was the exact
  // failure this module's header now warns about.
  if (solo === 'run' && isQualityRun(w)) {
    const qualityRuns = [w, ...siblings].filter(isQualityRun);
    if (qualityRuns.length >= 2) {
      lines.push('This week carries two quality runs, and the plan keeps them a step apart in intensity on purpose. Two honest quality sessions beat two compromised ones.');
    }
  }

  if (w.role === 'easy' && !w.raceWeek) {
    // "Harder" is judged by what the sibling IS today: longs and bricks by
    // role, quality slots only when their current type is not one of the
    // engine's soft collapses.
    const harder = siblings.filter(s => s.role === 'long' || s.discipline === 'brick'
      || (s.role === 'quality' && !s.test && !SOFT_TYPES.includes(s.type)));
    if (harder.length) {
      // deduped: two quality swims must read as one list entry, not a stutter
      const labels = [...new Set(harder.map(siblingLabel))];
      lines.push('This slot is an easy one by design. The week\'s harder work sits in ' + joinList(labels) + ', and this session is not asked to compete with it.');
    }
  }

  if (!lines.length) return null;
  return { lines: lines.slice(0, 2) };
}
