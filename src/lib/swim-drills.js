/* Try — phase 5: the drill catalogue and how a session picks from it.
 *
 * The catalogue moved here from plan.js and gained structured coaching
 * metadata (focus, equipment, difficulty, progression group, purpose). The
 * entries themselves, their ORDER, their cues and their level gates are
 * untouched: pickDrills indexes into a filtered slice of this array, so a
 * reorder or an insertion would change what every existing athlete is
 * prescribed. Order is load-bearing, not cosmetic.
 *
 * Selection responds to the athlete's own settings and to nothing else:
 * with no focus and no declared kit, every athlete gets byte-identical
 * sessions to before this phase. That is the contract the whole swim
 * build-out has held, and it is what makes this safe to ship.
 */

// What a drill can actually work on. These are the areas a drill selection
// can honestly address; the model claims nothing about stroke mechanics it
// cannot see (spec: no stroke-analysis claims without stroke data).
export const TECHNIQUE_FOCUS = [
  { id: 'body-position', label: 'Body position', hint: 'Hips and legs riding high' },
  { id: 'catch', label: 'Catch', hint: 'Holding water at the front of the stroke' },
  { id: 'rotation', label: 'Rotation', hint: 'Swimming on your side, not flat' },
  { id: 'breathing', label: 'Breathing', hint: 'Getting air without losing the stroke' },
  { id: 'kick', label: 'Kick', hint: 'A steady kick that helps rather than costs' },
  { id: 'timing', label: 'Timing', hint: 'Coordinating the arms and the breath' },
  { id: 'sighting', label: 'Sighting', hint: 'Swimming straight in open water' },
];

// Kit a drill can ask for. Wetsuit is in the athlete's list because open
// water asks for it, though no pool drill requires one.
export const SWIM_EQUIPMENT = [
  { id: 'pull-buoy', label: 'Pull buoy' },
  { id: 'fins', label: 'Fins' },
  { id: 'paddles', label: 'Paddles' },
  { id: 'snorkel', label: 'Snorkel' },
  { id: 'kickboard', label: 'Kickboard' },
  { id: 'band', label: 'Band' },
  { id: 'wetsuit', label: 'Wetsuit' },
];

/* The catalogue. name/cue/gear/level are EXACTLY as they were in plan.js,
   in the same order. Everything else is new metadata: focus for selection,
   needs for the kit filter (derived from gear, never contradicting it),
   difficulty and group for ordering within a focus, purpose for the card. */
export const SWIM_DRILLS = [
  {
    name: 'Catch-up', cue: 'one arm waits for the other, long body line', level: -1,
    focus: ['timing', 'body-position'], needs: [], difficulty: 1, group: 'timing',
    purpose: 'builds a long, patient stroke and a steady body line',
  },
  {
    name: 'Single-arm', cue: 'off arm by your side, rotate to breathe', level: -1,
    focus: ['rotation', 'breathing'], needs: [], difficulty: 2, group: 'rotation',
    purpose: 'isolates one arm so rotation and breathing can be felt separately',
  },
  {
    name: 'Scull', cue: 'slow figure-eights, feel the water on your palms', level: -1,
    focus: ['catch'], needs: [], difficulty: 1, group: 'catch',
    purpose: 'teaches your hands to find and hold pressure on the water',
  },
  {
    name: 'Fingertip drag', cue: 'trail your fingertips forward, high elbow', level: -1,
    focus: ['rotation', 'catch'], needs: [], difficulty: 1, group: 'recovery-arm',
    purpose: 'encourages a high elbow and a relaxed arm recovery',
  },
  {
    name: 'Kick on side', cue: 'bottom arm extended, steady relaxed kick', level: -1,
    focus: ['body-position', 'kick', 'rotation'], needs: [], difficulty: 1, group: 'body-position',
    purpose: 'balances you on your side, where most of the stroke happens',
  },
  {
    name: 'Backstroke lengths', cue: 'easy backstroke, open the shoulders and reset', level: -1,
    focus: ['body-position'], needs: [], difficulty: 1, group: 'reset',
    purpose: 'opens the shoulders and resets posture between efforts',
  },
  {
    name: 'Fist', cue: 'closed fists, press the water with your forearm', level: 0,
    focus: ['catch'], needs: [], difficulty: 3, group: 'catch',
    purpose: 'makes the forearm do the work so the catch stops slipping',
  },
  {
    name: '6-1-6', cue: 'six kicks on your side, one stroke, six more', level: 0,
    focus: ['rotation', 'body-position', 'kick'], needs: [], difficulty: 3, group: 'body-position',
    purpose: 'links a balanced side position to a controlled rotation',
  },
  {
    name: 'Doggy paddle', cue: 'head up, pull straight back under your body', level: 0,
    focus: ['catch', 'timing'], needs: [], difficulty: 2, group: 'catch',
    purpose: 'shortens the stroke so the underwater path can be felt',
  },
  {
    name: 'Pull buoy swim', cue: 'buoy between thighs, hips high, long strokes', gear: 'pull buoy', level: 0,
    focus: ['body-position', 'catch'], needs: ['pull-buoy'], difficulty: 2, group: 'body-position',
    purpose: 'holds the hips high so the arms can be worked on alone',
  },
  {
    name: 'Paddle pull', cue: 'firm catch, no slipping through the water', gear: 'paddles and pull buoy', level: 1,
    focus: ['catch'], needs: ['paddles', 'pull-buoy'], difficulty: 4, group: 'catch',
    purpose: 'loads the catch so a weak hold becomes obvious',
  },
  {
    name: 'Snorkel swim', cue: 'head perfectly still, balanced stroke both sides', gear: 'centre snorkel', level: 1,
    focus: ['body-position', 'timing'], needs: ['snorkel'], difficulty: 3, group: 'body-position',
    purpose: 'takes breathing out of the stroke so everything else can settle',
  },
];

