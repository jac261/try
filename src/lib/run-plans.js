/* Try — the standalone run plan's structural contract. (run phase 4)
 *
 * Everything §3 asks for already holds. It holds as EMERGENT behaviour of
 * assignSoloMids, which places the first quality on the earliest available
 * day and the second on the day maximising its minimum distance from both
 * the first quality and any long day. Nothing outside that function could
 * state the rules, and nothing could check them, so a future change to day
 * assignment could quietly break spacing with no test to notice.
 *
 * This writes the contract down and makes it checkable. It is a checker, not
 * a second placer: assignSoloMids stays the only thing that assigns days, so
 * there is one implementation and one set of rules rather than two that can
 * disagree. Generation is untouched.
 *
 * Measured before writing it, across 2,448 solo weeks and 3,474 quality
 * sessions (four distances, four levels, three to seven days, three long-day
 * choices): zero adjacent qualities, zero qualities the day before a long
 * run, zero the day after. The rules below are the ones the engine already
 * keeps.
 *
 * ONE HONEST CAVEAT to that measurement: the swept daysets never contained a
 * geometry where no placement can satisfy both rules (e.g. Tue/Wed/Fri/Sat
 * with the long on Saturday). The shipped tie-break resolved those by
 * placing the second quality adjacent to the long — so this contract's
 * "zero violations" was fixture luck, and the engine's own checker flagged
 * the engine's own output (audit catch 2026-07-29). Resolution: where the
 * athlete's chosen days make spacing impossible, the second quality DEMOTES
 * to an easy run. Spacing outranks density, because "avoid adjacent
 * high-intensity sessions" and "protect the Long Run" are the spec's rules
 * and a session count is not.
 */

import { RUN_QUALITY_TYPES } from './runschema.js';

export const SOLO_SPACING = {
  // Two quality sessions must never sit on consecutive days: the second would
  // be run on the first one's fatigue and neither would be done properly.
  minQualityGapDays: 2,
  // The long run is the week's key session on a solo plan. A quality session
  // the day before arrives on tired legs; one the day after turns a hard
  // weekend into a block the athlete has not earned yet.
  minLongGapDays: 2,
};

const dayNum = w => Math.round(new Date(w.dateISO || w.date) / 864e5);
const isQuality = w => RUN_QUALITY_TYPES.includes(w.type);

/* Spacing problems in one built week, as a list of strings. Empty means the
   week honours the contract. Takes a week object so a caller does not have to
   know how workouts carry their dates.

   Deliberately silent on recovery and race weeks: a recovery week has no
   quality to space, and race week is shaped by the race, not by this rule
   (phase 1b governs it). A caller wanting those checked should say so. */
export function soloWeekSpacingIssues(week) {
  if (!week || !Array.isArray(week.workouts)) return ['not a week'];
  const runs = week.workouts.filter(w => w && w.discipline === 'run' && !w.race);
  const quality = runs.filter(isQuality).map(w => ({ w, d: dayNum(w) })).sort((a, b) => a.d - b.d);
  const longs = runs.filter(w => w.type === 'Long').map(dayNum);
  const issues = [];
  for (let i = 1; i < quality.length; i++) {
    const gap = quality[i].d - quality[i - 1].d;
    if (gap < SOLO_SPACING.minQualityGapDays) {
      issues.push(quality[i - 1].w.type + ' and ' + quality[i].w.type + ' are ' + gap + ' day apart');
    }
  }
  quality.forEach(({ w, d }) => {
    longs.forEach(ld => {
      const gap = Math.abs(d - ld);
      if (gap > 0 && gap < SOLO_SPACING.minLongGapDays) {
        issues.push(w.type + ' sits ' + gap + ' day from the long run');
      }
    });
  });
  return issues;
}

/* The whole plan's structural contract, as a list of strings. This is the
   §2 and §7 checklist in executable form: one long run a week, the stated
   number of runs, no two byte-identical sessions.

   `upTo` excludes race week and anything after it, because both are shaped by
   the race rather than by the weekly template. */
export function soloPlanIssues(plan, daysPerWeek) {
  if (!plan || !Array.isArray(plan.weeks)) return ['not a plan'];
  const issues = [];
  const raceWeek = plan.weeks.findIndex(w => (w.workouts || []).some(x => x.race));
  const upTo = raceWeek < 0 ? plan.weeks.length : raceWeek;
  for (let i = 0; i < upTo; i++) {
    const w = plan.weeks[i];
    const runs = (w.workouts || []).filter(x => x && x.discipline === 'run' && !x.race);
    if (daysPerWeek != null && runs.length !== daysPerWeek) {
      issues.push('wk' + i + ': ' + runs.length + ' runs against ' + daysPerWeek + ' training days');
    }
    const longs = runs.filter(x => x.type === 'Long').length;
    if (longs !== 1) issues.push('wk' + i + ': ' + longs + ' long runs');
    const sigs = runs.map(x => JSON.stringify([x.type, x.durationMin, (x.segments || []).map(s => s.label)]));
    if (new Set(sigs).size !== sigs.length) issues.push('wk' + i + ': duplicate sessions');
    if (!w.isRecovery) soloWeekSpacingIssues(w).forEach(s => issues.push('wk' + i + ': ' + s));
  }
  return issues;
}
