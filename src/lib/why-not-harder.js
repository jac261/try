import { RACES } from './domain.js';
import { DISCIPLINES } from './disciplines.js';

/* "Why not harder?" (phase 6, spec §7.7): the fold under a workout's why
 * card answering the athlete who feels good and wonders why the session is
 * not bigger. A pure READ over the workout and its plan week — every line
 * states only what the generator actually encodes, and the branches that
 * cannot be proven at render time simply do not exist here.
 *
 * NAMED NON-CLAIMS, each with its reason:
 *  - no ramp or readiness reasoning: those are reactive proposals computed
 *    from wellness history, not properties of a workout;
 *  - no numeric next-rung ("the step up would be Threshold"): the intensity
 *    ladder is private to the generator, and re-deriving it here would rot;
 *  - no adjacent-quality demotion fact: the generator leaves no flag when it
 *    demotes a would-be-adjacent quality slot, so render code cannot see it;
 *  - no day or adjacency claims of any kind: this sheet does not receive
 *    moves, so a sibling's effective day is unknowable here (the lesson the
 *    Today briefing's gauntlet taught stands);
 *  - the second-quality and spacing lines are SOLO-RUN-ONLY: the adjacent
 *    rung rule fires only when race.solo (plan.js occ gate) and can step
 *    either direction when the anchor clamps, so the copy is direction
 *    neutral; triathlon templates enforce no spacing rule at all, and a
 *    spacing sentence on a tri plan would be false.
 */

// The week's harder work, named from each sibling's own flags so no shared
// phrase can be wrong per discipline.
const siblingLabel = s => {
  if (s.discipline === 'brick') return 'the brick session';
  const noun = s.discipline === 'bike' ? 'ride' : s.discipline === 'run' ? 'run' : 'swim';
  if (s.role === 'long') return 'the long ' + noun;
  const d = ((DISCIPLINES[s.discipline] || {}).name || s.discipline).toLowerCase();
  return 'the quality ' + d;
};

const joinList = xs => xs.length <= 1 ? (xs[0] || '')
  : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

export function whyNotHarder({ workout: w, plan }) {
  if (!w || !plan || !Array.isArray(plan.weeks)) return null;
  if (w.race || w.bRace || w.test || w.adhoc || w.custom) return null;
  if (w.week == null || !plan.weeks[w.week]) return null;
  const week = plan.weeks[w.week];
  const siblings = (week.workouts || []).filter(s => s.id !== w.id && s.discipline !== 'rest' && !s.race);
  const solo = (RACES[plan.race] || {}).solo || null;
  const lines = [];

  if (week.isRecovery) {
    lines.push('This is a recovery week. The plan swaps the hard sessions for easy ones and cuts the week\'s volume on purpose, so the work of the last few weeks can sink in.');
  }

  if (w.raceWeek === 'sharpen' && w.raceWeekFrom) {
    lines.push('There is a race this week, and this session was drawn up as a ' + w.raceWeekFrom + ' session before the plan eased it. Arriving sharp beats arriving tired.');
  } else if (w.raceWeek === 'recover' && w.raceWeekFrom) {
    lines.push('This sits in the days after your race. It was drawn up as a ' + w.raceWeekFrom + ' session before the plan eased it: absorbing a race is training too.');
  }

  if (solo === 'run' && w.role === 'quality') {
    const qualityRuns = [w, ...siblings].filter(s => s.discipline === 'run' && s.role === 'quality');
    if (qualityRuns.length >= 2) {
      lines.push('This week carries two quality runs, and the plan keeps them a step apart in intensity on purpose. Two honest quality sessions beat two compromised ones.');
    }
  }

  if (solo === 'run' && (w.role === 'quality' || w.role === 'long')) {
    lines.push('On a run-only plan the hard sessions are never scheduled on back-to-back days, and never right beside the long run. Space is what lets the hard days actually be hard.');
  }

  if (w.role === 'easy') {
    const harder = siblings.filter(s => s.role === 'quality' || s.role === 'long' || s.discipline === 'brick');
    if (harder.length) {
      // deduped: two quality swims must read as one list entry, not a stutter
      const labels = [...new Set(harder.map(siblingLabel))];
      lines.push('This slot is an easy one by design. The week\'s harder work sits in ' + joinList(labels) + ', and this session is not asked to compete with it.');
    }
  }

  if (!lines.length) return null;
  return { lines: lines.slice(0, 2) };
}