/* Drills that only exist once the athlete says what they are working on.
   They cannot join the default pool: pickDrills indexes modulo the pool
   size, so adding an entry for everyone would re-deal every athlete's
   sessions. An athlete who has declared a focus is already getting a
   deliberately different selection, so this is where new coaching can
   safely live — including the sighting work a pool catalogue never had. */
export const FOCUS_DRILLS = [
  {
    name: 'Sighting freestyle', cue: 'eyes up every few strokes, hips stay high', level: -1,
    focus: ['sighting'], needs: [], difficulty: 2, group: 'sighting',
    purpose: 'rehearses looking up for a buoy without stalling the stroke',
  },
  {
    name: 'Sight and turn', cue: 'sight, breathe to the side, straight back down', level: 0,
    focus: ['sighting', 'breathing'], needs: [], difficulty: 3, group: 'sighting',
    purpose: 'joins sighting to the breath so open water costs less rhythm',
  },
  {
    name: 'Vertical kick', cue: 'upright in deep water, small fast kick', level: 0,
    focus: ['kick'], needs: [], difficulty: 3, group: 'kick',
    purpose: 'builds a kick that holds you up instead of dragging behind',
  },
  {
    name: 'Kickboard lengths', cue: 'flat board, kick from the hip, ankles loose', gear: 'kickboard', level: -1,
    focus: ['kick'], needs: ['kickboard'], difficulty: 1, group: 'kick',
    purpose: 'isolates the legs so the kick can be worked without the arms',
  },
  {
    name: 'Band swim', cue: 'ankles banded, hold the body line without the kick', gear: 'band', level: 1,
    focus: ['body-position', 'catch'], needs: ['band'], difficulty: 5, group: 'body-position',
    purpose: 'removes the kick so the body line has to hold itself',
  },
  {
    name: 'Breathing ladder', cue: 'breathe every 3, then 5, then 3 again', level: 0,
    focus: ['breathing', 'timing'], needs: [], difficulty: 3, group: 'breathing',
    purpose: 'trains a calmer breath so pace does not fall apart when air is short',
  },
];

// An athlete's declared settings, sanitised. Absent or malformed reads as
// "nothing declared", which is the byte-identical path.
export function saneTechnique(t) {
  if (!t || typeof t !== 'object') return null;
  const ids = TECHNIQUE_FOCUS.map(f => f.id);
  const kitIds = SWIM_EQUIPMENT.map(e => e.id);
  const focus = Array.isArray(t.focus) ? t.focus.filter(f => ids.includes(f)).slice(0, 2) : [];
  // kit is DECLARED when it is an array, even an empty one: an athlete who
  // owns nothing has said something real. undefined means never asked.
  const kit = Array.isArray(t.kit) ? t.kit.filter(k => kitIds.includes(k)) : null;
  if (!focus.length && kit === null) return null;
  return { focus, kit, updatedAt: t.updatedAt || null };
}

// The pool of drills this athlete can be given: level gate first (unchanged),
// then kit, then the focus-only extras.
export function drillPool(intensity, tech) {
  const lvl = d => d.level <= (intensity || 0);
  const base = SWIM_DRILLS.filter(lvl);
  const t = saneTechnique(tech);
  if (!t) return base;
  const extras = t.focus.length ? FOCUS_DRILLS.filter(lvl) : [];
  const all = base.concat(extras);
  // Kit filter: a drill that needs nothing is always available. Only applies
  // once the athlete has actually declared their kit.
  return t.kit === null ? all : all.filter(d => (d.needs || []).every(n => t.kit.includes(n)));
}

/* §5's bias: what the athlete's own cue answers say they should keep
   working on. Newest first in, an ordered focus list out, strongest signal
   first; 'none' answers are counted as noise and nothing else. This is
   deliberately weak evidence and is treated as such: it orders a preference,
   it never overrides a focus the athlete set themselves, and it claims
   nothing about stroke mechanics. Dormant until the log carries the answers
   (the field is a filed backend ask). */
export function cueFocusBias(cues) {
  const ids = TECHNIQUE_FOCUS.map(f => f.id);
  const counts = new Map();
  (cues || []).filter(c => ids.includes(c)).forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
  if (!counts.size) return [];
  // ties break by catalogue order, so the same answers always give the same
  // preference: no coin-flip coaching
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || ids.indexOf(a[0]) - ids.indexOf(b[0]))
    .map(([id]) => id);
}

/* Order the pool so the athlete's focus comes first, hardest last within a
   focus so a progression reads sensibly, and everything else keeps its
   catalogue order behind. Returns { ordered, matching } where matching is
   how many entries at the front address the declared focus. */
export function focusOrder(pool, tech) {
  const t = saneTechnique(tech);
  if (!t || !t.focus.length) return { ordered: pool, matching: 0 };
  const score = d => {
    const i = t.focus.findIndex(f => (d.focus || []).includes(f));
    return i < 0 ? -1 : i; // 0 = primary, 1 = secondary
  };
  const hit = pool.filter(d => score(d) >= 0);
  const rest = pool.filter(d => score(d) < 0);
  // primary before secondary, then easiest first: a session reads as a
  // progression rather than a shuffle, and week to week the same focus
  // keeps returning the same family of drills
  hit.sort((a, b) => score(a) - score(b) || (a.difficulty || 3) - (b.difficulty || 3));
  return { ordered: hit.concat(rest), matching: hit.length };
}
