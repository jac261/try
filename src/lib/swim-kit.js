import { SWIM_DRILLS, FOCUS_DRILLS, SWIM_EQUIPMENT } from './swim-drills.js';

/* The swim kit line (phase 6, spec §26 equipment, honest scope): what to
 * bring to the pool, aggregated from the session's own drill segments. The
 * generator flattens each drill's gear into the segment's detail prose, so
 * this is a re-read of information already on the card, gathered into one
 * line at the top instead of buried per segment.
 *
 * The lookup matches segment labels by SUFFIX against the closed drill
 * catalogues: drillSegs builds labels as '<reps> × <length> <drill name>',
 * so `label.endsWith(' ' + name)` identifies the drill deterministically.
 * A coupling test pins that contract; if the label format ever changes,
 * that test fails rather than the kit line quietly emptying.
 *
 * Honest scope, stated here because an omission nobody mentions reads as a
 * decision somebody made: the bike gets no equipment block (the environment
 * card and the power/RPE target mode are the only truthful gear-adjacent
 * facts, and both already render); the run has no equipment data at all. */

export function swimKit(w) {
  if (!w || w.discipline !== 'swim' || !Array.isArray(w.segments)) return null;
  const drills = SWIM_DRILLS.concat(FOCUS_DRILLS);
  const needs = new Set();
  for (const seg of w.segments) {
    const label = seg && seg.label;
    if (typeof label === 'string') {
      const d = drills.find(x => label.endsWith(' ' + x.name));
      if (d) (d.needs || []).forEach(n => needs.add(n));
    }
    // Open-water wetsuit rehearsal is the one non-drill kit item: the skill
    // rides the segment's ow block, and it has no pool equivalent.
    if (seg && seg.ow && (seg.ow.skills || []).includes('wetsuit')) needs.add('wetsuit');
  }
  if (!needs.size) return null;
  // catalog order, so the line reads the same way every time
  const items = SWIM_EQUIPMENT.filter(e => needs.has(e.id)).map(e => e.label);
  return { items };
}
